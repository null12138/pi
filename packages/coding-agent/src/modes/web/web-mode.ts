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
html{font-size:14px;-webkit-text-size-adjust:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0b1014;color:#c9d1d9;display:flex;flex-direction:column;height:100dvh;overflow:hidden}
#header{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:#0d121a;border-bottom:1px solid #21262d;flex-shrink:0;gap:12px}
#header h1{font-size:15px;font-weight:600;color:#e6edf3;letter-spacing:-.3px}
#header-stats{display:flex;gap:16px;font-size:12px;color:#7d8590}
#msgs{flex:1;overflow-y:auto;padding:20px;scroll-behavior:smooth;display:flex;flex-direction:column;gap:16px}
#msgs::-webkit-scrollbar{width:6px}
#msgs::-webkit-scrollbar-track{background:transparent}
#msgs::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px}
.msg-group{display:flex;flex-direction:column;gap:4px;animation:fadeIn .15s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.msg-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.msg{max-width:82%;padding:10px 14px;border-radius:8px;font-size:13.5px;line-height:1.6;overflow-wrap:break-word}
.msg.user{background:#1b4a8b;color:#e6edf3;align-self:flex-end;border-bottom-right-radius:4px}
.msg.user .msg-label{color:#7ec9ff;text-align:right}
.msg.assistant{background:#1a1f2b;color:#c9d1d9;align-self:flex-start;border-bottom-left-radius:4px;border:1px solid #21262d}
.msg.assistant .msg-label{color:#7d8590}
.msg.system{background:transparent;color:#6e7681;font-size:12px;text-align:center;max-width:100%;padding:4px 0}
.msg code{font-family:"JetBrains Mono","Fira Code",monospace;font-size:12px;background:#161b22;padding:1px 5px;border-radius:3px;border:1px solid #30363d}
.msg pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;margin:8px 0;overflow-x:auto;font-size:12px;line-height:1.45}
.tool{border:1px solid #21262d;border-radius:8px;overflow:hidden;transition:border-color .2s}
.tool:hover{border-color:#30363d}
.tool-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#0d121a;cursor:pointer;user-select:none;gap:8px;transition:background .15s}
.tool-header:hover{background:#161b22}
.tool-icon{width:8px;height:8px;border-radius:50%;flex-shrink:0;opacity:.6}
.tool-icon.pending{background:#d29922;animation:pulse 1.5s infinite}
.tool-icon.done{background:#3fb950}
.tool-icon.error{background:#f85149}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.tool-title{flex:1;font-size:12.5px;font-weight:500;color:#c9d1d9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool-arrow{color:#6e7681;font-size:10px;transition:transform .2s}
.tool.expanded .tool-arrow{transform:rotate(90deg)}
.tool-body{font-family:"JetBrains Mono","Fira Code",monospace;font-size:12px;line-height:1.55;padding:10px 12px;background:#0b1014;white-space:pre-wrap;word-break:break-all;overflow-x:auto;max-height:30vh;overflow-y:auto;display:none}
.tool-body::-webkit-scrollbar{width:4px}
.tool-body::-webkit-scrollbar-thumb{background:#30363d;border-radius:2px}
.tool.expanded .tool-body{display:block}
.tool.mini .tool-body{max-height:12vh}
.thinking{padding:6px 12px;margin:0 0 4px;border-left:2px solid #30363d;font-size:12px;color:#6e7681;font-style:italic}
#input-area{background:#0d121a;border-top:1px solid #21262d;padding:14px 20px;flex-shrink:0}
#input-area form{display:flex;gap:10px;max-width:900px;margin:0 auto}
#prompt{flex:1;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 14px;color:#c9d1d9;font-size:13.5px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
#prompt:focus{border-color:#4493f8;box-shadow:0 0 0 3px rgba(68,147,248,.15)}
#prompt::placeholder{color:#484f58}
button{background:#1f6feb;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s;flex-shrink:0}
button:hover{background:#2b83ff}
button:disabled{background:#21262d;color:#6e7681;cursor:not-allowed}
.spinner{display:none;width:16px;height:16px;border:2px solid #30363d;border-top-color:#4493f8;border-radius:50%;animation:spin .6s linear infinite}
.spinner.active{display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:600px){
html{font-size:13px}
#msgs{padding:12px}
.msg{max-width:92%}
#input-area{padding:10px 14px}
#prompt{padding:8px 12px}
button{padding:8px 14px}
}
</style>
</head>
<body>
<div id="header"><h1>pi</h1><div id="header-stats"><span id="stat-sessions"></span><span id="stat-cost"></span></div></div>
<div id="msgs"></div>
<div id="input-area">
<form id="f" autocomplete="off">
<input id="prompt" type="text" placeholder="Message pi..." autofocus autocomplete="off">
<button id="send">Send</button>
<span class="spinner" id="spinner"></span>
</form>
</div>
<script>
const msgs=document.getElementById("msgs"),f=document.getElementById("f"),prompt=document.getElementById("prompt"),
send=document.getElementById("send"),spinner=document.getElementById("spinner"),
statSessions=document.getElementById("stat-sessions"),statCost=document.getElementById("stat-cost");
let busy=false,toolEls={},curAssistant=null,curToolSeq=0;

function scrollDown(){msgs.scrollTop=msgs.scrollHeight}
function esc(s){if(!s)return"";return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function fmt(n){if(n<1e3)return n;if(n<1e4)return(n/1e3).toFixed(1)+"k";return Math.round(n/1e3)+"k"}
function renderText(text){
return esc(text).replace(/\\n\`\`\`(\\w*)\\n([\\s\\S]*?)\\n\`\`\`\\n/g,(_,lang,code)=>'</p><pre>'+esc(code)+'</pre><p>')
.replace(/\\n\`\`\`(\\w*)\\n([\\s\\S]*?)\\n\`\`\`/g,(_,lang,code)=>'</p><pre>'+esc(code)+'</pre><p>')
.replace(/\`([^\`]+)\`/g,'<code>$1</code>').replace(/\\n/g,'<br>')
}

function addMsg(role,text){
const g=document.createElement("div");g.className="msg-group";
if(role==="user"){g.innerHTML='<div class="msg-label">You</div><div class="msg user">'+esc(text)+'</div>'}
else if(role==="assistant"){g.innerHTML='<div class="msg-label">pi</div><div class="msg assistant"></div>'}
else{g.innerHTML='<div class="msg system">'+text+'</div>'}
msgs.appendChild(g);scrollDown();return g}

function getAssistantDiv(){if(!curAssistant){curAssistant=addMsg("assistant","")}return curAssistant.querySelector(".msg")}

function startTool(e){
const el=document.createElement("div");el.className="tool";el.id="t"+e.toolCallId;
el.innerHTML='<div class="tool-header"><span class="tool-icon pending"></span><span class="tool-title">'+esc(e.toolName)+(e.args?' '+esc(String(e.args.command||e.args.path||e.args.file_path||"")).slice(0,80):'')+'</span><span class="tool-arrow">&#9654;</span></div><div class="tool-body"></div>';
el.querySelector(".tool-header").onclick=()=>el.classList.toggle("expanded");
msgs.appendChild(el);toolEls[e.toolCallId]=el;scrollDown()}

function updateTool(id,result,isError){
const el=toolEls[id];if(!el)return;
const icon=el.querySelector(".tool-icon"),body=el.querySelector(".tool-body");
if(isError){icon.className="tool-icon error"}
const texts=result&&result.content?result.content.filter(c=>c&&c.type==="text").map(c=>c.text):[];
if(texts.length){body.textContent=texts.join("\\n");el.classList.add("expanded","mini")}
}

function finishTool(id,isError){
const el=toolEls[id];if(!el)return;
const icon=el.querySelector(".tool-icon");icon.className="tool-icon "+(isError?"error":"done");
if(isError&&el.querySelector(".tool-body").textContent===""){el.querySelector(".tool-body").textContent="(no output)"}
}

function handle(d){
switch(d.type){
case"agent_start":curAssistant=null;break;
case"text_delta":{const ad=getAssistantDiv();ad.innerHTML+=renderText(d.delta);scrollDown();break}
case"thinking_delta":{let th=document.getElementById("think"+d.contentIndex);if(!th){th=document.createElement("div");th.className="thinking";th.id="think"+d.contentIndex;msgs.appendChild(th)}th.textContent+=d.delta;scrollDown();break}
case"tool_execution_start":startTool(d);break;
case"tool_execution_update":updateTool(d.toolCallId,d.result,false);break;
case"tool_execution_end":finishTool(d.toolCallId,d.isError);if(d.result)updateTool(d.toolCallId,d.result,d.isError);break;
case"agent_end":{let s="";if(d.usage){s=" &middot; "+fmt(d.usage.input)+" in &middot "+fmt(d.usage.output)+" out";if(d.usage.cost)s+=" &middot; $"+d.usage.cost.total.toFixed(4)}addMsg("system","Done"+s);break}
case"compaction":addMsg("system","Compacting...");break;
case"error":addMsg("system","Error: "+esc(d.message));break;
case"text_start":case"thinking_start":case"text_end":case"thinking_end":case"toolcall_start":case"toolcall_end":case"toolcall_delta":break}}

f.onsubmit=async e=>{e.preventDefault();if(busy)return;const text=prompt.value.trim();if(!text)return;prompt.value="";addMsg("user",text);busy=true;send.disabled=true;spinner.className="spinner active";
try{const r=await fetch("/api/prompt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
if(!r.ok){addMsg("system","Error: "+r.status);return}
const reader=r.body.getReader(),decoder=new TextDecoder();let buf="";
while(true){const{done,value}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const lines=buf.split("\\n");buf=lines.pop()||"";
for(const line of lines){if(!line.trim())continue;try{handle(JSON.parse(line))}catch{}}}}
catch(err){addMsg("system","Error: "+esc(err.message))}finally{busy=false;send.disabled=false;spinner.className="spinner"}};

fetch("/api/stats").then(r=>r.json()).then(s=>{
statSessions.textContent=s.sessions+" sessions";
statCost.textContent="$"+s.cost.toFixed(2);
}).catch(()=>{});
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
