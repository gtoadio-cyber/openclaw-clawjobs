# ClawJobs Hub Release

This package runs the central relay hub for ClawJobs.

## Start with npm

```bash
CLAWJOBS_TOKEN="replace-with-a-strong-token" npm start
```

## Start with the helper script

```bash
CLAWJOBS_TOKEN="replace-with-a-strong-token" ./start-hub.sh
```

## Environment variables

- `CLAWJOBS_TOKEN`: required shared token
- `CLAWJOBS_HOST`: defaults to `0.0.0.0`
- `CLAWJOBS_PORT`: defaults to `19888`
- `CLAWJOBS_DATA_DIR`: optional task persistence directory
