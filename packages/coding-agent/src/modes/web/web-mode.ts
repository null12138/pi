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
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>pi</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:14px}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d1117;color:#e6edf3;display:flex;flex-direction:column;height:100dvh;overflow:hidden}
#header{display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:44px;background:#161b22;border-bottom:1px solid #21262d;flex-shrink:0}
#header h1{font-size:14px;font-weight:600;color:#f0f6fc}
#header sub{font-size:10px;color:#8b949e;margin-left:6px}
#header-right{display:flex;gap:14px;font-size:11px;color:#8b949e}
#msgs{flex:1;overflow-y:auto;padding:20px;scroll-behavior:smooth;display:flex;flex-direction:column;gap:18px}
#msgs::-webkit-scrollbar{width:5px}
#msgs::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px}
.msg-row{animation:fadeIn .15s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.msg-row.user{align-self:flex-end;max-width:80%}
.msg-row.assistant{align-self:flex-start;max-width:86%}
.msg-row.system{align-self:center;max-width:90%}
.msg-avatar{width:26px;height:26px;border-radius:6px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-bottom:4px}
.msg-avatar.user{background:#1f6feb33;color:#58a6ff;margin-left:auto}
.msg-avatar.assistant{background:#30363d;color:#8b949e}
.msg-bubble{border-radius:8px;font-size:13.5px;line-height:1.55;padding:10px 14px;overflow-wrap:break-word}
.msg-bubble.user{background:#1f6feb;color:#fff;border-bottom-right-radius:3px}
.msg-bubble.assistant{background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-bottom-left-radius:3px}
.msg-bubble.system{background:transparent;color:#6e7681;font-size:12px;text-align:center;padding:4px 0;border:none}
.msg-bubble code{font-family:"JetBrains Mono",monospace;font-size:12px;background:#0d1117;border:1px solid #30363d;padding:2px 6px;border-radius:4px;color:#d2a8ff}
.msg-bubble pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px 12px;margin:8px 0;overflow-x:auto;font-size:12px;line-height:1.45;font-family:"JetBrains Mono",monospace;color:#c9d1d9}
.msg-bubble pre code{background:transparent;border:none;padding:0;color:inherit}
.msg-bubble strong{color:#e6edf3;font-weight:600}
.msg-bubble em{font-style:italic}
.msg-bubble h1,.msg-bubble h2,.msg-bubble h3{margin:6px 0 3px;font-weight:600}
.msg-bubble h1{font-size:17px;border-bottom:1px solid #21262d;padding-bottom:3px}
.msg-bubble h2{font-size:14px}
.msg-bubble h3{font-size:13px;color:#8b949e}
.msg-bubble ul,.msg-bubble ol{padding-left:20px;margin:4px 0}
.msg-bubble li{margin:2px 0}
.msg-bubble hr{border:none;border-top:1px solid #21262d;margin:8px 0}
.msg-bubble blockquote{border-left:3px solid #30363d;padding:4px 10px;color:#8b949e;margin:6px 0}
.tool-wrapper{margin:4px 0}
.tool{background:#161b22;border:1px solid #21262d;border-radius:6px;overflow:hidden;transition:box-shadow .15s, border-color .15s}
.tool:hover{border-color:#30363d}
.tool.active{box-shadow:0 0 0 1px rgba(210,153,34,.25)}
.tool.error{border-color:#490202;background:#161b22}
.tool-bar{display:flex;align-items:center;padding:7px 10px;cursor:pointer;gap:8px;font-size:12px;user-select:none}
.tool-bar:hover{background:#1c2128}
.tool-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:#30363d}
.tool-dot.running{background:#d29922;animation:pulse 1.2s ease-in-out infinite}
.tool-dot.ok{background:#3fb950}
.tool-dot.err{background:#f85149}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:1;transform:scale(1.2)}}
.tool-name{font-weight:600;color:#e6edf3;white-space:nowrap}
.tool-args{color:#8b949e;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool-chev{color:#484f58;font-size:9px;transition:.15s}
.tool.open .tool-chev{transform:rotate(90deg)}
.tool-content{display:none;padding:8px 12px;border-top:1px solid #21262d;font-family:"JetBrains Mono",monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-all;overflow-x:auto;max-height:36vh;overflow-y:auto;color:#c9d1d9;background:#0d1117}
.tool.open .tool-content{display:block}
.tool-content::-webkit-scrollbar{width:4px;height:4px}
.tool-content::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
.thinking{padding:5px 12px;border-left:2px solid #21262d;font-size:12px;color:#6e7681;font-style:italic;overflow:hidden;text-overflow:ellipsis}
#input-area{background:#161b22;border-top:1px solid #21262d;padding:10px 16px;flex-shrink:0}
#input-area form{display:flex;gap:8px;max-width:900px;margin:0 auto}
#prompt{flex:1;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:9px 12px;color:#e6edf3;font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
#prompt:focus{border-color:#4493f8;box-shadow:0 0 0 3px rgba(68,147,248,.15)}
#prompt::placeholder{color:#484f58}
button{background:#238636;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;transition:background .1s;flex-shrink:0}
button:hover{background:#2ea043}
button:disabled{background:#21262d;color:#484f58;cursor:not-allowed}
.spin{display:none;width:16px;height:16px;border:2px solid #30363d;border-top-color:#4493f8;border-radius:50%;animation:spin .6s linear infinite}
.spin.on{display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:640px){
#msgs{padding:12px;gap:12px}
.msg-row.user{max-width:92%}.msg-row.assistant{max-width:95%}
#input-area{padding:8px 12px}
#prompt{padding:7px 10px}button{padding:7px 12px}
}
</style>
</head>
<body>
<div id="header"><h1>pi<sub id="session-info"></sub></h1><div id="header-right"><span id="stat-sessions"></span><span id="stat-cost"></span></div></div>
<div id="msgs"></div>
<div id="input-area">
<form id="f" autocomplete="off">
<input id="prompt" type="text" placeholder="Message pi..." autofocus autocomplete="off">
<button id="send">Send</button>
<span class="spin" id="spin"></span>
</form>
</div>
<script>
const msgs=document.getElementById("msgs"),f=document.getElementById("f"),prompt=document.getElementById("prompt"),
send=document.getElementById("send"),spin=document.getElementById("spin"),
statSessions=document.getElementById("stat-sessions"),statCost=document.getElementById("stat-cost"),
sessionInfo=document.getElementById("session-info");
let busy=false,tools={},curAsst=null;

function scroll(){msgs.scrollTop=msgs.scrollHeight}
function esc(s){if(!s)return"";return(s+"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function fmt(n){if(n<1e3)return n;if(n<1e4)return(n/1e3).toFixed(1)+"k";return Math.round(n/1e3)+"k"}

function md(s){
let t=esc(s);
const blks=[];
t=t.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\\n\`\`\`/g,(_,lang,code)=>{blks.push('<pre><code>'+code+'</code></pre>');return'\\x00B'+(blks.length-1)+'\\x00B'});
t=t.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
t=t.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
t=t.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
t=t.replace(/^### (.+$)/gm,'<h3>$1</h3>');
t=t.replace(/^## (.+$)/gm,'<h2>$1</h2>');
t=t.replace(/^# (.+$)/gm,'<h1>$1</h1>');
t=t.replace(/^- (.+$)/gm,'<li>$1</li>');
t=t.replace(/^> (.+$)/gm,'<blockquote>$1</blockquote>');
t=t.replace(/((?:<li>.*<\\/li>\\n?)+)/g,'<ul>$1</ul>');
t=t.replace(/(?:^---+|\\*\\*\\*+|___+)$/gm,'<hr>');
t=t.replace(/\\x00B(\\d+)\\x00B/g,(_,i)=>blks[parseInt(i)]);
t=t.replace(/\\n\\n/g,'<br><br>');
t=t.replace(/\\n/g,'<br>');
return t
}

function row(role){const r=document.createElement("div");r.className="msg-row "+role;msgs.appendChild(r);return r}
function bubble(row,inner){const b=document.createElement("div");b.className="msg-bubble "+row.classList[1];b.innerHTML=inner;row.appendChild(b);return b}
function avatar(row,lbl){if(row.classList.contains("system"))return;const a=document.createElement("div");a.className="msg-avatar "+row.classList[1];a.textContent=lbl;row.appendChild(a)}
function addUser(text){const r=row("user");avatar(r,"Y");bubble(r,esc(text));scroll();return r}
function addAsst(){curAsst=row("assistant");avatar(curAsst,"P");const b=bubble(curAsst,"");scroll();return b}
function getAsst(){if(!curAsst)return addAsst();return curAsst.querySelector(".msg-bubble")}
function addSys(text){const r=row("system");bubble(r,text);scroll()}

function renderTool(e){
const el=document.createElement("div");el.className="tool-wrapper";
const argText=e.args?(" "+esc(String(e.args.command||e.args.path||e.args.file_path||"").slice(0,60))):"";
el.innerHTML='<div class="tool active" id="t'+e.toolCallId+'"><div class="tool-bar"><span class="tool-dot running"></span><span class="tool-name">'+esc(e.toolName)+'</span><span class="tool-args">'+argText+'</span><span class="tool-chev">&#9654;</span></div><div class="tool-content"></div></div>';
el.querySelector(".tool-bar").onclick=()=>{el.querySelector(".tool").classList.toggle("open")};
msgs.appendChild(el);tools[e.toolCallId]=el;scroll()}

function updateTool(id,result,isError){
const t=tools[id];if(!t)return;
const ct=t.querySelector(".tool-content");
const texts=result&&result.content?result.content.filter(c=>c&&c.type==="text").map(c=>c.text):[];
if(texts.length){ct.textContent=texts.join("\\n");t.querySelector(".tool").classList.add("open")}
if(isError){t.querySelector(".tool-dot").className="tool-dot err";t.querySelector(".tool").classList.add("error");t.querySelector(".tool").classList.remove("active")}
}

function doneTool(id,isError){
const t=tools[id];if(!t)return;
const dot=t.querySelector(".tool-dot");dot.className="tool-dot "+(isError?"err":"ok");
t.querySelector(".tool").classList.remove("active");
if(isError){t.querySelector(".tool").classList.add("error")}
if(isError&&!t.querySelector(".tool-content").textContent.trim())t.querySelector(".tool-content").textContent="(no output)"
}

function handle(d){
switch(d.type){
case"agent_start":curAsst=null;break;
case"text_delta":{const ad=getAsst();ad.innerHTML+=md(d.delta);scroll();break}
case"thinking_delta":{let th=document.getElementById("th"+d.contentIndex);if(!th){th=document.createElement("div");th.className="thinking";th.id="th"+d.contentIndex;msgs.appendChild(th)}th.textContent+=d.delta;scroll();break}
case"tool_execution_start":renderTool(d);break;
case"tool_execution_update":updateTool(d.toolCallId,d.result,false);break;
case"tool_execution_end":doneTool(d.toolCallId,d.isError);if(d.result)updateTool(d.toolCallId,d.result,d.isError);break;
case"agent_end":{let s="Done";if(d.usage){s+=" &middot; "+fmt(d.usage.input)+" in / "+fmt(d.usage.output)+" out";if(d.usage.cost)s+=" &middot; $"+d.usage.cost.total.toFixed(4)}addSys(s);break}
case"compaction":addSys("Compacting...");break;
case"error":addSys("Error: "+esc(d.message));break;
default:break}}

f.onsubmit=async e=>{e.preventDefault();if(busy)return;const text=prompt.value.trim();if(!text)return;prompt.value="";addUser(text);busy=true;send.disabled=true;spin.className="spin on";
try{const r=await fetch("/api/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
if(!r.ok){addSys("Error: HTTP "+r.status);return}
const reader=r.body.getReader(),decoder=new TextDecoder();let buf="";
while(true){const{done,value}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const lines=buf.split("\\n");buf=lines.pop()||"";
for(const line of lines){if(!line.trim())continue;try{handle(JSON.parse(line))}catch{}}}}
catch(err){addSys("Error: "+esc(err.message))}finally{busy=false;send.disabled=false;spin.className="spin"}};

fetch("/api/messages").then(r=>r.json()).then(events=>{for(const e of events){if(e.type==="user")addUser(e.text);else handle(e)}}).catch(()=>{});

fetch("/api/stats").then(r=>r.json()).then(s=>{statSessions.textContent=s.sessions+" sessions";statCost.textContent="$"+s.cost.toFixed(2)}).catch(()=>{});

fetch("/api/session-info").then(r=>r.json()).then(s=>{sessionInfo.textContent=s.id?s.id.slice(0,8)+(s.name?" | "+s.name:""):""}).catch(()=>{});
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

		if (req.method === "GET" && url === "/api/session-info") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					id: session.sessionId,
					name: session.sessionManager.getSessionName(),
					file: session.sessionFile,
				}),
			);
			return;
		}

		if (req.method === "GET" && url === "/api/messages") {
			const entries = session.sessionManager.getEntries();
			const events: Record<string, unknown>[] = [];

			for (const entry of entries) {
				if (entry.type !== "message") continue;
				const msg = (entry as { message: { role: string; content: unknown; usage?: unknown } }).message;
				if (!msg) continue;

				if (msg.role === "user") {
					const content = typeof msg.content === "string" ? msg.content : "";
					events.push({ type: "user", text: content });
				} else if (msg.role === "assistant") {
					const content = Array.isArray(msg.content) ? msg.content : [];
					for (const block of content as Array<{ type: string; text?: string; toolCall?: unknown }>) {
						if (block.type === "text" && block.text) {
							events.push({ type: "text_delta", delta: block.text });
						}
						if (block.type === "toolCall" && block.toolCall) {
							const tc = block.toolCall as { toolCallId?: string; toolName?: string; input?: unknown };
							events.push({
								type: "tool_execution_start",
								toolCallId: tc.toolCallId,
								toolName: tc.toolName,
								args: tc.input,
							});
						}
					}
				} else if (msg.role === "toolResult") {
					const content = (msg as { toolCallId?: string; content?: Array<{ type: string; text?: string }> })
						.content;
					events.push({
						type: "tool_execution_end",
						toolCallId: (msg as { toolCallId?: string }).toolCallId,
						result: { content: content ?? [] },
						isError: false,
					});
				}
			}

			const usage = getSessionTokenCount(session);
			events.push({ type: "agent_end", usage });

			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(events));
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
	console.log(`  session:    ${session.sessionId.slice(0, 8)}`);
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

function getSessionTokenCount(session: AgentSessionRuntime["session"]): Record<string, unknown> | undefined {
	const entries = session.sessionManager.getEntries();
	let input = 0;
	let output = 0;
	let costTotal = 0;
	let hasUsage = false;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = (
			entry as { message: { role: string; usage?: { input: number; output: number; cost: { total: number } } } }
		).message;
		if (msg?.role === "assistant" && msg.usage) {
			input += msg.usage.input;
			output += msg.usage.output;
			costTotal += msg.usage.cost.total;
			hasUsage = true;
		}
	}
	return hasUsage ? { input, output, cost: { total: costTotal } } : undefined;
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
