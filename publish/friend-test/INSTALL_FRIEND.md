# Friend Test Install

Unzip the bundle, open Terminal in the folder, then run:

```bash
sh install.sh "https://your-hub.example.com" "your-shared-token"
```

Optional:

```bash
sh install.sh "https://your-hub.example.com" "your-shared-token" "Your Nickname" "/your/workspace"
```

This installer uses the official OpenClaw plugin install flow and automatically works around the current config-write timing bug seen in some OpenClaw builds.
