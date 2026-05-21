const fs = require('fs');
const path = require('path');
const {PrismaClient} = require('@prisma/client');

const prisma = new PrismaClient();
const DATA_DIR = String(process.env.REBLAS_DATA_DIR || path.join(process.env.HOME || process.cwd(), '.reblas-dashboard-data')).trim();
const DOCUMENT_FILES = [
  'settings.json',
  'members.json',
  'weeklys.json',
  'weeklysLedger.json',
  'embeds.json',
  'welcomeBotState.json',
  'crewOrders.json',
  'wash.json',
  'subcrewWash.json',
  'items.json',
  'memberProfiles.json',
  'scavHuntTracker.json',
  'weeklysGovPayments.json',
  'jobTracking.json',
  'miningPriceSubmissionState.json',
  'weeklyReminderState.json',
  'twitchNotificationState.json',
];

async function main() {
  let count = 0;
  for (const file of DOCUMENT_FILES) {
    const fullPath = path.join(DATA_DIR, file);
    if (!fs.existsSync(fullPath)) continue;
    const value = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    await prisma.runtimeDocument.upsert({
      where: {key: file},
      update: {value},
      create: {key: file, value},
    });
    count += 1;
    console.log(`[db-import] imported ${file}`);
  }
  console.log(`[db-import] completed with ${count} document(s) from ${DATA_DIR}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
