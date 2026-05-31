import type { AgentToolResult } from "@openeryc/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { MCPClient, type MCPServerConfig } from "./client.ts";
import type { MCPConnectionStatus, MCPToolDefinition } from "./types.ts";

const DEFAULT_RECONNECT_MAX_ATTEMPTS = 5;
const DEFAULT_RECONNECT_INTERVAL_MS = 5000;

function toTypeBox(schema: MCPToolDefinition["inputSchema"]): ReturnType<typeof Type.Object> {
	if (!schema.properties || Object.keys(schema.properties).length === 0) {
		return Type.Object({});
	}
	const required = new Set(schema.required ?? []);
	const fields: Record<string, unknown> = {};
	for (const [key, prop] of Object.entries(schema.properties)) {
		const p = prop as { type?: string; description?: string; enum?: string[] };
		const t = p.type ?? "string";
		const desc = p.description ? { description: p.description } : {};
		let f: unknown;
		switch (t) {
			case "string":
				f = p.enum ? Type.Unsafe<string>({ type: "string", enum: p.enum, ...desc }) : Type.String(desc);
				break;
			case "number":
			case "integer":
				f = Type.Number(desc);
				break;
			case "boolean":
				f = Type.Boolean(desc);
				break;
			default:
				f = Type.Any(desc);
		}
		fields[key] = required.has(key) ? f : Type.Optional(f as never);
	}
	return Type.Object(fields as Record<string, ReturnType<typeof Type.String>>);
}

function sanitizeMcpName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export type MCPStatusChangeHandler = (serverName: string, status: MCPConnectionStatus) => void;

export class MCPManager {
	private clients = new Map<string, MCPClient>();
	private serverConfigs = new Map<string, MCPServerConfig>();
	private tools = new Map<string, ToolDefinition[]>();
	private resourceUris: string[] = [];
	private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private reconnectAttempts = new Map<string, number>();
	private _statuses = new Map<string, MCPConnectionStatus>();
	private toolTimeoutMap = new Map<string, Map<string, number>>();

	/** Called when any server's connection status changes */
	onStatusChange: MCPStatusChangeHandler | null = null;

	getServerStatus(serverName: string): MCPConnectionStatus {
		return this._statuses.get(serverName) ?? "disconnected";
	}

	getAllStatuses(): Array<{ serverName: string; status: MCPConnectionStatus; toolCount: number }> {
		return [...this._statuses.entries()].map(([serverName, status]) => ({
			serverName,
			status,
			toolCount: this.tools.get(serverName)?.length ?? 0,
		}));
	}

	private setStatus(serverName: string, status: MCPConnectionStatus): void {
		const prev = this._statuses.get(serverName);
		if (prev === status) return;
		this._statuses.set(serverName, status);
		try {
			this.onStatusChange?.(serverName, status);
		} catch {
			// ignore
		}
	}

	async start(serverConfigs: Record<string, MCPServerConfig>): Promise<void> {
		const pending: Array<Promise<void>> = [];
		for (const [serverName, config] of Object.entries(serverConfigs)) {
			if (config.enabled === false) {
				this.setStatus(serverName, "disabled");
				continue;
			}
			this.serverConfigs.set(serverName, config);
			if (config.toolTimeouts) {
				this.toolTimeoutMap.set(serverName, new Map(Object.entries(config.toolTimeouts)));
			}
			pending.push(this.connectServer(serverName, config));
		}
		// Connect all servers in parallel for faster startup
		await Promise.allSettled(pending);
	}

	/** Start a single server (used by reloadMcp for targeted toggle). */
	async startServer(serverName: string, config: MCPServerConfig): Promise<void> {
		this.serverConfigs.set(serverName, config);
		if (config.toolTimeouts) {
			this.toolTimeoutMap.set(serverName, new Map(Object.entries(config.toolTimeouts)));
		}
		await this.connectServer(serverName, config);
	}

