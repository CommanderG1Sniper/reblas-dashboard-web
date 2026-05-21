# Web Sandbox

This web repo is isolated from the live dashboard.

Rules in this repo:

- No `.env.local` was copied from live.
- Runtime data must go to `REBLAS_DATA_DIR=/home/australis/.reblas-dashboard-data-split` for local testing.
- Mining and Job Tracking are intentionally excluded here.
- This repo is web-only.
- It can run locally on port `3010` and is intended to be deployable to Vercel later.

Files added for this setup:

- `deploy/systemd/reblas-dashboard-split-web.user.service`
- `scripts/deploy-split-user-services.sh`
- `.env.local.example`

Quick start:

```bash
cd /projects/reblas-crew-dashboard-split
cp .env.local.example .env.local
bash scripts/deploy-split-user-services.sh
systemctl --user start reblas-dashboard-split-web.user.service
```

The local user service only starts the web app. The standalone dashboard bot now lives in a separate repo.
