import type { AgentToolResult } from "@openeryc/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { MCPClient, type MCPServerConfig } from "./client.ts";
import type { MCPToolDefinition } from "./types.ts";

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

export class MCPManager {
	private clients = new Map<string, MCPClient>();
	private tools = new Map<string, ToolDefinition[]>();
	private resourceUris: string[] = [];

	async start(serverConfigs: Record<string, MCPServerConfig>): Promise<void> {
		for (const [serverName, config] of Object.entries(serverConfigs)) {
			if (config.enabled === false) continue;
			try {
				const client = new MCPClient(config.timeoutMs);
				await client.connect(config);
				const { tools: mcpTools } = await client.listTools();
				this.clients.set(serverName, client);

				const safeServerName = sanitizeMcpName(serverName);
				const defs: ToolDefinition[] = mcpTools.map((tool) => ({
					name: `mcp_${safeServerName}_${sanitizeMcpName(tool.name)}`,
					label: `mcp.${serverName}.${tool.name}`,
					description: tool.description
						? `${tool.description} (from MCP server "${serverName}")`
						: `Tool from MCP server "${serverName}"`,
					promptSnippet: tool.description
						? `[${serverName}] ${tool.description.split("\n")[0]}`
						: `[${serverName}] ${tool.name}`,
					parameters: toTypeBox(tool.inputSchema),
					renderShell: "default" as const,
					execute: async (_id, params, signal) => {
						try {
							const result = await client.callTool(tool.name, params as Record<string, unknown>, signal);
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
				}));

				this.tools.set(serverName, defs);

				// Discover resources
				try {
					const { resources } = await client.listResources();
					for (const r of resources) {
						this.resourceUris.push(`mcp://${serverName}${r.uri}`);
					}
				} catch {
					// Server may not support resources
				}
			} catch (error) {
				console.warn(
					`Failed to connect to MCP server "${serverName}": ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	async readResource(uri: string): Promise<string> {
		const serverName = this.clients.keys().next().value;
		if (!serverName) throw new Error("No MCP servers connected");
		const mcpUri = uri.startsWith(`mcp://${serverName}`) ? uri.slice(`mcp://${serverName}`.length) : uri;
		const client = this.clients.get(serverName);
		if (!client) throw new Error(`MCP server "${serverName}" not connected`);
		const result = await client.readResource(mcpUri);
		return result.contents.map((c) => c.text ?? "").join("\n");
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
		await Promise.all(pending);
	}
}
