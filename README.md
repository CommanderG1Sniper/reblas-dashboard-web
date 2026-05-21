# Reblas Dashboard Web

This repo is the web-only half of the dashboard split.

Current scope:

- Next.js dashboard app only
- intended to be deployable independently, including to Vercel
- local runtime data can be pointed at `REBLAS_DATA_DIR` for sandbox testing
- mining and Job Tracking are excluded from this repo
- the Discord bot now lives separately

## Local development

```bash
npm install
npm run dev
```

Local split sandbox service:

```bash
bash scripts/deploy-split-user-services.sh
```

That starts the web repo on `http://127.0.0.1:3010`.

## Deployment direction

- Web repo: Vercel or another Node/Next.js host
- Bot repo: separate server process with its own writable runtime data path

See `VERCEL_NOTES.md` for the remaining work needed before a real hosted split deployment.
