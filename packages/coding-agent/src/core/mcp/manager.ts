import type { AgentToolResult } from "@openeryc/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { MCPClient } from "./client.ts";
import type { MCPServerConfig, MCPToolDefinition } from "./types.ts";

function jsonSchemaToTypeBox(schema: MCPToolDefinition["inputSchema"]): ReturnType<typeof Type.Object> {
	const properties: Record<string, unknown> = {};

	if (schema.properties) {
		for (const [key, prop] of Object.entries(schema.properties)) {
			const type = prop.type || "string";
			let field: unknown;

			switch (type) {
				case "string":
					field = prop.enum ? Type.Unsafe<string>({ type: "string", enum: prop.enum as string[] }) : Type.String();
					break;
				case "number":
				case "integer":
					field = Type.Number();
					break;
				case "boolean":
					field = Type.Boolean();
					break;
				case "array":
					field = Type.Array(Type.Any());
					break;
				case "object":
					field = Type.Record(Type.String(), Type.Any());
					break;
				default:
					field = Type.Any();
			}

			if (prop.description) {
				(field as { description?: string }).description = prop.description;
			}

			properties[key] = field;
		}
	}

	if (Object.keys(properties).length === 0) {
		return Type.Object({});
	}

	const required = new Set(schema.required ?? []);
	for (const key of Object.keys(properties)) {
		if (!required.has(key)) {
			properties[key] = Type.Optional(properties[key] as ReturnType<typeof Type.String>);
		}
	}

	return Type.Object(properties as Record<string, ReturnType<typeof Type.String>>);
}

function formatToolResult(result: {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}): string {
	return result.content
		.map((item) => {
			if (item.type === "text" && item.text !== undefined) {
				return item.text;
			}
			return `[Image: ${item.mimeType}]`;
		})
		.join("\n");
}

export interface McpServerTools {
	serverName: string;
	tools: ToolDefinition[];
}

export class MCPManager {
	private serverConfigs: Record<string, MCPServerConfig>;
	private clients = new Map<string, MCPClient>();
	private serverTools = new Map<string, ToolDefinition[]>();

	constructor(serverConfigs: Record<string, MCPServerConfig>) {
		this.serverConfigs = { ...serverConfigs };
	}

	async start(): Promise<void> {
		for (const [serverName, config] of Object.entries(this.serverConfigs)) {
			try {
				const client = new MCPClient(config);
				await client.connect();

				const toolsResult = await client.listTools();
				this.clients.set(serverName, client);

				const tools: ToolDefinition[] = [];
				for (const tool of toolsResult.tools) {
					const namespacedName = `mcp.${serverName}.${tool.name}`;
					const description = tool.description
						? `${tool.description} (from MCP server "${serverName}")`
						: `Tool from MCP server "${serverName}"`;

					tools.push({
						name: namespacedName,
						label: namespacedName,
						description,
						promptSnippet: namespacedName,
						parameters: jsonSchemaToTypeBox(tool.inputSchema),
						renderShell: "default",
						executionMode: "sequential",
						execute: async (_toolCallId, params, _signal) => {
							const result: AgentToolResult<unknown> = {
								content: [{ type: "text", text: "" }],
								details: {},
							};

							try {
								const mcpResult = await client.callTool(tool.name, params as Record<string, unknown>);
								result.content = [{ type: "text", text: formatToolResult(mcpResult) }];
								result.details = mcpResult;
							} catch (error) {
								const errMsg = error instanceof Error ? error.message : String(error);
								result.content = [{ type: "text", text: `MCP tool error: ${errMsg}` }];
								result.details = { error: errMsg };
							}

							return result;
						},
					});
				}

				this.serverTools.set(serverName, tools);
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				console.warn(`Failed to connect to MCP server "${serverName}": ${errMsg}`);
			}
		}
	}

	getToolDefinitions(): ToolDefinition[] {
		const allTools: ToolDefinition[] = [];
		for (const tools of this.serverTools.values()) {
			allTools.push(...tools);
		}
		return allTools;
	}

	getServerNames(): string[] {
		return [...this.clients.keys()];
	}

	async stop(): Promise<void> {
		const disconnectPromises: Promise<void>[] = [];
		for (const [name, client] of this.clients) {
			disconnectPromises.push(
				client.disconnect().catch((err) => {
					console.warn(
						`Error disconnecting from MCP server "${name}": ${err instanceof Error ? err.message : String(err)}`,
					);
				}),
			);
		}
		this.clients.clear();
		this.serverTools.clear();
		await Promise.all(disconnectPromises);
	}
}
