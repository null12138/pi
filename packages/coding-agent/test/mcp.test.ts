import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCPClient, type MCPServerConfig } from "../src/core/mcp/client.ts";
import { MCPManager } from "../src/core/mcp/manager.ts";

function mockServerScript(tools: Array<{ name: string; description?: string }>): string {
	return [
		`const tools = ${JSON.stringify(tools)};`,
		`const handlers = {`,
		`  initialize: (params) => ({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }),`,
		`  'tools/list': () => ({ tools: tools.map((t) => ({ name: t.name, description: t.description || 'Test tool', inputSchema: { type: 'object', properties: {} } })) }),`,
		`  'tools/call': (params) => ({ content: [{ type: 'text', text: 'Result from ' + params.name + ': ' + JSON.stringify(params.arguments) }] }),`,
		`};`,
		`require('readline').createInterface({ input: process.stdin }).on('line', (line) => {`,
		`  try { const req = JSON.parse(line); const res = handlers[req.method];`,
		`    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: res ? res(req.params||{}) : {} }) + '\\n'); }`,
		`  catch(e) { process.stderr.write(String(e)); }`,
		`});`,
	].join("\n");
}

let tempDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `pi-mcp-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

function serverConfig(scriptName: string, tools: Array<{ name: string; description?: string }>): MCPServerConfig {
	writeFileSync(join(tempDir, scriptName), mockServerScript(tools));
	return { command: "node", args: [join(tempDir, scriptName)] };
}

describe("MCPClient", () => {
	it("connects, initializes, lists and calls tools", async () => {
		const client = new MCPClient();
		await client.connect(serverConfig("s1.js", [{ name: "tool_a", description: "First tool" }, { name: "tool_b" }]));

		const { tools } = await client.listTools();
		expect(tools).toHaveLength(2);
		expect(tools[0].name).toBe("tool_a");

		const result = await client.callTool("tool_a", { a: 1, b: 2 });
		const first = result.content[0] as { type: string; text: string };
		expect(first.text).toContain("tool_a");
		expect(first.text).toContain('"a":1');

		await client.disconnect();
	});

	it("fails with bad command", async () => {
		const client = new MCPClient();
		await expect(client.connect({ command: "/nonexistent/cmd" })).rejects.toThrow();
	});
});

describe("MCPManager", () => {
	it("registers namespaced tools", async () => {
		const mgr = new MCPManager();
		await mgr.start({ srv: serverConfig("m1.js", [{ name: "t1" }, { name: "t2" }]) });

		const tools = mgr.getToolDefinitions();
		expect(tools).toHaveLength(2);
		expect(tools[0].name).toBe("mcp.srv.t1");
		expect(tools[1].name).toBe("mcp.srv.t2");

		await mgr.stop();
	});

	it("supports multiple servers", async () => {
		const mgr = new MCPManager();
		await mgr.start({
			s1: serverConfig("m2.js", [{ name: "tool_a" }]),
			s2: serverConfig("m3.js", [{ name: "tool_b" }]),
		});

		const names = mgr.getToolDefinitions().map((t) => t.name);
		expect(names).toContain("mcp.s1.tool_a");
		expect(names).toContain("mcp.s2.tool_b");

		await mgr.stop();
	});

	it("executes namespaced tools", async () => {
		const mgr = new MCPManager();
		await mgr.start({ test: serverConfig("m4.js", [{ name: "hello" }]) });

		const tool = mgr.getToolDefinitions()[0];
		const result = await tool.execute("id", { name: "World" }, undefined, undefined, {} as any);
		const first = result.content[0] as { type: string; text: string };
		expect(first.text).toContain("hello");

		await mgr.stop();
	});

	it("handles server start failure gracefully", async () => {
		const mgr = new MCPManager();
		await mgr.start({ bad: { command: "/nonexistent/cmd" } });
		expect(mgr.getToolDefinitions()).toHaveLength(0);
		await mgr.stop();
	});

	it("stop clears all connections", async () => {
		const mgr = new MCPManager();
		await mgr.start({ s: serverConfig("m5.js", [{ name: "t" }]) });
		expect(mgr.getServerNames()).toHaveLength(1);

		await mgr.stop();
		expect(mgr.getServerNames()).toHaveLength(0);
		expect(mgr.getToolDefinitions()).toHaveLength(0);
	});
});
