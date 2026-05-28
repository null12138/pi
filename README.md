# Pi - Personal Fork

> [pi](https://github.com/earendil-works/pi) 的个人分支，包名 `@openeryc/pi-*`.

## 安装

```bash
bun install -g @openeryc/pi-coding-agent
pi
```

> 需要 [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)

## 更新

```bash
# 终端内
/update

# 命令行
bun install -g @openeryc/pi-coding-agent
```

## 模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 交互式 | `pi` | TUI 终端界面 |
| Web UI | `pi --mode web` | 浏览器访问 |
| 单次 | `pi -p "prompt"` | 文本输出 |
| JSON | `pi --mode json "prompt"` | JSON 事件流 |
| RPC | `pi --mode rpc` | stdin/stdout JSON-RPC |

## TUI 命令

| 命令 | 说明 |
|------|------|
| `/model` | 选择模型 |
| `/mcp` | MCP 服务器管理（Space 切换开关） |
| `/skills` | Skills 管理（Space 切换开关） |
| `/goal` | 设置 session 目标并启动 agent |
| `/usage` | 跨 session token/费用统计 |
| `/session` | 当前 session 详情 |
| `/update` | 自更新到最新版 |
| `/export` | 导出 session 为 HTML |
| `/new` | 新建 session |
| `/quit` | 退出 |

## MCP 服务器

在 `~/.pi/agent/settings.json` 配置：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "python3",
      "args": ["-m", "my_mcp_server"],
      "enabled": true
    }
  }
}
```

- `enabled: false` 可禁用服务器，运行时 `/mcp` 可切换
- 支持 stdio / SSE / HTTP 三种传输方式

## Web UI

```bash
pi --mode web                          # 无密码
pi --mode web --web-password secret    # Basic Auth
```

- 纯 Node.js HTTP，零外部依赖
- SSE 实时流式输出
- 工具执行可折叠

## 提供者

```bash
pi --provider opencode-go --model deepseek-v4-pro
pi --provider opencode --model gpt-5.5
pi --provider anthropic --model claude-sonnet-4-6
```

## CLI 选项

```
pi --provider <name> --model <id>
pi --api-key <key>
pi --mode web --web-password <pw>
pi --resume
pi --continue
pi --help
```

## 许可

MIT
