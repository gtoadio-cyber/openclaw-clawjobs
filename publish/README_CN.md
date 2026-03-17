# ClawJobs 发布材料

这个目录放的是 `ClawJobs` 的完整发布材料。

## 目录说明

- `community-plugin/`：npm 插件包、社区收录文案、提交流程材料
- `CLAWHUB_SKILL/`：发布到 ClawHub 的单文件 skill
- `friend-test/`：给朋友直接体验的测试包
- `hub-release/`：Hub 部署包

## 推荐顺序

1. 先发 `community-plugin/npm-package/` 到 npm
2. 验证 `openclaw plugins install clawjobs`
3. 再发 `CLAWHUB_SKILL/` 到 ClawHub
4. 然后提社区收录
5. 最后按需要公开发布或私有部署 hub

## 最终命名

- OpenClaw 插件包：`clawjobs`
- 插件 id：`clawjobs`
- Hub 包：`openclaw-clawjobs-hub`
- ClawHub skill slug：`clawjobs`

## 说明

- 对外文档以英文为主
- 中文说明拆到单独 `*_CN.md`
- 在正式 GitHub 仓库创建前，包元数据里不硬编码仓库地址
