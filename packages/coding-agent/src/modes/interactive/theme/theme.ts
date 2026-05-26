export type ThemeColor = string;
export type ThemeBg = string;

export class Theme {
	readonly name?: string;
	readonly sourcePath?: string;
	sourceInfo?: unknown;

	private fgColors = new Map<string, string>();
	private bgColors = new Map<string, string>();

	constructor(fgColors?: Record<string, string | number>, bgColors?: Record<string, string | number>) {
		if (fgColors) {
			for (const [key] of Object.entries(fgColors)) {
				this.fgColors.set(key, "");
			}
		}
		if (bgColors) {
			for (const [key] of Object.entries(bgColors)) {
				this.bgColors.set(key, "");
			}
		}
	}

	fg(_color: ThemeColor, text: string): string {
		return text;
	}

	bg(_color: ThemeBg, text: string): string {
		return text;
	}

	bold(text: string): string {
		return text;
	}

	prompt = {
		user: "",
		userPrefix: "",
		assistant: "",
		assistantPrefix: "",
		thinking: "",
		thinkingPrefix: "",
	};
}

export const theme = new Theme();

export function initTheme(_themeName?: string, _watch?: boolean): void {}
export function stopThemeWatcher(): void {}
export function loadThemeFromPath(_path: string): Theme {
	return theme;
}
export function getLanguageFromPath(_path: string): string {
	return "text";
}
export function highlightCode(_code: string, _language: string): string[] {
	return _code.split("\n");
}
export function getResolvedThemeColors(_themeName?: string): Record<string, string> {
	return {};
}
export function getThemeExportColors(_themeName?: string): Record<string, string> {
	return {};
}
export function detectTerminalBackground(): string {
	return "dark";
}
export function getThemeByName(_name: string): Theme {
	return theme;
}
export function getThemeForRgbColor(_r: number, _g: number, _b: number): string {
	return "dark";
}
export function parseOsc11BackgroundColor(_value: string): { r: number; g: number; b: number } | undefined {
	return undefined;
}
