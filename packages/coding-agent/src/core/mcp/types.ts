/**
 * MCP (Model Context Protocol) client types.
 */

export interface MCPReconnectConfig {
	/** Whether auto-reconnect is enabled (default: true) */
	enabled?: boolean;
	/** Maximum reconnection attempts before giving up (default: 5) */
	maxAttempts?: number;
	/** Delay between reconnection attempts in milliseconds (default: 5000) */
	intervalMs?: number;
}

export interface MCPServerConfig {
	enabled?: boolean;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	transport?: "stdio" | "sse" | "http";
	headers?: Record<string, string>;
	/** Request timeout in milliseconds (default: 120000). 0 = no timeout. */
	timeoutMs?: number;
	/** Per-tool timeout overrides (key: tool name, value: timeout in ms). Takes precedence over timeoutMs. */
	toolTimeouts?: Record<string, number>;
	/** Auto-reconnect configuration */
	reconnect?: MCPReconnectConfig;
}

/** Connection status for an MCP server */
export type MCPConnectionStatus = "connected" | "disconnected" | "reconnecting" | "disabled";

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
