import { type ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";

export interface MCPServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

interface MCPSimpleTool {
	name: string;
	description?: string;
	inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
}

interface MCPListToolsResult {
	tools: MCPSimpleTool[];
}

interface MCPCallToolResult {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	isError?: boolean;
}

export class MCPClient {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	async connect(config: MCPServerConfig): Promise<void> {
		const { command, args = [], env } = config;
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
							handler.reject(new Error(`MCP error: ${res.error.message} (code ${res.error.code})`));
						} else {
							handler.resolve(res.result);
						}
					}
				} catch {
					// Non-JSON lines (stderr)
				}
			});

			proc.on("exit", (code) => {
				for (const [, h] of this.pending) {
					h.reject(new Error(`MCP server "${command}" exited with code ${code}`));
				}
				this.pending.clear();
			});

			this.send("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "pi", version: "1.0.0" },
			})
				.then(() => resolve())
				.catch(reject);
		});
	}

	private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.process?.stdin) throw new Error("MCP client not connected");

		const id = ++this.requestId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.process!.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	async listTools(): Promise<MCPListToolsResult> {
		return (await this.send("tools/list")) as MCPListToolsResult;
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
		return (await this.send("tools/call", { name, arguments: args })) as MCPCallToolResult;
	}

	async disconnect(): Promise<void> {
		const proc = this.process;
		this.process = null;
		this.pending.clear();
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
