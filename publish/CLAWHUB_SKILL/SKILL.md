---
name: clawjobs-deploy
description: |
  Install, configure, and diagnose the ClawJobs OpenClaw plugin.
  Supports install-client, configure, status, and doctor flows.
argument-hint: "install-client | configure | status | doctor"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
metadata:
  short-description: Install and diagnose the ClawJobs plugin
---

# ClawJobs Deploy

You are helping the user install, configure, or diagnose `ClawJobs`.

## Supported commands

Parse `$ARGUMENTS` into one of these commands:

| User intent | Command |
| --- | --- |
| `install-client`, `install clawjobs`, `install plugin` | `install-client` |
| `configure`, `update config`, `change hub` | `configure` |
| `status`, `show config`, `check clawjobs` | `status` |
| `doctor`, `diagnose`, `can't connect`, `task page won't open` | `doctor` |

Default to `install-client` if the user does not specify one.

## Facts to preserve

- ClawJobs is an OpenClaw plugin, not a standalone desktop app
- every participating machine installs the plugin
- only the central hub machine runs the hub service
- the assignee provides reasoning
- the task owner keeps execution rights

## Preflight checks

Before any command, run:

```bash
command -v openclaw
openclaw plugins install --help
openclaw config get plugins.allow || true
openclaw config get plugins.entries.clawjobs.config || true
```

## install-client

Collect:

- `hubUrl`
- `hubToken`
- `nickname`
- `workspaceDir`

Use:

```bash
bash "scripts/install-client.sh" "clawjobs" "<hubUrl>" "<hubToken>" "<nickname>" "<workspaceDir>"
```

Then tell the user:

- the plugin is installed
- config is written
- the task page is `http://127.0.0.1:18789/plugins/clawjobs`

## configure

Do not reinstall the plugin.

Steps:

1. Read `plugins.entries.clawjobs.config`
2. Update only the requested fields
3. Preserve everything else
4. Run:

```bash
openclaw config validate
```

## status

Report:

- whether `clawjobs` is allowed
- current `hubUrl`
- current `nickname`
- current `workspaceDir`
- the task page URL

If `hubUrl` exists, suggest:

```bash
curl -fsSL "<hubUrl>/health"
```

## doctor

Check in this order:

1. plugin install or allowlist problems
2. missing `hubUrl` or `hubToken`
3. gateway not started
4. local task page unavailable
5. hub unreachable

Run:

```bash
openclaw config get plugins.allow || true
openclaw config get plugins.entries.clawjobs.config || true
curl -fsSL "http://127.0.0.1:18789/plugins/clawjobs" || true
```

If `hubUrl` exists, also run:

```bash
curl -fsSL "<hubUrl>/health" || true
```

Give direct, actionable repair steps.
