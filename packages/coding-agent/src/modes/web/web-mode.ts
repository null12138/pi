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
html{font-size:15px}
body{font-family:"IBM Plex Mono","JetBrains Mono","Fira Code","SF Mono",monospace;background:#1a1815;color:#d4b872;display:flex;flex-direction:column;height:100dvh;overflow:hidden}
#topbar{display:flex;align-items:center;justify-content:space-between;padding:6px 16px;background:#141310;border-bottom:2px solid #3a3528;flex-shrink:0}
#topbar h1{font-size:13px;font-weight:700;color:#e8cf8a;letter-spacing:1px}
#topbar h1::before{content:"[ ";color:#5c5240}#topbar h1::after{content:" ]";color:#5c5240}
#topbar aside{font-size:10px;color:#5c5240}
#msgs{flex:1;overflow-y:auto;padding:16px 20px;scroll-behavior:smooth;display:flex;flex-direction:column;gap:12px;background:linear-gradient(180deg,#1a1815 0%,#171512 100%)}
#msgs::-webkit-scrollbar{width:5px}
#msgs::-webkit-scrollbar-thumb{background:#3a3528;border-radius:0}
.row{animation:fadeIn .12s ease}
.row.user{display:flex;flex-direction:column;align-items:flex-end;max-width:82%;align-self:flex-end}
.row.ast{display:flex;flex-direction:column;align-items:flex-start;max-width:88%;align-self:flex-start;width:100%}
.row.sys{display:flex;justify-content:center;max-width:100%;align-self:center}
@keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
.rolename{font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;font-weight:700}
.row.user .rolename{color:#9e8a5e}
.row.ast .rolename{color:#5c5240}
.bubble{border:1px solid #3a3528;padding:10px 14px;font-size:13px;line-height:1.65;overflow-wrap:break-word;word-break:break-word}
.bubble.user{background:#2a251c;color:#e8cf8a;max-width:100%}
.bubble.ast{background:#141310;color:#c4a860;max-width:100%}
.bubble.sys{background:none;border:none;color:#5c5240;font-size:11px;text-align:center;padding:2px 0}
.bubble code{background:#111;border:1px solid #3a3528;padding:1px 5px;color:#d4b872;font-size:12px}
.bubble pre{background:#111;border:1px solid #3a3528;padding:10px 12px;overflow-x:auto;font-size:12px;line-height:1.5;color:#c4a860;margin:6px 0}
.bubble pre code{background:none;border:none;padding:0;font-size:inherit;color:inherit}
.bubble strong{color:#e8cf8a;font-weight:700}
.bubble em{color:#c4a860;font-style:italic}
.bubble h1,.bubble h2,.bubble h3{font-weight:700;color:#e8cf8a;margin:8px 0 3px}
.bubble h1{font-size:15px;border-bottom:1px solid #3a3528;padding-bottom:3px}
.bubble h2{font-size:14px}
.bubble h3{font-size:13px;color:#c4a860}
.bubble ul,.bubble ol{padding-left:22px;margin:4px 0}
.bubble li{margin:2px 0}
.bubble hr{border:none;border-top:1px solid #3a3528;margin:8px 0}
.bubble blockquote{border-left:3px solid #3a3528;padding:4px 10px;color:#8e8048;margin:4px 0}
.tool{border:1px solid #3a3528;margin:2px 0}
.tool.running{border-color:#906820}
.tool.error{border-color:#6b2020}
.tool-bar{display:flex;align-items:center;padding:6px 10px;cursor:pointer;gap:8px;font-size:12px;user-select:none;background:#141310}
.tool-bar:hover{background:#1a1815}
.tool-dot{width:7px;height:7px;flex-shrink:0;background:#3a3528}
.tool-dot.running{background:#c48c22;animation:blink 1s step-end infinite}
.tool-dot.ok{background:#689040}
.tool-dot.err{background:#b84040}
@keyframes blink{50%{opacity:.2}}
.tool-kind{font-weight:700;color:#c4a860}
.tool-args{color:#5c5240;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool-chev{color:#5c5240;font-size:10px;transition:.12s}
.tool.open .tool-chev{transform:rotate(90deg)}
.tool-content{display:none;padding:8px 12px;border-top:1px solid #3a3528;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-all;overflow-x:auto;max-height:32vh;overflow-y:auto;color:#8e8048;background:#111}
.tool.open .tool-content{display:block}
.tool-content::-webkit-scrollbar{width:4px;height:4px}
.tool-content::-webkit-scrollbar-thumb{background:#3a3528}
#input-area{border-top:2px solid #3a3528;background:#141310;padding:10px 16px;flex-shrink:0}
#input-area form{display:flex;gap:8px;max-width:900px;margin:0 auto}
#prompt{flex:1;background:#1a1815;border:1px solid #3a3528;padding:8px 12px;color:#d4b872;font-size:13px;font-family:inherit;outline:none;transition:border .15s}
#prompt:focus{border-color:#c48c22;box-shadow:0 0 6px rgba(196,140,34,.15)}
#prompt::placeholder{color:#3a3528}
button{background:#3a3528;color:#c4a860;border:1px solid #5c5240;padding:8px 18px;font-size:12px;font-family:inherit;font-weight:700;cursor:pointer;transition:.1s;flex-shrink:0;text-transform:uppercase;letter-spacing:1px}
button:hover{background:#5c5240;color:#e8cf8a;border-color:#8e8048}
button:disabled{opacity:.3;cursor:not-allowed}
.spin{display:none;width:14px;height:14px;border:2px solid #3a3528;border-top-color:#c48c22;border-radius:50%;animation:spinner .5s linear infinite}
.spin.on{display:inline-block}
@keyframes spinner{to{transform:rotate(360deg)}}
@media(max-width:600px){
#msgs{padding:10px;gap:8px}
.row.user{max-width:94%}.row.ast{max-width:96%}
#input-area{padding:8px 10px}
}
</style>
</head>
<body>
<div id="topbar"><h1>pi</h1><aside><span id="sid"></span> &nbsp; <span id="stat-sessions"></span> &nbsp; <span id="stat-cost"></span></aside></div>
<div id="msgs"></div>
<div id="input-area">
<form id="f" autocomplete="off">
<input id="prompt" type="text" placeholder=">_" autofocus autocomplete="off">
<button id="send">Send</button>
<span class="spin" id="spin"></span>
</form>
</div>
<script>
const msgs=document.getElementById("msgs"),f=document.getElementById("f"),prompt=document.getElementById("prompt"),
send=document.getElementById("send"),spinner=document.getElementById("spin"),
statSessions=document.getElementById("stat-sessions"),statCost=document.getElementById("stat-cost"),
sid=document.getElementById("sid");
let busy=false,tools={},curAsst=null;

function scroll(){msgs.scrollTop=msgs.scrollHeight}
function esc(s){if(s==null)return"";return(""+s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function fmt(n){if(!n)return"0";if(n<1e3)return""+n;if(n<1e4)return(n/1e3).toFixed(1)+"k";return Math.round(n/1e3)+"k"}

function argText(args){if(!args)return"";const v=args.command||args.path||args.file_path;return v?" "+esc(v).slice(0,80):""}

function md(s){
let t=esc(s||"");
const blocks=[];
t=t.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\\n\`\`\`/g,(_,lang,code)=>{blocks.push('<pre><code>'+code+'</code></pre>');return'\\x00B'+(blocks.length-1)+'\\x00B'});
t=t.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
t=t.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
t=t.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
t=t.replace(/^### (.+)$/gm,'<h3>$1</h3>');
t=t.replace(/^## (.+)$/gm,'<h2>$1</h2>');
t=t.replace(/^# (.+)$/gm,'<h1>$1</h1>');
t=t.replace(/^- (.+)$/gm,'<li>$1</li>');
t=t.replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>');
t=t.replace(/((?:<li>.*<\\/li>\\n?)+)/g,'<ul>$1</ul>');
t=t.replace(/^(---+|\\*\\*\\*+|___+)$/gm,'<hr>');
t=t.replace(/\\x00B(\\d+)\\x00B/g,(_,i)=>blocks[parseInt(i)]);
t=t.replace(/\\n\\n/g,'<br><br>');
t=t.replace(/\\n/g,'<br>');
return t
}

function row(role){const d=document.createElement("div");d.className="row "+role;msgs.appendChild(d);return d}
function rol(role,lbl){const d=row(role);const n=document.createElement("div");n.className="rolename";n.textContent=lbl;d.appendChild(n);return d}
function bubble(parent,html){const b=document.createElement("div");b.className="bubble "+parent.classList[1];if(html!==undefined)b.innerHTML=html;parent.appendChild(b);return b}

function addUser(txt){const r=rol("user","YOU");bubble(r,esc(txt));scroll()}
function addAst(){const r=rol("ast","PI");const b=bubble(r);scroll();curAsst={row:r,bubble:b};return b}
function addSys(txt){const r=row("sys");bubble(r,txt);scroll()}
function getAsstB(){if(!curAsst)return addAst();return curAsst.bubble}

function renderTool(e){
const r=row("ast");const w=document.createElement("div");w.className="tool-wrapper";
w.innerHTML='<div class="tool running" id="t'+e.toolCallId+'"><div class="tool-bar"><span class="tool-dot running"></span><span class="tool-kind">'+esc(e.toolName)+'</span><span class="tool-args">'+argText(e.args)+'</span><span class="tool-chev">&#9654;</span></div><div class="tool-content"></div></div>';
w.querySelector(".tool-bar").onclick=()=>w.querySelector(".tool").classList.toggle("open");
r.appendChild(w);msgs.appendChild(r);tools[e.toolCallId]={el:w.querySelector(".tool"),row:r};scroll()}

function updateTool(id,result,isError){
const t=tools[id];if(!t)return;
const ct=t.el.querySelector(".tool-content");
const texts=result&&result.content?result.content.filter(c=>c&&c.type==="text").map(c=>c.text):[];
if(texts.length){ct.textContent=texts.join("\\n");t.el.classList.add("open")}
if(isError){t.el.querySelector(".tool-dot").className="tool-dot err";t.el.classList.add("error");t.el.classList.remove("running")}
}

function doneTool(id,isError){
const t=tools[id];if(!t)return;
t.el.querySelector(".tool-dot").className="tool-dot "+(isError?"err":"ok");
t.el.classList.remove("running");
if(isError){t.el.classList.add("error")}
if(isError&&!t.el.querySelector(".tool-content").textContent.trim())t.el.querySelector(".tool-content").textContent="(no output)"
}

function handle(d){
switch(d.type){
case"agent_start":curAsst=null;break;
case"text_delta":{const b=getAsstB();b.innerHTML+=md(d.delta);scroll();break}
case"thinking_delta":{let th=document.getElementById("th"+d.contentIndex);if(!th){th=document.createElement("div");th.className="row ast";const b=document.createElement("div");b.style.cssText="font-size:11px;color:#5c5240;font-style:italic;padding:4px 10px;border-left:2px solid #3a3528";b.id="th"+d.contentIndex;th.appendChild(b);msgs.appendChild(th)}th.firstChild.textContent+=d.delta;scroll();break}
case"tool_execution_start":renderTool(d);break;
case"tool_execution_update":updateTool(d.toolCallId,d.result,false);break;
case"tool_execution_end":doneTool(d.toolCallId,d.isError);if(d.result)updateTool(d.toolCallId,d.result,d.isError);break;
case"agent_end":{let s="DONE";if(d.usage){s+=" "+fmt(d.usage.input)+" IN / "+fmt(d.usage.output)+" OUT";if(d.usage.cost)s+=" $"+d.usage.cost.total.toFixed(4)}addSys(s);break}
case"compaction":addSys("--- COMPACTING ---");break;
case"error":addSys("ERR: "+esc(d.message||""));break;
default:break}}

f.onsubmit=async e=>{e.preventDefault();if(busy)return;const text=prompt.value.trim();if(!text)return;prompt.value="";addUser(text);busy=true;send.disabled=true;spinner.className="spin on";
try{const r=await fetch("/api/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
if(!r.ok){addSys("HTTP "+r.status);return}
const reader=r.body.getReader(),decoder=new TextDecoder();let buf="";
while(true){const{done,value}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const lines=buf.split("\\n");buf=lines.pop()||"";
for(const line of lines){if(!line.trim())continue;try{handle(JSON.parse(line))}catch{}}}}
catch(err){addSys("ERR: "+esc(err.message||""))}finally{busy=false;send.disabled=false;spinner.className="spin"}};

fetch("/api/messages").then(r=>r.json()).then(events=>{for(const e of events){if(e.type==="user")addUser(e.text);else handle(e)}}).catch(()=>{});

fetch("/api/stats").then(r=>r.json()).then(s=>{statSessions.textContent=s.sessions+" sessions";statCost.textContent=s.cost.toFixed(2)}).catch(()=>{});

fetch("/api/session-info").then(r=>r.json()).then(s=>{sid.textContent=s.id?s.id.slice(0,8)+(s.name?" "+s.name:""):""}).catch(()=>{});
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
