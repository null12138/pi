/**
 * Interactive selector component for managing items (MCP servers, skills, etc).
 * Shows items with status, Space toggles, Esc closes.
 */

import { Container, getKeybindings, Spacer, Text } from "@openeryc/pi-tui";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export interface McpServerItem {
	name: string;
	status: "connected" | "disconnected" | "disabled" | "reconnecting";
	toolCount: number;
	transport: string;
}

export class McpSelectorComponent extends Container {
	private items: McpServerItem[];
	private selectedIndex = 0;
	private listContainer: Container;
	private onToggleCallback: (name: string) => void;
	private onCancelCallback: () => void;
	private hintText: Text;
	private itemsText: Text;

	constructor(title: string, servers: McpServerItem[], onToggle: (name: string) => void, onCancel: () => void) {
		super();

		this.items = servers;
		this.onToggleCallback = onToggle;
		this.onCancelCallback = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		this.addChild(new Spacer(1));

		this.hintText = new Text(theme.fg("dim", "Space = toggle  |  Esc = close"), 1, 0);
		this.addChild(this.hintText);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		this.itemsText = new Text(
			rawKeyHint("↑↓", "navigate") +
				"  " +
				rawKeyHint("Space", "toggle") +
				"  " +
				keyHint("tui.select.cancel", "close"),
			1,
			0,
		);
		this.addChild(this.itemsText);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private statusColor(status: McpServerItem["status"]): string {
		switch (status) {
			case "connected":
				return theme.fg("success", "connected");
			case "reconnecting":
				return theme.fg("warning", "reconnecting...");
			case "disconnected":
				return theme.fg("error", "disconnected");
			case "disabled":
				return theme.fg("muted", "disabled");
		}
	}

	updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			const isSelected = i === this.selectedIndex;
			const status = this.statusColor(item.status);
			const info = `(${status}  |  ${item.transport}${item.toolCount > 0 ? `  |  ${item.toolCount} tools` : ""})`;
			const text = isSelected
				? `${theme.fg("accent", "→ ") + theme.fg("accent", theme.bold(item.name))}  ${info}`
				: `  ${theme.fg("text", item.name)}  ${theme.fg("dim", info)}`;
			this.listContainer.addChild(new Text(text, 1, 0));
		}
	}

	setItems(items: McpServerItem[]): void {
		this.items = items;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, items.length - 1));
		this.updateList();
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (keyData === " ") {
			const selected = this.items[this.selectedIndex];
			if (selected) this.onToggleCallback(selected.name);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
	}
}
