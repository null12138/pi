import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";

const PASSWORD = process.env.PI_WEB_PASSWORD;

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
	if (!PASSWORD) return true;

	const auth = req.headers.authorization;
	if (auth) {
		const [scheme, credentials] = auth.split(" ");
		if (scheme === "Basic" && credentials) {
			const decoded = Buffer.from(credentials, "base64").toString("utf-8");
			const [, password] = decoded.split(":");
			if (password === PASSWORD) return true;
		}
	}

	res.writeHead(401, {
		"www-authenticate": 'Basic realm="pi", charset="UTF-8"',
		"content-type": "text/plain",
	});
	res.end("Unauthorized");
	return false;
}

function getLocalIP(): string {
	const interfaces = networkInterfaces();
	for (const iface of Object.values(interfaces)) {
		if (!iface) continue;
		for (const addr of iface) {
			if (addr.family === "IPv4" && !addr.internal) {
				return addr.address;
			}
		}
	}
	return "127.0.0.1";
}

function getPort(): number {
	const env = process.env.PORT;
	if (env) {
		const p = parseInt(env, 10);
		if (!Number.isNaN(p) && p > 0 && p < 65536) return p;
	}
	return 0;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>pi</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font:13px/1.5 system-ui,monospace;background:#0d1117;color:#c9d1d9;height:100vh;display:flex;flex-direction:column}
#header{background:#161b22;border-bottom:1px solid #30363d;padding:8px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#header span{color:#8b949e;font-size:12px}
#msgs{flex:1;overflow-y:auto;padding:16px}
.msg{margin-bottom:12px;max-width:85%}
.msg.user{background:#1f6feb22;border:1px solid #1f6feb44;border-radius:8px 8px 0 8px;padding:8px 12px;margin-left:auto}
.msg.assistant{margin-right:auto}
.msg.system{color:#8b949e;font-size:11px;margin:4px auto;text-align:center;max-width:100%}
.tool{border:1px solid #30363d;border-radius:6px;margin:6px 0;overflow:hidden}
.tool-header{padding:6px 10px;background:#161b22;cursor:pointer;font-size:12px;display:flex;justify-content:space-between}
.tool-header:hover{background:#21262d}
.tool-body{padding:6px 10px;background:#0d1117;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;display:none}
.tool.expanded .tool-body{display:block}
.tool-arrow{color:#8b949e;transition:.2s}
.tool.expanded .tool-arrow{transform:rotate(90deg)}
.tool-pending{border-color:#d2992266}
.tool-error .tool-header{color:#f85149}
.thinking{color:#8b949e;font-size:12px;border-left:2px solid #30363d;padding:4px 8px;margin:4px 0;font-style:italic}
#input-area{border-top:1px solid #30363d;padding:12px 16px;background:#161b22;flex-shrink:0}
#input-area form{display:flex;gap:8px}
#prompt{flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 12px;color:#c9d1d9;font:13px system-ui,monospace;outline:none}
#prompt:focus{border-color:#1f6feb}
button{background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font:13px system-ui;font-weight:500}
button:hover{background:#2ea043}
button:disabled{opacity:.5;cursor:default}
</style>
</head>
<body>
<div id="header"><b>pi</b><span id="stats"></span></div>
<div id="msgs"></div>
<div id="input-area">
<form id="f" autocomplete="off"><input id="prompt" type="text" placeholder="Type a message..." autofocus><button id="send">Send</button></form>
</div>
<script>
const msgs=document.getElementById("msgs"),f=document.getElementById("f"),prompt=document.getElementById("prompt"),send=document.getElementById("send"),stats=document.getElementById("stats");
let busy=false,toolEls={},curAssistant=null,curTextIdx=null,curThinkIdx=null;
function addMsg(cls,html){const d=document.createElement("div");d.className="msg "+cls;d.innerHTML=html;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d}
function addSystem(text){addMsg("system",text)}
function fmtTokens(n){if(n<1e3)return n;if(n<1e4)return(n/1e3).toFixed(1)+"k";return Math.round(n/1e3)+"k"}
function esc(s){if(!s)return"";return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function handleData(e){
switch(e.type){
case"agent_start":curAssistant=null;curTextIdx=null;curThinkIdx=null;break;
case"text_start":curTextIdx=e.contentIndex;if(!curAssistant){curAssistant=addMsg("assistant","");curTextIdx=null}break;
case"text_delta":if(!curAssistant)curAssistant=addMsg("assistant","");curAssistant.innerHTML+=esc(e.delta).replace(/\\n/g,"<br>");msgs.scrollTop=msgs.scrollHeight;break;
case"thinking_start":{const d=document.createElement("div");d.className="thinking";d.id="think"+e.contentIndex;msgs.appendChild(d);break}
case"thinking_delta":{const d=document.getElementById("think"+e.contentIndex);if(d)d.textContent+=e.delta;msgs.scrollTop=msgs.scrollHeight;break}
case"toolcall_start":break;
case"toolcall_end":break;
case"tool_execution_start":{const el=document.createElement("div");el.className="tool tool-collapsed tool-pending";el.id="t"+e.toolCallId;const h=document.createElement("div");h.className="tool-header";h.innerHTML='<span>'+esc(e.toolName)+(e.args?' '+esc(String(e.args.command||e.args.path||e.args.file_path||JSON.stringify(e.args).slice(0,60))):'')+'</span><span class="tool-arrow">&#9654;</span>';h.onclick=()=>el.classList.toggle("expanded");el.appendChild(h);const b=document.createElement("div");b.className="tool-body";el.appendChild(b);msgs.appendChild(el);toolEls[e.toolCallId]=el;msgs.scrollTop=msgs.scrollHeight;break}
case"tool_execution_update":{const el=toolEls[e.toolCallId];if(el){const b=el.querySelector(".tool-body");if(b&&e.result){const texts=Array.isArray(e.result)?e.result:e.result.content||[];b.innerText=texts.filter(c=>c&&c.type==="text").map(c=>c.text).join("");el.classList.add("expanded")}}break}
case"tool_execution_end":{const el=toolEls[e.toolCallId];if(el){el.classList.remove("tool-pending");if(e.isError)el.classList.add("tool-error");const b=el.querySelector(".tool-body");if(b&&e.result){const texts=e.result.content||[];b.innerText=texts.filter(c=>c&&c.type==="text").map(c=>c.text).join("")}el.classList.add("expanded")}break}
case"agent_end":{let usage="";if(e.usage){usage=" — ↑"+fmtTokens(e.usage.input)+" ↓"+fmtTokens(e.usage.output);if(e.usage.cost)usage+=" $"+e.usage.cost.total.toFixed(4)}addSystem("Done"+usage);break}
case"compaction":addSystem("Compacting...");break;
case"error":addSystem("Error: "+esc(e.message));break;}};
f.onsubmit=async e=>{e.preventDefault();if(busy)return;const text=prompt.value.trim();if(!text)return;prompt.value="";addMsg("user",esc(text));busy=true;send.disabled=true;
try{const r=await fetch("/api/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
const reader=r.body.getReader(),decoder=new TextDecoder();let buf="";
while(true){const{done,value}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const lines=buf.split("\\n");buf=lines.pop()||"";
for(const line of lines){if(!line.trim())continue;try{handleData(JSON.parse(line))}catch{}}}}
catch(err){addSystem("Error: "+err.message)}finally{busy=false;send.disabled=false}};
fetch("/api/stats").then(r=>r.json()).then(s=>{stats.textContent="sessions: "+s.sessions+" | $"+s.cost.toFixed(2)}).catch(()=>{});
</script>
</body>
</html>`;

function sendEvent(res: ServerResponse, data: Record<string, unknown>): void {
	res.write(`${JSON.stringify(data)}\n`);
}

export async function runWebMode(runtime: AgentSessionRuntime): Promise<void> {
	const session = runtime.session;
	const port = getPort();

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		if (!checkAuth(req, res)) return;

		const url = req.url ?? "/";

		if (req.method === "POST" && url === "/api/prompt") {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			await new Promise<void>((resolve) => req.on("end", resolve));
			const body = JSON.parse(Buffer.concat(chunks).toString());
			const text = String(body.text ?? "").trim();
			if (!text) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: "missing text" }));
				return;
			}

			res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" });

			const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
				const events = toSerializableEvents(event);
				for (const evt of events) {
					sendEvent(res, evt);
				}
			});

			try {
				await session.prompt(text);
			} catch (err) {
				sendEvent(res, { type: "error", message: String(err) });
			} finally {
				unsubscribe();
				res.end();
			}
			return;
		}

		if (req.method === "GET" && url === "/api/stats") {
			const stats = await session.getUsageStats();
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({ sessions: stats.sessions, cost: stats.cost, input: stats.input, output: stats.output }),
			);
			return;
		}

		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(HTML);
	});

	await new Promise<void>((resolve, reject) => {
		server.listen(port, "0.0.0.0", () => resolve());
		server.on("error", reject);
	});

	const addr = server.address();
	if (!addr || typeof addr === "string") {
		console.error("Failed to start web server");
		return;
	}

	const consolePort = `http://127.0.0.1:${addr.port}`;
	const lan = getLocalIP();
	console.log(`\n  pi web UI:  ${consolePort}`);
	if (lan !== "127.0.0.1") {
		console.log(`  LAN:        http://${lan}:${addr.port}`);
	}
	console.log("  (listening on all interfaces)");
	if (PASSWORD) {
		console.log(`  auth:       Basic (user "pi", password from PI_WEB_PASSWORD)`);
	} else {
		console.log("  auth:       none (set PI_WEB_PASSWORD to enable)");
	}
	console.log();

	// Keep process alive
	await new Promise(() => {});

	server.close();
}

function toSerializableEvents(event: AgentSessionEvent): Record<string, unknown>[] {
	switch (event.type) {
		case "agent_start":
			return [{ type: "agent_start" }];
		case "agent_end": {
			const lastAssistant = event.messages.filter((m) => m.role === "assistant").at(-1);
			const usage = lastAssistant && "usage" in lastAssistant ? lastAssistant.usage : undefined;
			return [{ type: "agent_end", usage }];
		}
		case "message_update": {
			const ame: Record<string, unknown> = event.assistantMessageEvent;
			const serialized = serializeAssistantMessageEvent(ame);
			return serialized;
		}
		case "tool_execution_start":
			return [
				{
					type: "tool_execution_start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
				},
			];
		case "tool_execution_update":
			return [
				{
					type: "tool_execution_update",
					toolCallId: event.toolCallId,
					result: event.partialResult,
				},
			];
		case "tool_execution_end":
			return [
				{
					type: "tool_execution_end",
					toolCallId: event.toolCallId,
					result: event.result,
					isError: event.isError,
				},
			];
		case "compaction_start":
		case "compaction_end":
			return [{ type: "compaction" }];
		default:
			return [];
	}
}

function serializeAssistantMessageEvent(event: Record<string, unknown>): Record<string, unknown>[] {
	const type = event.type as string;
	switch (type) {
		case "start":
			return [{ type: "agent_start" }];
		case "text_start":
			return [{ type: "text_start", contentIndex: event.contentIndex }];
		case "text_delta":
			return [{ type: "text_delta", delta: event.delta, contentIndex: event.contentIndex }];
		case "text_end":
			return [{ type: "text_end", content: event.content, contentIndex: event.contentIndex }];
		case "thinking_start":
			return [{ type: "thinking_start", contentIndex: event.contentIndex }];
		case "thinking_delta":
			return [{ type: "thinking_delta", delta: event.delta, contentIndex: event.contentIndex }];
		case "thinking_end":
			return [{ type: "thinking_end", content: event.content, contentIndex: event.contentIndex }];
		case "toolcall_start":
			return [{ type: "toolcall_start", contentIndex: event.contentIndex }];
		case "toolcall_delta":
			return [{ type: "toolcall_delta", delta: event.delta, contentIndex: event.contentIndex }];
		case "toolcall_end":
			return [{ type: "toolcall_end", toolCall: event.toolCall, contentIndex: event.contentIndex }];
		case "done":
			return [{ type: "done", reason: event.reason }];
		case "error":
			return [{ type: "error", reason: event.reason }];
		default:
			return [];
	}
}
