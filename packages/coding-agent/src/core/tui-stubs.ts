/**
 * TUI stub module — provides minimal implementations of TUI types used
 * by core (tools, extensions, keybindings) when the TUI package is removed.
 *
 * In non-interactive modes (print, json, rpc, web), renderCall/renderResult
 * are never invoked. These stubs exist solely to satisfy the type system.
 */

export type AutocompleteItem = unknown;
export type AutocompleteProvider = unknown;
export type EditorComponent = unknown;
export type EditorTheme = unknown;
export type Focusable = unknown;
export type ImageOptions = unknown;
export type ImageTheme = unknown;
export type OverlayAnchor = unknown;
export type OverlayHandle = unknown;
export type OverlayMargin = unknown;
export type OverlayOptions = unknown;
export type SelectItem = unknown;
export type SelectListLayoutOptions = unknown;
export type SizeValue = unknown;
export type Terminal = unknown;
export type TerminalCapabilities = unknown;
export type KeyEventType = string;
export type KeyId = string;
export type Keybinding =
	| string
	| string[]
	| { key?: string; defaultKeys?: string | readonly string[]; description?: string; restrictOverride?: boolean };
export type KeybindingDefinitions = Record<string, Keybinding>;
export type KeybindingsConfig = Record<string, Keybinding>;
export type AppKeybindingId = string;

export type Component = unknown;

export interface TUI {
	[key: string]: unknown;
}

export const TUI_KEYBINDINGS: KeybindingDefinitions = {};

export class KeybindingsManager {
	// biome-ignore lint/complexity/noUselessConstructor: stub needs matching constructor
	constructor(_definitions?: KeybindingDefinitions, _userBindings?: Partial<KeybindingsConfig>) {}
	getEffectiveConfig(): KeybindingsConfig {
		return {};
	}
	setUserBindings(_bindings: Partial<KeybindingsConfig>): void {}
	getUserBindings(): KeybindingsConfig {
		return {};
	}
	getResolvedBindings(): KeybindingsConfig {
		return {};
	}
}

export class ProcessTerminal {}
export function setKeybindings(_manager: KeybindingsManager): void {}

export class Box {
	// biome-ignore lint/complexity/noUselessConstructor: stub
	constructor(_width?: number, _height?: number, _direction?: unknown) {}
	setBgFn(_fn: unknown): this {
		return this;
	}
	addChild(_child: unknown): void {}
	clear(): void {}
}
export class Container {
	addChild(_child: unknown): void {}
	clear(): void {}
	invalidate(): void {}
}
export class Spacer {
	// biome-ignore lint/complexity/noUselessConstructor: stub
	constructor(_height: number) {}
}
export class Text {
	// biome-ignore lint/complexity/noUselessConstructor: stub
	constructor(_text: string, _x?: number, _y?: number) {}
	setText(_text: string): void {}
}
export class Loader {
	// biome-ignore lint/complexity/noUselessConstructor: stub
	constructor(_text: string) {}
}
export class CancellableLoader {
	// biome-ignore lint/complexity/noUselessConstructor: stub
	constructor(_text: string) {}
}
export class Markdown {
	// biome-ignore lint/complexity/noUselessConstructor: stub
	constructor(_text: string, _x: number, _y: number, _theme?: unknown) {}
	render(_width: number): string[] {
		return [];
	}
}
export type MarkdownTheme = Record<string, (...args: readonly string[]) => string>;

export function truncateToWidth(text: string, width: number, _ellipsis = "..."): string {
	if (text.length <= width) return text;
	return text.slice(0, Math.max(0, width - 3)) + "...";
}

export function fuzzyFilter<T>(_items: T[], _query: string, _getText: (item: T) => string): T[] {
	return [];
}
export function fuzzyMatch(_text: string, _query: string): boolean {
	return false;
}

export function getCapabilities(): { images?: boolean } {
	return {};
}
export function getImageDimensions(_data: Buffer | string, _mimeType: string): { width: number; height: number } {
	return { width: 0, height: 0 };
}
export function imageFallback(_mimeType: string, _dims?: { width: number; height: number }): string {
	return "[image]";
}
export function visibleWidth(_text: string): number {
	return _text.length;
}
export function getKeybindings(): unknown {
	return {};
}
