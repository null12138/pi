import { type ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";
import type { MCPCallToolResult, MCPResource, MCPServerConfig, MCPToolDefinition } from "./types.ts";

export type { MCPServerConfig };

const DEFAULT_MCP_TIMEOUT_MS = 120_000;
const MCP_CONNECT_TIMEOUT_MS = 30_000;

type PendingEntry = { resolve: (v: unknown) => void; reject: (e: Error) => void };

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
	private pending = new Map<number, PendingEntry>();
	private sseEndpoint: string | null = null;
	private sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private timeoutMs: number;
	private _connected = false;

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
			this.timeoutMs = savedTimeout;
		}
	}

	/** Reset all connection state (called on disconnect or intentional close).
	 * Rejects all in-flight pending promises so tool calls don't hang. */
	private resetState(reason: string): void {
		if (!this._connected && !this.process && !this.sseReader) return;
		this._connected = false;
		this.process = null;
		this.sseEndpoint = null;
		this.sseReader = null;

		// MUST reject all pending promises before clearing, or tool calls freeze
		// until the 120s timeout fires. Collect entries first because rejecting
		// may trigger cleanup() which deletes from the map during iteration.
		const entries = [...this.pending.values()];
		for (const entry of entries) {
			entry.reject(new Error(`MCP disconnected: ${reason}`));
		}
		this.pending.clear();

		try {
			this.onDisconnect?.(reason);
		} catch {
			/* ignore */
		}
	}

	private processSseLine(line: string): void {
		if (!line.startsWith("data: ")) return;
		const data = line.slice(6);
		if (!data.startsWith("{")) return;

		try {
			const parsed = JSON.parse(data);
			if (parsed.id === undefined) return;
			const handler = this.pending.get(parsed.id);
			if (!handler) return;
			this.pending.delete(parsed.id);
			if (parsed.error) {
				handler.reject(new Error(`MCP error: ${parsed.error.message}`));
			} else {
				handler.resolve(parsed.result);
			}
		} catch {
			/* skip */
		}
	}

	// ── stdio transport ──────────────────────────────────────────────

	private async connectStdio(config: MCPServerConfig): Promise<void> {
		const { command, args = [], env } = config;
		if (!command) throw new Error("MCP stdio server requires 'command'");

		const childEnv = env ? { ...process.env, ...env } : process.env;
		return new Promise<void>((resolve, reject) => {
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
				this.resetState(`process exited with code ${code}`);
			});

			resolve();
		});
	}

	// ── HTTP / SSE transport ─────────────────────────────────────────

	private async connectHttp(config: MCPServerConfig, transport: "sse" | "http"): Promise<void> {
		const { url, headers = {} } = config;
		if (!url) throw new Error("MCP SSE/HTTP server requires 'url'");

		if (transport === "sse") {
			const res = await fetch(`${url}/sse`, { headers: { ...headers, Accept: "text/event-stream" } });
			if (!res.ok) throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);

			const reader = res.body!.getReader();
			this.sseReader = reader;
			const decoder = new TextDecoder();
			let buffer = "";
			let endpointReceived = false;

			// Read SSE stream until we get the endpoint event or timeout
			const deadline = Date.now() + MCP_CONNECT_TIMEOUT_MS;
			while (Date.now() < deadline) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (line.startsWith("event: endpoint") && i + 1 < lines.length && lines[i + 1].startsWith("data: ")) {
						this.sseEndpoint = lines[i + 1].slice(6).trim();
						endpointReceived = true;
						break;
					}
				}
				if (endpointReceived) break;
			}

			if (!this.sseEndpoint) {
				this.sseEndpoint = url;
			}

			// Start background SSE reader for JSON-RPC responses
			this.startSseReader(reader, decoder, buffer);
		} else {
			this.sseEndpoint = url;
		}
	}

	/** Continuously read the SSE stream and dispatch JSON-RPC responses. */
	private async startSseReader(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		decoder: { decode(b?: Uint8Array, o?: { stream?: boolean }): string },
		initialBuffer: string,
	): Promise<void> {
		let buffer = initialBuffer;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					this.resetState("SSE stream ended");
					return;
				}
				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						this.processSseLine(line);
					}
				}
			}
		} catch (err) {
			this.resetState(err instanceof Error ? err.message : String(err));
		}
	}

	// ── JSON-RPC send ────────────────────────────────────────────────

	private async send(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		const id = ++this.requestId;
		const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

		if (this.process?.stdin) {
			return this.withTimeout(id, signal, (_resolve, reject) => {
				try {
					this.process!.stdin!.write(`${body}\n`);
				} catch (err) {
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});
		}

		if (this.sseEndpoint) {
			return this.withTimeout(id, signal, async (resolve, reject) => {
				try {
					const timeoutMs = this.timeoutMs > 0 ? this.timeoutMs : undefined;
					const res = await fetch(this.sseEndpoint!, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body,
						signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
					});
					const text = await res.text();

					// SSE transport: response comes via SSE stream, not HTTP response body
					if (res.headers.get("content-type")?.includes("text/event-stream")) {
						// Response will be delivered via startSseReader → processSseLine
						return;
					}

					// Streamable HTTP / direct response
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
	 * Register a pending request with timeout + abort signal support.
	 * The pending entry stays alive until the response line arrives
	 * (via stdio readline or SSE processSseLine), the timeout fires,
	 * or the caller's AbortSignal fires.
	 *
	 * IMPORTANT: for SSE transport, the response arrives asynchronously
	 * via startSseReader → processSseLine, so the pending entry here
	 * is resolved by that path. The writer callback sends the POST request
	 * and the SSE response is dispatched in processSseLine.
	 */
	private withTimeout(
		id: number,
		signal: AbortSignal | undefined,
		writer: (resolve: (v: unknown) => void, reject: (e: Error) => void) => void,
	): Promise<unknown> {
		return new Promise<unknown>((outerResolve, outerReject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let resolved = false;

			const cleanup = () => {
				if (resolved) return;
				resolved = true;
				if (timer) clearTimeout(timer);
				if (signal) {
					try {
						signal.removeEventListener("abort", onAbort);
					} catch {
						/* ignore */
					}
				}
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

			const onAbort = () => {
				reject(new DOMException("MCP request cancelled", "AbortError"));
			};

			if (this.timeoutMs > 0) {
				timer = setTimeout(() => {
					reject(new Error(`MCP request timed out after ${this.timeoutMs}ms`));
				}, this.timeoutMs);
			}

			if (signal) {
				if (signal.aborted) {
					reject(new DOMException("MCP request cancelled", "AbortError"));
					return;
				}
				signal.addEventListener("abort", onAbort, { once: true });
			}

			this.pending.set(id, { resolve, reject });
			writer(resolve, reject);
		});
	}

	// ── Public API ───────────────────────────────────────────────────

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
		this.onDisconnect = null;
		const proc = this.process;
		const reader = this.sseReader;
		this.process = null;
		this.sseReader = null;
		this.sseEndpoint = null;
		this._connected = false;
		for (const [, entry] of this.pending) {
			entry.reject(new Error("MCP client disconnected"));
		}
		this.pending.clear();

		if (reader) {
			try {
				await reader.cancel();
			} catch {
				/* ignore */
			}
		}
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
