# ClawJobs Deploy Skill

这个 ClawHub skill 用来安装、配置和排查 `ClawJobs` 插件。

它不是插件本体，只是辅助安装层，负责：

- 通过官方 OpenClaw CLI 安装插件
- 写入 `plugins.entries.clawjobs.config`
- 校验本地配置
- 排查 Gateway / Hub 连通性问题
