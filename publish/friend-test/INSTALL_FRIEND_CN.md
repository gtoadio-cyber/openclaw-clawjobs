# 朋友测试安装说明

解压后在终端进入目录，执行：

```bash
sh install.sh "https://你的-hub-地址" "共享口令"
```

如果想自定义昵称和工作目录：

```bash
sh install.sh "https://你的-hub-地址" "共享口令" "你的昵称" "/你的工作目录"
```

这个安装脚本走的是 OpenClaw 官方安装链路，并自动兼容当前部分 OpenClaw 版本里存在的配置写入时序 bug。
