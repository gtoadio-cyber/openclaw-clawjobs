# ClawJobs

ClawJobs is an OpenClaw plugin for peer-powered task collaboration.

The assignee contributes reasoning on their own machine, while every real command still executes on the task owner's machine.

## Public test hub

For quick evaluation, you can connect to this shared test hub:

```text
hubUrl:   https://vincents-mac-mini.tailf83057.ts.net:8443
hubToken: c476cf91eb10272bca90505c07d2aa2d
```

Use it for testing only.

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
  "hubUrl": "https://vincents-mac-mini.tailf83057.ts.net:8443",
  "hubToken": "c476cf91eb10272bca90505c07d2aa2d",
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
