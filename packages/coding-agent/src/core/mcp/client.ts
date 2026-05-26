import { type ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";
import type { MCPCallToolResult, MCPResource, MCPServerConfig, MCPToolDefinition } from "./types.ts";

export type { MCPServerConfig };

type PendingRequest = { resolve: (v: unknown) => void; reject: (e: Error) => void };

function resolveTransport(config: MCPServerConfig): "stdio" | "sse" | "http" {
	if (config.transport) return config.transport;
	if (config.command) return "stdio";
	if (config.url) return "sse";
	return "stdio";
}

export class MCPClient {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pending = new Map<number, PendingRequest>();
	private sseEndpoint: string | null = null;

	async connect(config: MCPServerConfig): Promise<void> {
		const transport = resolveTransport(config);
		if (transport === "stdio") {
			await this.connectStdio(config);
		} else {
			await this.connectHttp(config, transport);
		}
		await this.send("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi", version: "1.0.0" },
		});
	}

	private async connectStdio(config: MCPServerConfig): Promise<void> {
		const { command, args = [], env } = config;
		if (!command) throw new Error("MCP stdio server requires 'command'");

		const childEnv = env ? { ...process.env, ...env } : process.env;
		return new Promise((resolve, reject) => {
			const proc = spawn(command, args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"], shell: false });
			this.process = proc;

			const onError = (error: Error) => {
				reject(new Error(`Failed to spawn MCP server "${command}": ${error.message}`));
			};
			proc.on("error", onError);
			proc.once("spawn", () => proc.removeListener("error", onError));

			if (!proc.stdout) {
				reject(new Error(`MCP server "${command}" has no stdout`));
				return;
			}

			const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
			rl.on("line", (line: string) => {
				try {
					const res = JSON.parse(line);
					if (res.id !== undefined) {
						const handler = this.pending.get(res.id);
						if (!handler) return;
						this.pending.delete(res.id);
						if (res.error) {
							handler.reject(new Error(`MCP error: ${res.error.message}`));
						} else {
							handler.resolve(res.result);
						}
					}
				} catch {
					/* non-JSON lines */
				}
			});

			proc.on("exit", (code) => {
				for (const [, h] of this.pending) {
					h.reject(new Error(`MCP server "${command}" exited with code ${code}`));
				}
				this.pending.clear();
			});

			resolve();
		});
	}

	private async connectHttp(config: MCPServerConfig, transport: "sse" | "http"): Promise<void> {
		const { url, headers = {} } = config;
		if (!url) throw new Error("MCP SSE/HTTP server requires 'url'");

		if (transport === "sse") {
			const res = await fetch(`${url}/sse`, { headers: { ...headers, Accept: "text/event-stream" } });
			if (!res.ok) throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);

			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			const processChunk = async () => {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						if (line.startsWith("data: ")) {
							const data = line.slice(6);
							if (data.startsWith("{") && this.sseEndpoint === null) {
								try {
									const parsed = JSON.parse(data);
									if (parsed.result) {
										const handler = this.pending.get(parsed.id);
										if (handler) {
											this.pending.delete(parsed.id);
											if (parsed.error) {
												handler.reject(new Error(`MCP error: ${parsed.error.message}`));
											} else {
												handler.resolve(parsed.result);
											}
										}
									}
								} catch {
									/* skip */
								}
							} else if (data.startsWith("http")) {
								// This is the endpoint URL
							}
						} else if (line.startsWith("event: endpoint")) {
							// Next data line will be the endpoint URL
						}
					}
				}
			};

			// Wait for endpoint event
			const endpointLine = await this.readSSEEvent(reader, decoder);
			if (endpointLine) {
				this.sseEndpoint = endpointLine.startsWith("/") ? new URL(endpointLine, url).href : endpointLine;
			} else {
				this.sseEndpoint = url;
			}

			// Start background reader
			processChunk().catch(() => {});
		} else {
			// Streamable HTTP - POST to URL directly, server responds with JSON or upgrades to SSE
			this.sseEndpoint = url;
		}
	}

	private async readSSEEvent(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		decoder: { decode(b?: Uint8Array, o?: { stream?: boolean }): string },
	): Promise<string | null> {
		let buffer = "";
		const deadline = Date.now() + 10000;

		while (Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line.startsWith("data: ") && lines[i - 1]?.startsWith("event: endpoint")) {
					return line.slice(6).trim();
				}
				if (line.startsWith("event: endpoint") && lines[i + 1]?.startsWith("data: ")) {
					return lines[i + 1].slice(6).trim();
				}
			}
		}
		return null;
	}

	private async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const id = ++this.requestId;
		const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

		if (this.process?.stdin) {
			return new Promise((resolve, reject) => {
				this.pending.set(id, { resolve, reject });
				this.process!.stdin!.write(`${body}\n`);
			});
		}

		if (this.sseEndpoint) {
			return new Promise((resolve, reject) => {
				this.pending.set(id, { resolve, reject });
				fetch(this.sseEndpoint!, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
				})
					.then(async (res) => {
						const text = await res.text();
						if (res.headers.get("content-type")?.includes("text/event-stream")) {
							// SSE upgrade - response comes via event stream
							return;
						}
						try {
							const parsed = JSON.parse(text);
							const handler = this.pending.get(id);
							if (handler) {
								this.pending.delete(id);
								if (parsed.error) {
									handler.reject(new Error(`MCP error: ${parsed.error.message}`));
								} else {
									handler.resolve(parsed.result);
								}
							}
						} catch {
							reject(new Error(`Invalid JSON response from MCP server`));
						}
					})
					.catch(reject);
			});
		}

		throw new Error("MCP client not connected");
	}

	async listTools(): Promise<{ tools: MCPToolDefinition[] }> {
		return (await this.send("tools/list")) as { tools: MCPToolDefinition[] };
	}

	async listResources(): Promise<{ resources: MCPResource[] }> {
		return (await this.send("resources/list")) as { resources: MCPResource[] };
	}

	async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
		return (await this.send("resources/read", { uri })) as {
			contents: Array<{ uri: string; mimeType?: string; text?: string }>;
		};
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
		return (await this.send("tools/call", { name, arguments: args })) as MCPCallToolResult;
	}

	async disconnect(): Promise<void> {
		const proc = this.process;
		this.process = null;
		this.pending.clear();
		this.sseEndpoint = null;
		if (proc && !proc.killed) {
			proc.kill();
			await new Promise<void>((resolve) => {
				if (proc.exitCode !== null) return resolve();
				proc.on("exit", resolve);
				setTimeout(resolve, 3000);
			});
		}
	}
}
