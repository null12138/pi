import type { AgentToolResult } from "@openeryc/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { MCPClient, type MCPServerConfig } from "./client.ts";

function toTypeBox(jsonSchema: {
	type: string;
	properties?: Record<string, unknown>;
	required?: string[];
}): ReturnType<typeof Type.Object> {
	if (!jsonSchema.properties || Object.keys(jsonSchema.properties).length === 0) {
		return Type.Object({});
	}

	const required = new Set(jsonSchema.required ?? []);
	const fields: Record<string, unknown> = {};

	for (const [key, prop] of Object.entries(jsonSchema.properties)) {
		const p = prop as { type?: string; description?: string; enum?: string[] };
		const type = p.type ?? "string";
		const desc = p.description ? { description: p.description } : {};

		let field: unknown;
		switch (type) {
			case "string":
				field = p.enum ? Type.Unsafe<string>({ type: "string", enum: p.enum, ...desc }) : Type.String(desc);
				break;
			case "number":
			case "integer":
				field = Type.Number(desc);
				break;
			case "boolean":
				field = Type.Boolean(desc);
				break;
			default:
				field = Type.Any(desc);
		}

		fields[key] = required.has(key) ? field : Type.Optional(field as never);
	}

	return Type.Object(fields as Record<string, ReturnType<typeof Type.String>>);
}

export class MCPManager {
	private clients = new Map<string, MCPClient>();
	private tools = new Map<string, ToolDefinition[]>();

	async start(serverConfigs: Record<string, MCPServerConfig>): Promise<void> {
		for (const [serverName, config] of Object.entries(serverConfigs)) {
			try {
				const client = new MCPClient();
				await client.connect(config);
				const { tools: mcpTools } = await client.listTools();
				this.clients.set(serverName, client);

				const defs: ToolDefinition[] = mcpTools.map((tool) => ({
					name: `mcp.${serverName}.${tool.name}`,
					label: `mcp.${serverName}.${tool.name}`,
					description: tool.description
						? `${tool.description} (from MCP server "${serverName}")`
						: `Tool from MCP server "${serverName}"`,
					promptSnippet: `mcp.${serverName}.${tool.name}`,
					parameters: toTypeBox(tool.inputSchema),
					renderShell: "default" as const,
					executionMode: "sequential" as const,
					execute: async (_id, params, _signal) => {
						try {
							const result = await client.callTool(tool.name, params as Record<string, unknown>);
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
			} catch (error) {
				console.warn(
					`Failed to connect to MCP server "${serverName}": ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	getToolDefinitions(): ToolDefinition[] {
		return Array.from(this.tools.values()).flat();
	}

	getServerNames(): string[] {
		return [...this.clients.keys()];
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
		await Promise.all(pending);
	}
}
