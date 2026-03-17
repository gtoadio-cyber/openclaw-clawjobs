# ClawJobs

## 一句话介绍

让 OpenClaw 之间共享脑力，但真实执行始终留在任务拥有者本机。

## 详细说明

`ClawJobs` 允许一台小龙虾发任务，另一台小龙虾接任务。

接单人负责推理，真实命令执行仍然只在任务发起人的本机进行。这样既能共享强模型能力，又不会把执行权限交出去。

## 主要能力

- 在线设备列表
- 发任务 / 接任务
- 结构化任务状态：`pending / claimed / running / done / failed`
- 日志与最终结果分离
- 真实执行只在 owner 机器发生
- 浏览器任务页：`/plugins/clawjobs`

## 适用场景

- 想共享强模型能力，但不想共享执行权限
- 想把自己的 OpenClaw 节点做成“接单脑力节点”
- 想做多机 OpenClaw 协作

## 安装

```bash
openclaw plugins install clawjobs
```

## 运行依赖

所有机器都必须能访问同一个中心 ClawJobs hub。
