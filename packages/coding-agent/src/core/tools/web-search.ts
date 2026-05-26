import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Search query" }),
	maxResults: Type.Optional(Type.Number({ description: "Maximum number of results (default: 10)" })),
});

export type WebSearchInput = Static<typeof webSearchSchema>;

const DEFAULT_MAX_RESULTS = 10;

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

function extractSearchResults(
	html: string,
	maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
	const results: Array<{ title: string; url: string; snippet: string }> = [];

	const linkPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

	const links: Array<{ url: string; title: string }> = [];
	let linkMatch = linkPattern.exec(html);
	while (linkMatch !== null) {
		links.push({ url: linkMatch[1], title: stripHtml(linkMatch[2]) });
		linkMatch = linkPattern.exec(html);
	}

	const snippets: string[] = [];
	let snippetMatch = snippetPattern.exec(html);
	while (snippetMatch !== null) {
		snippets.push(stripHtml(snippetMatch[1]));
		snippetMatch = snippetPattern.exec(html);
	}

	for (let i = 0; i < Math.min(links.length, snippets.length, maxResults); i++) {
		results.push({
			title: links[i].title,
			url: links[i].url.startsWith("//") ? `https:${links[i].url}` : links[i].url,
			snippet: snippets[i],
		});
	}

	return results;
}

export function createWebSearchToolDefinition(): ToolDefinition<
	typeof webSearchSchema,
	{ results: Array<{ title: string; url: string; snippet: string }> }
> {
	return {
		name: "websearch",
		label: "WebSearch",
		description:
			"Searches the web using DuckDuckGo and returns results with titles, URLs, and snippets. Use this to find information, documentation, or answers to questions.",
		promptSnippet: "websearch(query) - Search the web",
		parameters: webSearchSchema,
		renderShell: "default",
		executionMode: "sequential",
		async execute(_id, params, signal) {
			const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;

			const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`, {
				headers: {
					"User-Agent": "Mozilla/5.0 (compatible; pi/1.0; coding-agent)",
				},
				signal,
			});

			const body = await response.text();
			const results = extractSearchResults(body, maxResults);

			if (results.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No results found." }],
					details: { results: [] },
				};
			}

			const text = results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join("\n\n");

			return {
				content: [{ type: "text" as const, text }],
				details: { results },
			};
		},
	};
}

export function createWebSearchTool(): ReturnType<typeof wrapToolDefinition> {
	return wrapToolDefinition(createWebSearchToolDefinition());
}
