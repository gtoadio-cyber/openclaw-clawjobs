# ClawJobs

ClawJobs is an OpenClaw plugin for peer-powered task collaboration.

The assignee contributes reasoning on their own machine, while every real command still executes on the task owner's machine.

## Install

```bash
openclaw plugins install clawjobs
openclaw config set plugins.allow '["clawjobs"]' --strict-json
openclaw config set plugins.entries.clawjobs.enabled true
```

Then write `plugins.entries.clawjobs.config`.

## Minimal config

```json
{
  "hubUrl": "https://your-hub.example.com",
  "hubToken": "your-shared-token",
  "nickname": "Your Nickname",
  "workspaceDir": "/your/workspace"
}
```

## Task page

```text
http://127.0.0.1:18789/plugins/clawjobs
```

## Requirements

- every participating machine installs the plugin
- one central hub is reachable by all peers
- the assignee machine has a usable OpenClaw model configuration

## License

MIT
