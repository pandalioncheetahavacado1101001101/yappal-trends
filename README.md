# Ideas collector

Collects what is trending for short-video creators every 15 minutes and publishes a small feed (branch `feed`, folder `v1/`).

- One cycle: `node collect.js --state <dir> --out <dir>` (Node 26, no dependencies).
- Tests: `node --test test/`.
- The schedule is `.github/workflows/collect.yml`; state is carried between runs in the Actions cache and backed up to the `state` branch.
