import { type ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";
import type { MCPCallToolResult, MCPResource, MCPServerConfig, MCPToolDefinition } from "./types.ts";

export type { MCPServerConfig };

/** Default MCP tool call timeout: 2 minutes */
const DEFAULT_MCP_TIMEOUT_MS = 120_000;
/** MCP connection handshake timeout: 30 seconds */
const MCP_CONNECT_TIMEOUT_MS = 30_000;

type PendingRequest = { resolve: (v: unknown) => void; reject: (e: Error) => void };

function resolveTransport(config: MCPServerConfig): "stdio" | "sse" | "http" {
	if (config.transport) return config.transport;
	if (config.command) return "stdio";
	if (config.url) return "sse";
	return "stdio";
}

export type MCPDisconnectHandler = (reason: string) => void;

export class MCPClient {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pending = new Map<number, PendingRequest>();
	private sseEndpoint: string | null = null;
	private timeoutMs: number;
	private _connected = false;

	/** Called when the connection is lost unexpectedly */
	onDisconnect: MCPDisconnectHandler | null = null;

	constructor(timeoutMs?: number) {
		this.timeoutMs = timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;
	}

	get isConnected(): boolean {
		return this._connected;
	}

	async connect(config: MCPServerConfig): Promise<void> {
		if (config.timeoutMs !== undefined) {
			this.timeoutMs = config.timeoutMs;
		}

		const transport = resolveTransport(config);

		// Use a shorter timeout for the connection handshake
		// (server startup via npx, dependency downloads, etc.)
		const savedTimeout = this.timeoutMs;
		this.timeoutMs = Math.min(this.timeoutMs, MCP_CONNECT_TIMEOUT_MS);
		try {
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
			this._connected = true;
		} finally {
			// Restore the configured timeout for subsequent tool calls
			this.timeoutMs = savedTimeout;
		}
	}

	private handleDisconnect(reason: string): void {
		if (!this._connected) return;
		this._connected = false;
		this.pending.clear();
		this.sseEndpoint = null;
		this.process = null;

		try {
			this.onDisconnect?.(reason);
		} catch {
			// ignore errors from disconnect handler
		}
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
				this.handleDisconnect(`process exited with code ${code}`);
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
				try {
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
				} catch (err) {
					// Stream error means connection lost
					this.handleDisconnect(err instanceof Error ? err.message : String(err));
					return;
				}
				// Stream ended normally
				this.handleDisconnect("SSE stream ended");
			};

			// Wait for endpoint event
			const endpointLine = await this.readSSEEvent(reader, decoder);
			if (endpointLine) {
				this.sseEndpoint = endpointLine.startsWith("/") ? new URL(endpointLine, url).href : endpointLine;
			} else {
				this.sseEndpoint = url;
			}

			// Start background reader
			processChunk();
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

	private async send(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		const id = ++this.requestId;
		const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

		if (this.process?.stdin) {
			return this.sendWithTimeout(id, body, signal, (_resolve, reject) => {
				try {
					this.process!.stdin!.write(`${body}\n`);
				} catch (err) {
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});
		}

		if (this.sseEndpoint) {
			return this.sendWithTimeout(id, body, signal, async (resolve, reject) => {
				try {
					const timeoutMs = this.timeoutMs > 0 ? this.timeoutMs : undefined;
					const res = await fetch(this.sseEndpoint!, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body,
						signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
					});
					const text = await res.text();
					if (res.headers.get("content-type")?.includes("text/event-stream")) {
						// SSE upgrade - response comes via event stream
						return;
					}
					const parsed = JSON.parse(text);
					if (parsed.error) {
						reject(new Error(`MCP error: ${parsed.error.message}`));
					} else {
						resolve(parsed.result);
					}
				} catch (err) {
					if (err instanceof Error && err.name === "TimeoutError") {
						reject(new Error(`MCP request timed out after ${this.timeoutMs}ms`));
					} else {
						reject(err instanceof Error ? err : new Error(String(err)));
					}
				}
			});
		}

		throw new Error("MCP client not connected");
	}

	/**
	 * Wraps a request with timeout and AbortSignal support.
	 * Registers the pending handler so that response lines resolve it,
	 * and rejects if the timeout fires or the caller's signal aborts.
	 */
	private sendWithTimeout(
		id: number,
		_body: string,
		signal: AbortSignal | undefined,
		writer: (resolve: (v: unknown) => void, reject: (e: Error) => void) => void,
	): Promise<unknown> {
		return new Promise<unknown>((outerResolve, outerReject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let done = false;

			const cleanup = () => {
				if (done) return;
				done = true;
				if (timer) clearTimeout(timer);
				this.pending.delete(id);
			};

			const resolve = (v: unknown) => {
				cleanup();
				outerResolve(v);
			};

			const reject = (e: Error) => {
				cleanup();
				outerReject(e);
			};

			// Timeout (unless disabled by setting timeoutMs = 0)
			if (this.timeoutMs > 0) {
				timer = setTimeout(() => {
					reject(new Error(`MCP request timed out after ${this.timeoutMs}ms`));
				}, this.timeoutMs);
			}

			// Caller abort signal
			if (signal) {
				if (signal.aborted) {
					reject(new DOMException("MCP request cancelled", "AbortError"));
					return;
				}
				signal.addEventListener(
					"abort",
					() => {
						reject(new DOMException("MCP request cancelled", "AbortError"));
					},
					{ once: true },
				);
			}

			this.pending.set(id, { resolve, reject });

			writer(resolve, reject);
		});
	}

	async listTools(signal?: AbortSignal): Promise<{ tools: MCPToolDefinition[] }> {
		return (await this.send("tools/list", undefined, signal)) as { tools: MCPToolDefinition[] };
	}

	async listResources(signal?: AbortSignal): Promise<{ resources: MCPResource[] }> {
		return (await this.send("resources/list", undefined, signal)) as { resources: MCPResource[] };
	}

	async readResource(
		uri: string,
		signal?: AbortSignal,
	): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
		return (await this.send("resources/read", { uri }, signal)) as {
			contents: Array<{ uri: string; mimeType?: string; text?: string }>;
		};
	}

	async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<MCPCallToolResult> {
		return (await this.send("tools/call", { name, arguments: args }, signal)) as MCPCallToolResult;
	}

	async disconnect(): Promise<void> {
		this._connected = false;
		this.onDisconnect = null;
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
