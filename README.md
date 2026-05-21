# Pi - Personal Fork

> [pi](https://github.com/earendil-works/pi) 的个人分支，包名 `@openeryc/pi-*`.

## 安装

```bash
npm install -g @openeryc/pi-coding-agent
pi
```

## 模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 交互式 | `pi` | TUI 终端界面 |
| Web UI | `pi --mode web` | 浏览器访问，暗色主题 |
| 单次 | `pi -p "prompt"` | 文本输出 |
| JSON | `pi --mode json "prompt"` | JSON 事件流 |
| RPC | `pi --mode rpc` | stdin/stdout JSON-RPC |

## TUI 命令

| 命令 | 说明 |
|------|------|
| `/model` | 选择模型 |
| `/goal` | 设置 session 目标并启动 agent |
| `/usage` | 跨 session token/费用统计 |
| `/session` | 当前 session 详情 |
| `/update` | 自更新到最新版 |
| `/export` | 导出 session 为 HTML |
| `/new` | 新建 session |
| `/quit` | 退出 |

## Web UI

```bash
pi --mode web                          # 无密码
pi --mode web --web-password secret    # Basic Auth
```

- 纯 Node.js HTTP，零外部依赖
- SSE 实时流式输出
- 工具执行可折叠
- 绑定所有接口（公网可访问）

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
