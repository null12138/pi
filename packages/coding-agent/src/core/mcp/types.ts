/**
 * MCP (Model Context Protocol) client types.
 */
export interface MCPServerConfig {
	enabled?: boolean;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	transport?: "stdio" | "sse" | "http";
	headers?: Record<string, string>;
}

export interface MCPResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface MCPResourceTemplate {
	uriTemplate: string;
	name: string;
	description?: string;
}

export interface MCPReadResourceResult {
	contents: Array<{
		uri: string;
		mimeType?: string;
		text?: string;
		blob?: string;
	}>;
}

export interface MCPToolDefinition {
	name: string;
	description?: string;
	inputSchema: {
		type: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

export interface MCPCallToolResult {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	isError?: boolean;
}
