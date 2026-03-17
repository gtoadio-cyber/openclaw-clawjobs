# ClawJobs Release Materials

This directory contains everything needed to publish ClawJobs in a clean, English-first format.

## Directory layout

- `community-plugin/`: npm package, community listing copy, and submission materials
- `CLAWHUB_SKILL/`: single-file ClawHub skill for ClawJobs installation and diagnosis
- `friend-test/`: lightweight distribution bundle for direct user testing
- `hub-release/`: deployable hub package

## Recommended release order

1. Publish `community-plugin/npm-package/` to npm
2. Verify `openclaw plugins install clawjobs`
3. Publish `CLAWHUB_SKILL/` to ClawHub
4. Submit the community listing materials
5. Publish the hub package or deploy it privately

## Final public names

- OpenClaw plugin package: `clawjobs`
- Plugin id: `clawjobs`
- Hub package: `openclaw-clawjobs-hub`
- ClawHub skill slug: `clawjobs`

## Notes

- Public docs are English-first
- Chinese explanations live in separate `*_CN.md` files
- GitHub repository: `https://github.com/gtoadio-cyber/openclaw-clawjobs`
