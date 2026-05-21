# Postgres Migration Plan

Target stack:

- Web: Vercel
- Database: Neon Postgres via Vercel Marketplace
- Bot: always-on VPS or free VM host such as Oracle Cloud Always Free

Phase 1:

- Introduce one shared Postgres database.
- Store the current runtime JSON blobs as rows in `RuntimeDocument`.
- Import the existing live JSON files with `npm run db:import-runtime`.
- Point both web and bot at the same `DATABASE_URL`.

This preserves the current behavior with the smallest possible change set before normalizing the data model.

Document keys planned for import:

- `settings.json`
- `members.json`
- `weeklys.json`
- `weeklysLedger.json`
- `embeds.json`
- `welcomeBotState.json`
- `crewOrders.json`
- `wash.json`
- `subcrewWash.json`
- `items.json`
- `memberProfiles.json`
- `scavHuntTracker.json`
- `weeklysGovPayments.json`
- `jobTracking.json`
- `miningPriceSubmissionState.json`
- `weeklyReminderState.json`
- `twitchNotificationState.json`

Phase 2:

- Replace file-backed reads and writes with Prisma-backed document access.
- Keep behavior unchanged while removing `REBLAS_DATA_DIR` as a hard dependency.

Phase 3:

- Normalize high-value domains into dedicated relational tables:
  - settings
  - members and crew membership
  - weeklys and payment events
  - orders and wash tracking
  - embeds and announcements

Vercel setup goal:

1. Import the web repo into Vercel.
2. Attach Neon from the Vercel Marketplace.
3. Let Vercel inject `DATABASE_URL`.
4. `npm run build` runs `prisma migrate deploy` automatically.
5. Run the import/bootstrap step once against the live data set.
