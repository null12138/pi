import { spawn } from "child_process";
import type { SettingsManager } from "./settings-manager.ts";

export interface HookConfig {
	matcher?: string;
	command: string;
	timeout?: number;
}

export interface PreToolResult {
	behavior: "allow" | "deny";
	updatedInput?: unknown;
	message?: string;
}

export interface PostToolResult {
	additionalContext?: string;
}

function matches(matcher: string | undefined, toolName: string): boolean {
	if (!matcher) return true;
	if (matcher === "*") return true;
	if (matcher === toolName) return true;
	if (matcher.startsWith("*") && toolName.endsWith(matcher.slice(1))) return true;
	if (matcher.endsWith("*") && toolName.startsWith(matcher.slice(0, -1))) return true;
	try {
		return new RegExp(matcher).test(toolName);
	} catch {
		return false;
	}
}

async function runHook(
	command: string,
	input: string,
	timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const proc = spawn("sh", ["-c", command], {
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr?.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		const timer = setTimeout(() => {
			proc.kill();
			resolve({ exitCode: -1, stdout, stderr: `${stderr}\nHook timed out after ${timeoutMs}ms` });
		}, timeoutMs);

		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ exitCode: code ?? -1, stdout, stderr });
		});

		proc.stdin?.write(input);
		proc.stdin?.end();
	});
}

function parseJsonResponse(output: string): unknown | undefined {
	const trimmed = output.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

export class HookRunner {
	private preToolHooks: HookConfig[] = [];
	private postToolHooks: HookConfig[] = [];
	private defaultTimeout = 15000;

	constructor(settingsManager: SettingsManager) {
		const settings = settingsManager.getProjectSettings();
		const hooks = (settings as Record<string, unknown>).hooks as
			| { PreToolUse?: HookConfig[]; PostToolUse?: HookConfig[] }
			| undefined;
		if (hooks?.PreToolUse) this.preToolHooks = hooks.PreToolUse;
		if (hooks?.PostToolUse) this.postToolHooks = hooks.PostToolUse;
	}

	async runPreToolHooks(toolName: string, input: unknown): Promise<PreToolResult | null> {
		for (const hook of this.preToolHooks) {
			if (!matches(hook.matcher, toolName)) continue;

			const hookInput = JSON.stringify({ tool_name: toolName, input });
			const result = await runHook(hook.command, hookInput, hook.timeout ?? this.defaultTimeout);

			if (result.exitCode === 2) {
				return {
					behavior: "deny",
					message: result.stderr || result.stdout || `Blocked by hook: ${hook.command}`,
				};
			}

			if (result.exitCode === 0) {
				const response = parseJsonResponse(result.stdout);
				if (response && typeof response === "object" && !Array.isArray(response)) {
					const r = response as Record<string, unknown>;
					if (r.continue === false || r.allow === false) {
						return { behavior: "deny", message: r.message as string };
					}
					if (r.updatedInput !== undefined) {
						return { behavior: "allow", updatedInput: r.updatedInput };
					}
				}
			}

			// Exit code != 0,2: warn only, continue
		}
		return null;
	}

	async runPostToolHooks(toolName: string, result: string): Promise<PostToolResult | null> {
		for (const hook of this.postToolHooks) {
			if (!matches(hook.matcher, toolName)) continue;

			const hookInput = JSON.stringify({ tool_name: toolName, output: result });
			const res = await runHook(hook.command, hookInput, hook.timeout ?? this.defaultTimeout);

			if (res.exitCode === 0) {
				const response = parseJsonResponse(res.stdout);
				if (response && typeof response === "object" && !Array.isArray(response)) {
					const r = response as Record<string, unknown>;
					if (r.additionalContext) {
						return { additionalContext: String(r.additionalContext) };
					}
				}
			}
		}
		return null;
	}
}