	/** Stop a single server without affecting others. */
	async stopServer(serverName: string): Promise<void> {
		// Cancel reconnect timer for this server
		const timer = this.reconnectTimers.get(serverName);
		if (timer) {
			clearTimeout(timer);
			this.reconnectTimers.delete(serverName);
		}
		this.reconnectAttempts.delete(serverName);
		this.serverConfigs.delete(serverName);
		this.toolTimeoutMap.delete(serverName);
		this.tools.delete(serverName);
		// Also clean up resource URIs for this server
		this.resourceUris = this.resourceUris.filter((u) => !u.startsWith(`mcp://${serverName}`));

		const client = this.clients.get(serverName);
		if (client) {
			client.onDisconnect = null;
			this.clients.delete(serverName);
			await client.disconnect().catch(() => {});
		}
		this.setStatus(serverName, "disabled");
	}

	private async connectServer(serverName: string, config: MCPServerConfig): Promise<void> {
		this.setStatus(serverName, "reconnecting");
		let disconnected = false;
		const onDisconnect = () => {
			if (disconnected) return;
			disconnected = true;
			this.setStatus(serverName, "disconnected");
			this.tools.delete(serverName);
			this.scheduleReconnect(serverName);
		};

		try {
			const client = new MCPClient(config.timeoutMs);
			client.onDisconnect = () => onDisconnect();

			await client.connect(config);
			// If disconnect happened during connect(), bail out
			if (disconnected) {
				this.clients.delete(serverName);
				return;
			}

			const { tools: mcpTools } = await client.listTools();
			if (disconnected) {
				client.disconnect().catch(() => {});
				return;
			}
			this.clients.set(serverName, client);

			this.buildToolDefs(serverName, mcpTools);

			try {
				const { resources } = await client.listResources();
				for (const r of resources) {
					this.resourceUris.push(`mcp://${serverName}${r.uri}`);
				}
			} catch {
				// Server may not support resources
			}

			if (disconnected) {
				// Was disconnected during tool/resource discovery
				client.disconnect().catch(() => {});
				this.clients.delete(serverName);
				this.tools.delete(serverName);
				return;
			}

			this.setStatus(serverName, "connected");
			this.reconnectAttempts.delete(serverName);
		} catch (error) {
			onDisconnect();
			console.warn(
				`Failed to connect to MCP server "${serverName}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private buildToolDefs(serverName: string, mcpTools: MCPToolDefinition[]): void {
		const safeServerName = sanitizeMcpName(serverName);
		const client = this.clients.get(serverName)!;
		const perToolTimeout = this.toolTimeoutMap.get(serverName);

		const defs: ToolDefinition[] = mcpTools.map((tool) => {
			// Resolve effective timeout: per-tool > server default > client default (120s)
			const toolSpecificTimeoutMs = perToolTimeout?.get(tool.name);

			// Add optional _timeoutMs parameter so the AI can override timeout per-call.
			// We must produce a flat properties schema (not allOf) because LLM providers
			// access tool.parameters.properties directly.
			const baseParams = toTypeBox(tool.inputSchema);
			const baseSchema = baseParams as unknown as Record<string, unknown>;
			const mergedProps = {
				...((baseSchema.properties ?? {}) as Record<string, unknown>),
				_timeoutMs: {
					type: "number",
					description:
						"Optional timeout override in milliseconds for this specific call (e.g. 300000 for 5 min, 5000 for 5s). Overrides the server default timeout.",
				},
			};
			const mergedRequired = [...((baseSchema.required ?? []) as string[])];
			const parameters = Type.Object(mergedProps, { required: mergedRequired });

			return {
				name: `mcp_${safeServerName}_${sanitizeMcpName(tool.name)}`,
				label: `mcp.${serverName}.${tool.name}`,
				description: tool.description
					? `${tool.description} (from MCP server "${serverName}")`
					: `Tool from MCP server "${serverName}"`,
				promptSnippet: tool.description
					? `[${serverName}] ${tool.description.split("\n")[0]}`
					: `[${serverName}] ${tool.name}`,
				parameters,
				renderShell: "default" as const,
				execute: async (_id, params, signal) => {
					if (!client.isConnected) {
						return {
							content: [
								{
									type: "text" as const,
									text: `MCP server "${serverName}" is disconnected. Use /mcp to check status.`,
								},
							],
							details: { error: "disconnected" },
						} satisfies AgentToolResult<unknown>;
					}
					try {
						// Extract _timeoutMs from params (AI-specified timeout override)
						const rawParams = params as Record<string, unknown>;
						const callTimeoutMs =
							typeof rawParams._timeoutMs === "number" ? rawParams._timeoutMs : toolSpecificTimeoutMs;
						const { _timeoutMs: _ignored, ...mcpParams } = rawParams;

						const effectiveSignal =
							callTimeoutMs !== undefined
								? AbortSignal.any([AbortSignal.timeout(callTimeoutMs), ...(signal ? [signal] : [])])
								: signal;
						const result = await client.callTool(tool.name, mcpParams, effectiveSignal);
						const text = result.content
							.map((item) => (item.type === "text" && item.text ? item.text : `[Image: ${item.mimeType}]`))
							.join("\n");
						return {
							content: [{ type: "text" as const, text }],
							details: result,
						} satisfies AgentToolResult<unknown>;
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						return {
							content: [{ type: "text" as const, text: `MCP tool error: ${msg}` }],
							details: { error: msg },
						} satisfies AgentToolResult<unknown>;
					}
				},
			};
		});
		this.tools.set(serverName, defs);
	}

	private scheduleReconnect(serverName: string): void {
		// Cancel any existing reconnect timer for this server
		const existing = this.reconnectTimers.get(serverName);
		if (existing) {
			clearTimeout(existing);
		}

		const config = this.serverConfigs.get(serverName);
		if (!config) return;

		const reconnectCfg = config.reconnect ?? {};
		if (reconnectCfg.enabled === false) return;

		const maxAttempts = reconnectCfg.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;
		const intervalMs = reconnectCfg.intervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS;
		const attempt = (this.reconnectAttempts.get(serverName) ?? 0) + 1;

		if (attempt > maxAttempts) {
			console.warn(`MCP server "${serverName}": max reconnection attempts (${maxAttempts}) reached, giving up.`);
			this.reconnectAttempts.delete(serverName);
			return;
		}

		this.reconnectAttempts.set(serverName, attempt);
		this.setStatus(serverName, "reconnecting");

		const timer = setTimeout(() => {
			this.reconnectTimers.delete(serverName);
			const cfg = this.serverConfigs.get(serverName);
			if (!cfg) return;

			// Remove old client if any
			const oldClient = this.clients.get(serverName);
			if (oldClient) {
				oldClient.onDisconnect = null;
				oldClient.disconnect().catch(() => {});
				this.clients.delete(serverName);
			}

			this.connectServer(serverName, cfg).catch((err) =>
				console.warn(`MCP reconnect failed for "${serverName}":`, err),
			);
		}, intervalMs * Math.min(attempt, 5)); // exponential backoff, cap at 5x

		this.reconnectTimers.set(serverName, timer);
	}

	/** Manually trigger reconnection for a specific server */
	async reconnect(serverName: string): Promise<void> {
		const existingTimer = this.reconnectTimers.get(serverName);
		if (existingTimer) {
			clearTimeout(existingTimer);
			this.reconnectTimers.delete(serverName);
		}

		const oldClient = this.clients.get(serverName);
		if (oldClient) {
			oldClient.onDisconnect = null;
			await oldClient.disconnect().catch(() => {});
			this.clients.delete(serverName);
		}

		const config = this.serverConfigs.get(serverName);
		if (!config) {
			this.setStatus(serverName, "disconnected");
			return;
		}

		this.reconnectAttempts.delete(serverName);
		await this.connectServer(serverName, config);
	}

	getToolDefinitions(): ToolDefinition[] {
		return Array.from(this.tools.values()).flat();
	}

	getServerNames(): string[] {
		return [...this.clients.keys()];
	}

	getResourceUris(): string[] {
		return this.resourceUris;
	}

	async stop(): Promise<void> {
		// Cancel all reconnect timers
		for (const [, timer] of this.reconnectTimers) {
			clearTimeout(timer);
		}
		this.reconnectTimers.clear();
		this.reconnectAttempts.clear();

		const pending = [...this.clients.entries()].map(async ([name, client]) => {
			try {
				await client.disconnect();
			} catch (error) {
				console.warn(
					`Error disconnecting MCP server "${name}": ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
		this.clients.clear();
		this.tools.clear();
		this.resourceUris = [];
		this._statuses.clear();
		await Promise.all(pending);
	}
}
