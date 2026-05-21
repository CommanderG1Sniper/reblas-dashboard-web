import type {NextApiRequest, NextApiResponse} from 'next';
import {getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {readJsonFileCached} from '../../../lib/server/json-cache';
import {dueWeekEndingSundayMelbourne} from '../../../lib/time/melbourne';
import {resolveOwnerPreviewContext, resolveOwnerPreviewDataPath} from '../../../lib/server/owner-preview';

const WEEKLYS_LEDGER_PATH = getRuntimeDataPath('weeklysLedger.json');
const WEEKLYS_MEMBERS_PATH = getRuntimeDataPath('weeklys.json');
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function normalizeMemberIdList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const id = String(item || '').trim();
    if (!/^\d{6,25}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

type WeeklysMembersStore = {
  activeMemberIds: string[];
  weeks: Record<string, {weekEnding: string; memberIds: string[]}>;
};

function readLedger(ledgerPath: string) {
  const j = readJsonFileCached<any>(ledgerPath, () => ({weeks: {}}));
  return j?.weeks && typeof j.weeks === 'object' ? j.weeks : {};
}

function readWeeklysMembers(weeklysMembersPath: string): WeeklysMembersStore {
  const j = readJsonFileCached<any>(weeklysMembersPath, () => ({}));
  const activeMemberIds = normalizeMemberIdList(j?.activeMemberIds);
  const weeksRaw = j?.weeks && typeof j.weeks === 'object' ? j.weeks : {};
  const weeks: Record<string, {weekEnding: string; memberIds: string[]}> = {};
  for (const [k, v] of Object.entries<any>(weeksRaw)) {
    const weekEnding = String(k || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) continue;
    weeks[weekEnding] = {weekEnding, memberIds: normalizeMemberIdList(v?.memberIds)};
  }
  return {activeMemberIds, weeks};
}

function resolveWeeklysMembersForWeek(store: WeeklysMembersStore, weekEnding: string): string[] {
  const exact = store.weeks[weekEnding];
  if (exact) return normalizeMemberIdList(exact.memberIds);
  const keys = Object.keys(store.weeks).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k <= weekEnding).sort();
  if (keys.length > 0) {
    const last = keys[keys.length - 1];
    return normalizeMemberIdList(store.weeks[last]?.memberIds);
  }
  return normalizeMemberIdList(store.activeMemberIds);
}

function entryPaidCleanCents(e: any) {
  const v = Number(e?.paidCleanCents);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

function entryPaidDirtyCents(e: any) {
  const v = Number(e?.paidDirtyCents);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const actorId = String((session as any)?.discordId || '').trim();
  if (!/^\d{6,25}$/.test(actorId)) return res.status(401).json({error: 'Discord ID missing from session'});
  const preview = resolveOwnerPreviewContext(req, readSettings(), actorId);
  const memberId = preview.effectiveDiscordId;
  const ledgerPath = resolveOwnerPreviewDataPath(preview, 'weeklysLedger.json', {weeks: {}});
  const weeklysMembersPath = resolveOwnerPreviewDataPath(preview, 'weeklys.json', {weeks: {}});

  const ledgerWeeks = readLedger(ledgerPath);
  const weeklysMembers = readWeeklysMembers(weeklysMembersPath);
  const expectedCutoff = dueWeekEndingSundayMelbourne(new Date());

  let expectedCleanCents = 0;
  let paidCleanCents = 0;
  let expectedDirtyCents = 0;
  let paidDirtyCents = 0;

  for (const [weekEnding, wk] of Object.entries<any>(ledgerWeeks)) {
    const weekKey = String(weekEnding);
    const activeSet = new Set(resolveWeeklysMembersForWeek(weeklysMembers, weekKey));
    if (!activeSet.has(memberId)) continue;

    const entries = Array.isArray(wk?.entries) ? wk.entries : [];
    for (const e of entries) {
      if (String(e?.memberId || '').trim() !== memberId) continue;
      const clean = Math.max(0, Math.round(Number(e?.cleanCents || 0)));
      const dirty = Math.max(0, Math.round(Number(e?.dirtyCents || 0)));

      if (weekKey <= expectedCutoff) {
        expectedCleanCents += clean;
        expectedDirtyCents += dirty;
      }
      paidCleanCents += entryPaidCleanCents(e);
      paidDirtyCents += entryPaidDirtyCents(e);
    }
  }

  const cleanOutstandingCents = expectedCleanCents - paidCleanCents;
  const dirtyOutstandingCents = expectedDirtyCents - paidDirtyCents;

  return res.status(200).json({
    memberId,
    expectedCleanCents,
    paidCleanCents,
    cleanOutstandingCents,
    expectedDirtyCents,
    paidDirtyCents,
    dirtyOutstandingCents,
    hasOutstanding: cleanOutstandingCents > 0 || dirtyOutstandingCents > 0,
  });
}
