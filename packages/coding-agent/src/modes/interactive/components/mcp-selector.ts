/**
 * Interactive MCP server selector.
 * Shows configured servers with status, allows toggling.
 */

import { Container, getKeybindings, Spacer, Text } from "@openeryc/pi-tui";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export interface McpServerItem {
	name: string;
	status: "connected" | "disconnected" | "disabled";
	toolCount: number;
	transport: string;
}

export class McpSelectorComponent extends Container {
	private items: McpServerItem[];
	private selectedIndex = 0;
	private listContainer: Container;
	private onSelectCallback: (name: string) => void;
	private onCancelCallback: () => void;

	constructor(servers: McpServerItem[], onSelect: (name: string) => void, onCancel: () => void) {
		super();

		this.items = servers;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold("MCP Servers")), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "Enter = toggle  |  Esc = close"), 1, 0));
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("tui.select.confirm", "toggle") +
					"  " +
					keyHint("tui.select.cancel", "close"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private statusColor(status: McpServerItem["status"]): string {
		switch (status) {
			case "connected":
				return theme.fg("success", "connected");
			case "disconnected":
				return theme.fg("warning", "disconnected");
			case "disabled":
				return theme.fg("muted", "disabled");
		}
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			const isSelected = i === this.selectedIndex;
			const status = this.statusColor(item.status);
			const info = `(${status}  |  ${item.transport}${item.toolCount > 0 ? `  |  ${item.toolCount} tools` : ""})`;
			const text = isSelected
				? theme.fg("accent", "→ ") + theme.fg("accent", theme.bold(item.name)) + "  " + info
				: `  ${theme.fg("text", item.name)}  ${theme.fg("dim", info)}`;
			this.listContainer.addChild(new Text(text, 1, 0));
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			const selected = this.items[this.selectedIndex];
			if (selected) this.onSelectCallback(selected.name);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
	}
}
