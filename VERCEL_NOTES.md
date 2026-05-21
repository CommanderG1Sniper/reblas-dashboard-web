# Vercel Notes

This repo is the web-only half of the dashboard split.

Current assumptions:

- It uses Next.js and can be deployed independently from the Discord bot.
- For local development it can use `REBLAS_DATA_DIR` to point at a sandbox data folder.
- Mining and Job Tracking are excluded from this repo.

Before production Vercel deployment, the remaining work is:

1. Replace local filesystem writes for persistent app data with a hosted data store or API.
2. Move any server-only scheduled behavior out of the web app.
3. Decide how the bot and web will share settings, membership state, and ledger data.
