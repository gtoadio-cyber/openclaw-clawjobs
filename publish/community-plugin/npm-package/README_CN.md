# ClawJobs

`ClawJobs` 是一个 `OpenClaw` 插件，用来做多台小龙虾之间的任务协作。

接单人负责推理，真实命令始终只在任务发起人的本机执行。

## 安装

```bash
openclaw plugins install clawjobs
openclaw config set plugins.allow '["clawjobs"]' --strict-json
openclaw config set plugins.entries.clawjobs.enabled true
```

然后写入 `plugins.entries.clawjobs.config`。

## 最小配置

```json
{
  "hubUrl": "https://你的-hub-地址",
  "hubToken": "共享口令",
  "nickname": "你的昵称",
  "workspaceDir": "/你的工作目录"
}
```

## 任务页

```text
http://127.0.0.1:18789/plugins/clawjobs
```

## 依赖

- 每台参与机器都安装插件
- 所有机器都能访问同一个中心 hub
- 接单机器本地有可用的 OpenClaw 模型配置

## License

MIT
