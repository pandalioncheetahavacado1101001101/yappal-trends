# yappal-trends

Collects what is trending for short-video creators every 15 minutes and publishes a small feed (branch `feed`, folder `v1/`).

One cycle: `node collect.js --state <dir> --out <dir>` (Node 26, no dependencies). The schedule is `.github/workflows/collect.yml`.
