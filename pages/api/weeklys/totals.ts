import type {NextApiRequest, NextApiResponse} from 'next';
import {getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {readJsonFileCached} from '../../../lib/server/json-cache';
import {dueWeekEndingSundayMelbourne, weekEndingSundayMelbourne} from '../../../lib/time/melbourne';
import {resolveOwnerPreviewContext, resolveOwnerPreviewDataPath} from '../../../lib/server/owner-preview';
import {hasWeeklysTrackerAccess} from '../../../lib/server/weeklys-access';

const WEEKLYS_LEDGER_PATH = getRuntimeDataPath('weeklysLedger.json');
const WEEKLYS_MEMBERS_PATH = getRuntimeDataPath('weeklys.json');
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

type LedgerEntry = {
  id: string;
  memberId: string;
  dirtyCents: number;
  cleanCents: number;
  paidDirtyCents?: number;
  paidCleanCents?: number;
  createdAt?: string;
};

type LedgerWeek = {
  weekEnding: string;
  entries: LedgerEntry[];
};

type WeeklysMembersStore = {
  activeMemberIds: string[];
  weeks: Record<string, {weekEnding: string; memberIds: string[]}>;
};

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

function readLedger(ledgerPath: string): {weeks: Record<string, LedgerWeek>} {
  const j = readJsonFileCached<any>(ledgerPath, () => ({weeks: {}}));
  const weeks = j?.weeks && typeof j.weeks === 'object' ? j.weeks : {};
  return {weeks};
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

function entryPaidCleanCents(e: LedgerEntry) {
  const v = Number(e?.paidCleanCents);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

function entryPaidDirtyCents(e: LedgerEntry) {
  const v = Number(e?.paidDirtyCents);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

function validYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  const actorId = String((session as any)?.discordId || '').trim();
  const preview = resolveOwnerPreviewContext(req, readSettings(), actorId);
  const ledgerPath = resolveOwnerPreviewDataPath(preview, 'weeklysLedger.json', {weeks: {}});
  const weeklysMembersPath = resolveOwnerPreviewDataPath(preview, 'weeklys.json', {weeks: {}});

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const uptoRaw = String(req.query.upto || '').trim();
  const upto = uptoRaw && validYMD(uptoRaw) ? uptoRaw : '';
  const currentWeekEnding = weekEndingSundayMelbourne(new Date());
  const expectedCutoff = upto || dueWeekEndingSundayMelbourne(new Date());
  if (!hasWeeklysTrackerAccess(readSettings(), preview.effectiveDiscordId, weeklysMembersPath, currentWeekEnding)) {
    return res.status(403).json({error: 'Weeklys tracker access required'});
  }

  const ledger = readLedger(ledgerPath);
  const weeklysMembers = readWeeklysMembers(weeklysMembersPath);

  const byMember: Record<
    string,
    {
      memberId: string;
      dirtyCents: number;
      cleanCents: number;
      expectedDirtyCents: number;
      expectedCleanCents: number;
      paidDirtyCents: number;
      paidCleanCents: number;
      cleanOutstandingCents: number;
      dirtyOutstandingCents: number;
      entryCount: number;
      lastWeekEnding: string;
    }
  > = {};

  let totalPaidDirty = 0;
  let totalPaidClean = 0;
  let totalExpectedDirty = 0;
  let totalExpectedClean = 0;
  let totalEntries = 0;

  for (const [weekEnding, wk] of Object.entries<any>(ledger.weeks || {})) {
    if (upto && String(weekEnding) > upto) continue;

    const activeSet = new Set(resolveWeeklysMembersForWeek(weeklysMembers, String(weekEnding)));
    const entries: LedgerEntry[] = Array.isArray(wk?.entries) ? wk.entries : [];

    for (const e of entries) {
      const memberId = String(e?.memberId || '').trim();
      if (!memberId || !activeSet.has(memberId)) continue;

      const dirty = Math.max(0, Math.round(Number(e?.dirtyCents || 0)));
      const clean = Math.max(0, Math.round(Number(e?.cleanCents || 0)));
      const paidDirty = entryPaidDirtyCents(e);
      const paidClean = entryPaidCleanCents(e);

      const includeExpected = String(weekEnding) <= expectedCutoff;
      const includePaid = true;

      if (includeExpected) {
        totalExpectedDirty += dirty;
        totalExpectedClean += clean;
      }
      if (includePaid) {
        totalPaidDirty += paidDirty;
        totalPaidClean += paidClean;
      }
      totalEntries += 1;

      if (!byMember[memberId]) {
        byMember[memberId] = {
          memberId,
          dirtyCents: 0,
          cleanCents: 0,
          expectedDirtyCents: 0,
          expectedCleanCents: 0,
          paidDirtyCents: 0,
          paidCleanCents: 0,
          cleanOutstandingCents: 0,
          dirtyOutstandingCents: 0,
          entryCount: 0,
          lastWeekEnding: String(weekEnding),
        };
      }

      if (includeExpected) {
        byMember[memberId].expectedDirtyCents += dirty;
        byMember[memberId].expectedCleanCents += clean;
      }
      if (includePaid) {
        byMember[memberId].paidDirtyCents += paidDirty;
        byMember[memberId].paidCleanCents += paidClean;
      }
      byMember[memberId].entryCount += 1;
      if (String(weekEnding) > String(byMember[memberId].lastWeekEnding)) {
        byMember[memberId].lastWeekEnding = String(weekEnding);
      }
    }
  }

  const members = Object.values(byMember)
    .map((m) => ({
      ...m,
      dirtyCents: m.paidDirtyCents,
      cleanCents: m.paidCleanCents,
      cleanOutstandingCents: m.expectedCleanCents - m.paidCleanCents,
      dirtyOutstandingCents: m.expectedDirtyCents - m.paidDirtyCents,
    }))
    .sort((a, b) => b.expectedDirtyCents - a.expectedDirtyCents);

  return res.status(200).json({
    upto: upto || null,
    members,
    totals: {
      dirtyCents: totalPaidDirty,
      cleanCents: totalPaidClean,
      totalDirtyExpectedCents: totalExpectedDirty,
      totalCleanExpectedCents: totalExpectedClean,
      totalDirtyPaidCents: totalPaidDirty,
      totalCleanPaidCents: totalPaidClean,
      dirtyOutstandingCents: totalExpectedDirty - totalPaidDirty,
      cleanOutstandingCents: totalExpectedClean - totalPaidClean,
      entryCount: totalEntries,
    },
  });
}
