import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const webFetchSchema = Type.Object({
	url: Type.String({ description: "URL to fetch" }),
	maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return (default: 10000)" })),
});

export type WebFetchInput = Static<typeof webFetchSchema>;

const DEFAULT_MAX_CHARS = 10000;

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function createWebFetchToolDefinition(): ToolDefinition<
	typeof webFetchSchema,
	{ url: string; truncated: boolean }
> {
	return {
		name: "webfetch",
		label: "WebFetch",
		description:
			"Fetches content from a URL and returns it as text (HTML stripped). Use this to read web pages, documentation, or API responses.",
		promptSnippet: "webfetch(url) - Fetch web page content",
		parameters: webFetchSchema,
		renderShell: "default",
		executionMode: "sequential",
		async execute(_id, params, signal) {
			const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;

			const response = await fetch(params.url, {
				headers: { "User-Agent": "pi/1.0 (coding-agent)" },
				signal,
			});

			const body = await response.text();
			const contentType = response.headers.get("content-type") ?? "";
			const text = contentType.includes("text/html") ? stripHtml(body) : body;

			const truncated = text.length > maxChars;
			const content = truncated ? `${text.slice(0, maxChars)}\n... (truncated)` : text;

			return {
				content: [{ type: "text" as const, text: content }],
				details: { url: params.url, truncated },
			};
		},
	};
}

export function createWebFetchTool(): ReturnType<typeof wrapToolDefinition> {
	return wrapToolDefinition(createWebFetchToolDefinition());
}
