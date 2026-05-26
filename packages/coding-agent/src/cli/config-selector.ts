export async function selectConfig(_opts?: unknown): Promise<void> {
	console.error("Config selector is not available in this build (TUI removed).");
	console.error("Use settings.json at ~/.pi/agent/settings.json to configure pi.");
	process.exit(1);
}
