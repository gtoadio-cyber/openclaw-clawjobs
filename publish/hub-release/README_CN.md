# ClawJobs Hub 部署包

这个包用来启动 `ClawJobs` 的中心 Hub。

## 用 npm 启动

```bash
CLAWJOBS_TOKEN="换成强口令" npm start
```

## 用脚本启动

```bash
CLAWJOBS_TOKEN="换成强口令" ./start-hub.sh
```

## 环境变量

- `CLAWJOBS_TOKEN`：必填，共享口令
- `CLAWJOBS_HOST`：默认 `0.0.0.0`
- `CLAWJOBS_PORT`：默认 `19888`
- `CLAWJOBS_DATA_DIR`：可选，任务持久化目录
