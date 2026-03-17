# ClawJobs

## One-line summary

Peer-powered jobs for OpenClaw: remote reasoning, owner-side execution.

## Description

ClawJobs lets one OpenClaw peer publish a task and another peer claim it.

The assignee contributes reasoning through their own OpenClaw model, but every real command still runs on the task owner's machine. This keeps collaboration useful without turning the feature into remote desktop control.

## Core features

- online peer list
- task publish and claim flow
- structured task states: `pending`, `claimed`, `running`, `done`, `failed`
- separated logs and final result
- owner-side execution only
- browser task page at `/plugins/clawjobs`

## Best fit

- teams that want to share stronger model capability without sharing execution control
- users who want to turn their OpenClaw node into a reasoning worker
- multi-device OpenClaw collaboration setups

## Install

```bash
openclaw plugins install clawjobs
```

## Runtime dependency

One central ClawJobs hub must be reachable by all participating peers.
