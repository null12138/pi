/**
 * MCP (Model Context Protocol) client types.
 *
 * Implements a minimal MCP client supporting stdio transport
 * and tool listing/calling (tools only, no resources/prompts).
 */

export interface MCPServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface MCPJsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

export interface MCPJsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: MCPJsonRpcError;
}

export interface MCPJsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface MCPInitializeResult {
	protocolVersion: string;
	capabilities: MCPCapabilities;
	serverInfo?: MCPInfo;
}

export interface MCPCapabilities {
	tools?: MCPToolsCapability;
}

export interface MCPToolsCapability {
	listChanged?: boolean;
}

export interface MCPInfo {
	name: string;
	version: string;
}

export interface MCPToolDefinition {
	name: string;
	description?: string;
	inputSchema: MCPJsonSchema;
}

export interface MCPJsonSchema {
	type: string;
	properties?: Record<string, MCPJsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean;
	items?: MCPJsonSchema;
	description?: string;
	enum?: string[];
}

export interface MCPJsonSchemaProperty {
	type?: string;
	description?: string;
	enum?: string[];
	items?: MCPJsonSchema;
	default?: unknown;
}

export interface MCPListToolsResult {
	tools: MCPToolDefinition[];
}

export interface MCPCallToolRequest {
	name: string;
	arguments: Record<string, unknown>;
}

export interface MCPCallToolResult {
	content: MCPCallToolContent[];
	isError?: boolean;
}

export interface MCPCallToolTextContent {
	type: "text";
	text: string;
}

export interface MCPCallToolImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export type MCPCallToolContent = MCPCallToolTextContent | MCPCallToolImageContent;
