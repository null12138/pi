import { type ChildProcess, spawn } from "child_process";
import { createInterface, type Interface } from "readline";
import type {
	MCPCallToolResult,
	MCPInitializeResult,
	MCPJsonRpcRequest,
	MCPJsonRpcResponse,
	MCPListToolsResult,
	MCPServerConfig,
} from "./types.ts";

const INITIALIZE_REQUEST = "initialize";
const TOOLS_LIST_REQUEST = "tools/list";
const TOOLS_CALL_REQUEST = "tools/call";

export class MCPClient {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private lineReader: Interface | null = null;
	private config: MCPServerConfig;
	private errorLogs: string[] = [];

	get errors(): readonly string[] {
		return this.errorLogs;
	}

	constructor(config: MCPServerConfig) {
		this.config = config;
	}

	async connect(): Promise<void> {
		const { command, args = [], env } = this.config;
		const childEnv = env ? { ...process.env, ...env } : process.env;

		return new Promise((resolve, reject) => {
			this.process = spawn(command, args, {
				env: childEnv,
				stdio: ["pipe", "pipe", "pipe"],
				shell: false,
			});

			const onError = (error: Error) => {
				reject(new Error(`Failed to spawn MCP server "${command}": ${error.message}`));
			};

			this.process.on("error", onError);
			this.process.once("spawn", () => {
				this.process!.removeListener("error", onError);
			});

			if (!this.process.stdout) {
				reject(new Error(`MCP server "${command}" has no stdout`));
				return;
			}

			this.lineReader = createInterface({ input: this.process.stdout, crlfDelay: Infinity });

			this.lineReader.on("line", (line: string) => {
				this.handleLine(line);
			});

			if (this.process.stderr) {
				this.process.stderr.setEncoding("utf-8");
				this.process.stderr.on("data", (data: string) => {
					this.errorLogs.push(data);
				});
			}

			this.process.on("exit", (code) => {
				const pendingCopy = new Map(this.pendingRequests);
				this.pendingRequests.clear();
				for (const [, handler] of pendingCopy) {
					handler.reject(new Error(`MCP server "${command}" exited with code ${code}`));
				}
			});

			this.initialize()
				.then(() => resolve())
				.catch(reject);
		});
	}

	private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.process || !this.process.stdin) {
			throw new Error(`MCP client not connected`);
		}

		const id = ++this.requestId;
		const request: MCPJsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			const payload = JSON.stringify(request);
			this.process!.stdin!.write(`${payload}\n`);
		});
	}

	private handleLine(line: string): void {
		try {
			const response = JSON.parse(line) as MCPJsonRpcResponse;
			if (response.id !== undefined) {
				const request = this.pendingRequests.get(response.id);
				if (request) {
					this.pendingRequests.delete(response.id);
					if (response.error) {
						request.reject(new Error(`MCP error: ${response.error.message} (code ${response.error.code})`));
					} else {
						request.resolve(response.result);
					}
				}
			}
		} catch {
			// Ignore non-JSON lines (stderr or informational messages)
		}
	}

	private async initialize(): Promise<MCPInitializeResult> {
		return (await this.sendRequest(INITIALIZE_REQUEST, {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi", version: "1.0.0" },
		})) as MCPInitializeResult;
	}

	async listTools(): Promise<MCPListToolsResult> {
		return (await this.sendRequest(TOOLS_LIST_REQUEST)) as MCPListToolsResult;
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
		return (await this.sendRequest(TOOLS_CALL_REQUEST, {
			name,
			arguments: args,
		} as unknown as Record<string, unknown>)) as MCPCallToolResult;
	}

	async disconnect(): Promise<void> {
		if (this.lineReader) {
			this.lineReader.close();
			this.lineReader = null;
		}
		if (this.process) {
			const proc = this.process;
			this.process = null;
			this.pendingRequests.clear();
			if (!proc.killed) {
				proc.kill();
				await new Promise<void>((resolve) => {
					const onExit = () => {
						resolve();
					};
					proc.on("exit", onExit);
					if (proc.exitCode !== null) {
						proc.removeListener("exit", onExit);
						resolve();
					}
					setTimeout(() => {
						proc.removeListener("exit", onExit);
						resolve();
					}, 3000);
				});
			}
		}
	}
}
