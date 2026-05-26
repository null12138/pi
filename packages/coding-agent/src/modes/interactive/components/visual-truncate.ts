export interface VisualTruncateResult {
	visualLines: string[];
	skippedCount: number;
}

export function truncateToVisualLines(text: string, maxLines: number, _width: number): VisualTruncateResult {
	const lines = text.split("\n");
	const visualLines = lines.slice(0, maxLines);
	return { visualLines, skippedCount: Math.max(0, lines.length - maxLines) };
}
