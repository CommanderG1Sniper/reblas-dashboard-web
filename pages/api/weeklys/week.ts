import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../../lib/server/json-cache';
import {addDaysYMD, weekEndingSundayMelbourne} from '../../../lib/time/melbourne';
import {hasOwnerAccess} from '../../../lib/owner-access';
import {
  hasOwnerPreviewPermission,
  resolveOwnerPreviewContext,
  resolveOwnerPreviewDataPath,
} from '../../../lib/server/owner-preview';
import {hasWeeklysTrackerAccess} from '../../../lib/server/weeklys-access';

const SETTINGS_PATH = getRuntimeDataPath('settings.json');

type WeeklysEntry = {
  id: string;
  memberId: string;
  dirtyCents: number;
  cleanCents: number;
  paidDirtyCents: number;
  paidCleanCents: number;
  paymentHistory?: WeeklysPaymentHistoryEntry[];
  createdAt: string;
  updatedAt: string;
};

type WeeklysPaymentHistoryEntry = {
  id: string;
  dirtyCents: number;
  cleanCents: number;
  createdAt: string;
  updatedAt: string;
};

type WeeklysWeek = {
  weekEnding: string;
  entries: WeeklysEntry[];
};

type WeeklysLedgerFile = {
  schemaVersion?: number;
  weeks: Record<string, WeeklysWeek>;
};

type WeekAllocationState = {
  weekKey: string;
  week: WeeklysWeek;
  idx: number;
  cleanExpected: number;
  dirtyExpected: number;
  cleanPaid: number;
  dirtyPaid: number;
};

type WeeklyExpectedAmounts = {
  cleanCents: number;
  dirtyCents: number;
};

function ensureDataDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

function ensureLedgerFile(ledgerPath: string) {
  ensureDataDir(path.dirname(ledgerPath));
  if (!fs.existsSync(ledgerPath)) {
    const init: WeeklysLedgerFile = {schemaVersion: 1, weeks: {}};
    fs.writeFileSync(ledgerPath, JSON.stringify(init, null, 2), 'utf8');
  }
}

function readSettings(): any {
  ensureDataDir(getRuntimeDataDir());
  return readJsonFileCached(SETTINGS_PATH, () => ({}));
}

function readLedger(ledgerPath: string): WeeklysLedgerFile {
  ensureLedgerFile(ledgerPath);
  const parsed = readJsonFileCached<any>(ledgerPath, () => ({schemaVersion: 1, weeks: {}}));
  const weeksRaw = parsed?.weeks && typeof parsed.weeks === 'object' ? parsed.weeks : {};
  const weeks: Record<string, WeeklysWeek> = {};
  for (const [weekEnding, rawWeek] of Object.entries<any>(weeksRaw)) {
    const entries = Array.isArray(rawWeek?.entries)
      ? rawWeek.entries.map((entry: any) => normalizeWeeklysEntry(entry))
      : [];
    weeks[String(weekEnding)] = {
      weekEnding: String(rawWeek?.weekEnding || weekEnding),
      entries,
    };
  }
  return {
    schemaVersion: 1,
    weeks,
  };
}

function writeLedger(ledgerPath: string, next: WeeklysLedgerFile) {
  ensureLedgerFile(ledgerPath);
  const tmp = ledgerPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, ledgerPath);
  invalidateJsonFileCache(ledgerPath);
}

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

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
}

function hasWashPermission(settings: any, key: string, actorId: string, owner: boolean) {
  if (owner) return true;
  if (!actorId) return false;
  return normalizeMemberIdList(settings?.[key]).includes(actorId);
}

function hasAnyWashPermission(settings: any, keys: string[], actorId: string, owner: boolean) {
  if (owner) return true;
  if (!actorId) return false;
  for (const key of keys) if (hasWashPermission(settings, key, actorId, owner)) return true;
  return false;
}

function parseMoneyToCents(raw: any): number {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function totals(entries: WeeklysEntry[]) {
  let dirty = 0;
  let clean = 0;
  for (const e of entries) {
    dirty += Number(e.dirtyCents || 0);
    clean += Number(e.cleanCents || 0);
  }
  return {dirtyCents: dirty, cleanCents: clean};
}

function statusFromPaid(e: WeeklysEntry): 'collected' | 'paid' {
  return e.paidCleanCents >= e.cleanCents && e.paidDirtyCents >= e.dirtyCents ? 'paid' : 'collected';
}

function normalizePaymentHistoryEntry(raw: any): WeeklysPaymentHistoryEntry | null {
  const id = String(raw?.id || '').trim();
  const dirtyCents = Math.max(0, Math.round(Number(raw?.dirtyCents || 0)));
  const cleanCents = Math.max(0, Math.round(Number(raw?.cleanCents || 0)));
  const createdAt = String(raw?.createdAt || '').trim();
  const updatedAt = String(raw?.updatedAt || '').trim();
  if (!id || (!dirtyCents && !cleanCents) || !createdAt) return null;
  return {
    id,
    dirtyCents,
    cleanCents,
    createdAt,
    updatedAt: updatedAt || createdAt,
  };
}

function normalizeWeeklysEntry(raw: any): WeeklysEntry {
  return {
    id: String(raw?.id || '').trim() || makeId(),
    memberId: String(raw?.memberId || '').trim(),
    dirtyCents: Math.max(0, Math.round(Number(raw?.dirtyCents || 0))),
    cleanCents: Math.max(0, Math.round(Number(raw?.cleanCents || 0))),
    paidDirtyCents: Math.max(0, Math.round(Number(raw?.paidDirtyCents || 0))),
    paidCleanCents: Math.max(0, Math.round(Number(raw?.paidCleanCents || 0))),
    paymentHistory: Array.isArray(raw?.paymentHistory)
      ? raw.paymentHistory.map((entry: any) => normalizePaymentHistoryEntry(entry)).filter(Boolean)
      : [],
    createdAt: String(raw?.createdAt || '').trim(),
    updatedAt: String(raw?.updatedAt || '').trim(),
  };
}

function getOrCreateMemberEntry(
  week: WeeklysWeek,
  memberId: string,
  nowIso: string,
  expectedAmounts: WeeklyExpectedAmounts = {cleanCents: 0, dirtyCents: 0}
): WeeklysEntry {
  const idx = week.entries.findIndex((e) => String(e.memberId) === memberId);
  if (idx >= 0) return week.entries[idx];
  const created: WeeklysEntry = {
    id: makeId(),
    memberId,
    dirtyCents: Math.max(0, Math.round(Number(expectedAmounts.dirtyCents || 0))),
    cleanCents: Math.max(0, Math.round(Number(expectedAmounts.cleanCents || 0))),
    paidDirtyCents: 0,
    paidCleanCents: 0,
    paymentHistory: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  week.entries.unshift(created);
  return created;
}

function findPreviousMemberExpectedAmounts(
  store: WeeklysLedgerFile,
  memberId: string,
  beforeWeekKey: string
): WeeklyExpectedAmounts {
  const weekKeys = Object.keys(store.weeks || {})
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k < beforeWeekKey)
    .sort()
    .reverse();

  for (const weekKey of weekKeys) {
    const week = store.weeks[weekKey];
    const entry = Array.isArray(week?.entries)
      ? week.entries.find((e) => String(e?.memberId || '').trim() === memberId)
      : null;
    if (!entry) continue;

    return {
      cleanCents: Math.max(0, Math.round(Number(entry.cleanCents || 0))),
      dirtyCents: Math.max(0, Math.round(Number(entry.dirtyCents || 0))),
    };
  }

  return {cleanCents: 0, dirtyCents: 0};
}

function findOldestMemberWeekKey(store: WeeklysLedgerFile, memberId: string): string {
  const weekKeys = Object.keys(store.weeks || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  for (const weekKey of weekKeys) {
    const week = store.weeks[weekKey];
    if (!Array.isArray(week?.entries)) continue;
    if (week.entries.some((e) => String(e?.memberId || '').trim() === memberId)) return weekKey;
  }
  return '';
}

function collectMemberAllocationStates(
  store: WeeklysLedgerFile,
  memberId: string,
  anchorWeekKey: string
): WeekAllocationState[] {
  const weekKeys = Object.keys(store.weeks || {}).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= anchorWeekKey).sort();
  const states: WeekAllocationState[] = [];

  for (const weekKey of weekKeys) {
    const week = store.weeks[weekKey];
    if (!week || !Array.isArray(week.entries)) continue;
    const idx = week.entries.findIndex((e) => String(e.memberId) === memberId);
    if (idx < 0) continue;
    const e = week.entries[idx];
    states.push({
      weekKey,
      week,
      idx,
      cleanExpected: Math.max(0, Math.round(Number(e.cleanCents || 0))),
      dirtyExpected: Math.max(0, Math.round(Number(e.dirtyCents || 0))),
      cleanPaid: Math.max(0, Math.round(Number(e.paidCleanCents || 0))),
      dirtyPaid: Math.max(0, Math.round(Number(e.paidDirtyCents || 0))),
    });
  }

  return states;
}

function redistributeMemberPaidFromWeek(store: WeeklysLedgerFile, memberId: string, anchorWeekKey: string) {
  let states = collectMemberAllocationStates(store, memberId, anchorWeekKey);
  if (states.length === 0) return;

  const nowIso = new Date().toISOString();
  let carryClean = states.reduce((sum, state) => sum + state.cleanPaid, 0);
  let carryDirty = states.reduce((sum, state) => sum + state.dirtyPaid, 0);
  const latestKnownWeekKey = states[states.length - 1].weekKey;
  let previousWeekKey = latestKnownWeekKey;
  let previousExpected: WeeklyExpectedAmounts = {
    cleanCents: states[states.length - 1].cleanExpected,
    dirtyCents: states[states.length - 1].dirtyExpected,
  };

  const ensureFutureState = () => {
    if (previousExpected.cleanCents <= 0 && previousExpected.dirtyCents <= 0) return false;
    if (carryClean <= 0 && carryDirty <= 0) return false;

    const nextWeekKey = addDaysYMD(previousWeekKey, 7);
    const week: WeeklysWeek = store.weeks[nextWeekKey] || {weekEnding: nextWeekKey, entries: []};
    week.entries = Array.isArray(week.entries) ? week.entries : [];
    const existingIdx = week.entries.findIndex((e) => String(e.memberId) === memberId);
    let idx = existingIdx;

    if (idx < 0) {
      week.entries.unshift({
        id: makeId(),
        memberId,
        dirtyCents: previousExpected.dirtyCents,
        cleanCents: previousExpected.cleanCents,
        paidDirtyCents: 0,
        paidCleanCents: 0,
        paymentHistory: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      idx = 0;
    }

    store.weeks[nextWeekKey] = week;
    const e = week.entries[idx];
    previousWeekKey = nextWeekKey;
    previousExpected = {
      cleanCents: Math.max(0, Math.round(Number(e.cleanCents || 0))),
      dirtyCents: Math.max(0, Math.round(Number(e.dirtyCents || 0))),
    };
    states.push({
      weekKey: nextWeekKey,
      week,
      idx,
      cleanExpected: previousExpected.cleanCents,
      dirtyExpected: previousExpected.dirtyCents,
      cleanPaid: Math.max(0, Math.round(Number(e.paidCleanCents || 0))),
      dirtyPaid: Math.max(0, Math.round(Number(e.paidDirtyCents || 0))),
    });
    return true;
  };

  for (let guard = 0; guard < 260; guard += 1) {
    const totalCleanCapacity = states.reduce((sum, state) => sum + state.cleanExpected, 0);
    const totalDirtyCapacity = states.reduce((sum, state) => sum + state.dirtyExpected, 0);
    const needsCleanCapacity = carryClean > totalCleanCapacity && previousExpected.cleanCents > 0;
    const needsDirtyCapacity = carryDirty > totalDirtyCapacity && previousExpected.dirtyCents > 0;
    if (!needsCleanCapacity && !needsDirtyCapacity) break;
    if (!ensureFutureState()) break;
  }

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const useClean = Math.min(carryClean, s.cleanExpected);
    const useDirty = Math.min(carryDirty, s.dirtyExpected);
    carryClean = Math.max(0, carryClean - useClean);
    carryDirty = Math.max(0, carryDirty - useDirty);
    s.cleanPaid = useClean;
    s.dirtyPaid = useDirty;
  }

  if ((carryClean > 0 || carryDirty > 0) && states.length > 0) {
    const latest = states[states.length - 1];
    latest.cleanPaid += carryClean;
    latest.dirtyPaid += carryDirty;
  }

  for (const s of states) {
    const cur = s.week.entries[s.idx];
    s.week.entries[s.idx] = {
      ...cur,
      paidCleanCents: s.cleanPaid,
      paidDirtyCents: s.dirtyPaid,
      updatedAt: nowIso,
    };
    store.weeks[s.weekKey] = s.week;
  }
}

function snapshotMemberPaidTotals(store: WeeklysLedgerFile, memberId: string) {
  const out = new Map<string, {cleanPaid: number; dirtyPaid: number}>();
  for (const [weekKey, week] of Object.entries(store.weeks || {})) {
    if (!Array.isArray(week?.entries)) continue;
    const entry = week.entries.find((candidate) => String(candidate?.memberId || '').trim() === memberId);
    if (!entry) continue;
    out.set(weekKey, {
      cleanPaid: Math.max(0, Math.round(Number(entry.paidCleanCents || 0))),
      dirtyPaid: Math.max(0, Math.round(Number(entry.paidDirtyCents || 0))),
    });
  }
  return out;
}

function appendPaymentHistoryFromDiff(
  store: WeeklysLedgerFile,
  memberId: string,
  before: Map<string, {cleanPaid: number; dirtyPaid: number}>,
  createdAt: string
) {
  for (const [weekKey, week] of Object.entries(store.weeks || {})) {
    if (!Array.isArray(week?.entries)) continue;
    const idx = week.entries.findIndex((candidate) => String(candidate?.memberId || '').trim() === memberId);
    if (idx < 0) continue;
    const entry = week.entries[idx];
    const previous = before.get(weekKey) || {cleanPaid: 0, dirtyPaid: 0};
    const nextClean = Math.max(0, Math.round(Number(entry.paidCleanCents || 0)));
    const nextDirty = Math.max(0, Math.round(Number(entry.paidDirtyCents || 0)));
    const deltaClean = Math.max(0, nextClean - previous.cleanPaid);
    const deltaDirty = Math.max(0, nextDirty - previous.dirtyPaid);
    if (!deltaClean && !deltaDirty) continue;
    const paymentHistory = Array.isArray(entry.paymentHistory) ? [...entry.paymentHistory] : [];
    paymentHistory.push({
      id: makeId(),
      cleanCents: deltaClean,
      dirtyCents: deltaDirty,
      createdAt,
      updatedAt: createdAt,
    });
    week.entries[idx] = {
      ...entry,
      paymentHistory,
      updatedAt: createdAt,
    };
    store.weeks[weekKey] = week;
  }
}

function replaceMemberPaymentHistoryForWeek(
  store: WeeklysLedgerFile,
  weekEnding: string,
  memberId: string,
  paidCleanCents: number,
  paidDirtyCents: number,
  nowIso: string
) {
  const week = store.weeks[weekEnding];
  if (!week || !Array.isArray(week.entries)) return;
  const idx = week.entries.findIndex((entry) => String(entry?.memberId || '').trim() === memberId);
  if (idx < 0) return;
  const entry = week.entries[idx];
  week.entries[idx] = {
    ...entry,
    paymentHistory:
      paidCleanCents > 0 || paidDirtyCents > 0
        ? [
            {
              id: makeId(),
              cleanCents: Math.max(0, paidCleanCents),
              dirtyCents: Math.max(0, paidDirtyCents),
              createdAt: nowIso,
              updatedAt: nowIso,
            },
          ]
        : [],
    updatedAt: nowIso,
  };
  store.weeks[weekEnding] = week;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const settings = readSettings();
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  const actorId = String((session as any)?.discordId || '').trim();
  const owner = isOwner(session as any, settings);
  const preview = resolveOwnerPreviewContext(req, settings, actorId);
  const ledgerPath = resolveOwnerPreviewDataPath(preview, 'weeklysLedger.json', {schemaVersion: 1, weeks: {}});

  const currentWeekEnding = weekEndingSundayMelbourne(new Date());
  const qWeek = String(req.query.weekEnding || '').trim();
  const weekEnding = qWeek && /^\d{4}-\d{2}-\d{2}$/.test(qWeek) ? qWeek : currentWeekEnding;

  if (req.method === 'GET') {
    if (!hasWeeklysTrackerAccess(settings, preview.effectiveDiscordId, undefined, weekEnding)) {
      return res.status(403).json({error: 'Weeklys tracker access required'});
    }
    const store = readLedger(ledgerPath);
    const week = store.weeks[weekEnding] || {weekEnding, entries: []};
    const entries = (week.entries || []).map((e) => ({
      id: e.id,
      memberId: e.memberId,
      washRatePct: 0,
      dirtyCents: e.dirtyCents,
      cleanCents: e.cleanCents,
      paidDirtyCents: e.paidDirtyCents || 0,
      paidCleanCents: e.paidCleanCents || 0,
      status: statusFromPaid(e),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
    return res.status(200).json({
      weekEnding,
      label: weekEnding === currentWeekEnding ? 'Current Week' : weekEnding,
      suggestedWashRatePct: 0,
      entries,
      totals: totals(week.entries || []),
    });
  }

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const body = (req.body || {}) as any;
  const action = String(body.action || '').trim();

  if (action === 'set_weeklys') {
    if (
      !(preview.active
        ? hasOwnerPreviewPermission(preview, 'weeklySetAmounts')
        : hasAnyWashPermission(settings, ['washPermissionAddMemberIds', 'washPermissionEditMemberIds'], actorId, owner))
    ) {
      return res.status(403).json({error: 'Not allowed to set weeklys'});
    }
    const memberIds = normalizeMemberIdList(body.memberIds);
    if (memberIds.length === 0) return res.status(400).json({error: 'At least one member is required'});
    const dirtyCents = Math.round((parseMoneyToCents(body.dirtyAmount) || 0) / 100) * 100;
    const cleanCents = Math.round((parseMoneyToCents(body.cleanAmount) || 0) / 100) * 100;
    if (dirtyCents < 0) return res.status(400).json({error: 'Dirty amount must be >= 0'});
    if (cleanCents < 0) return res.status(400).json({error: 'Clean amount must be >= 0'});

    const store = readLedger(ledgerPath);
    const week: WeeklysWeek = store.weeks[weekEnding] || {weekEnding, entries: []};
    week.entries = Array.isArray(week.entries) ? week.entries : [];
    const nowIso = new Date().toISOString();

    for (const memberId of memberIds) {
      const idx = week.entries.findIndex((e) => String(e.memberId) === memberId);
      if (idx >= 0) {
        const cur = week.entries[idx];
        week.entries[idx] = {
          ...cur,
          dirtyCents,
          cleanCents,
          updatedAt: nowIso,
        };
      } else {
        week.entries.unshift({
          id: makeId(),
          memberId,
          dirtyCents,
          cleanCents,
          paidDirtyCents: 0,
          paidCleanCents: 0,
          paymentHistory: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }

    // Keep already-recorded payments on this week when expectations change.
    // This lets members naturally fall into credit or debt instead of silently
    // moving payments across weeks.
    store.weeks[weekEnding] = week;
    writeLedger(ledgerPath, store);
    return res.status(200).json({ok: true, weekEnding, updatedMembers: memberIds.length, totals: totals(week.entries)});
  }

  if (action === 'pay_weeklys') {
    if (
      !(preview.active
        ? hasOwnerPreviewPermission(preview, 'weeklyPayMembers')
        : hasAnyWashPermission(
            settings,
            ['washPermissionAddMemberIds', 'washPermissionEditMemberIds', 'washPermissionMarkPaidMemberIds'],
            actorId,
            owner
          ))
    ) {
      return res.status(403).json({error: 'Not allowed to add weekly payments'});
    }
    const memberId = String(body.memberId || '').trim();
    if (!/^\d{6,25}$/.test(memberId)) return res.status(400).json({error: 'memberId is required'});

    let addClean = Math.round((parseMoneyToCents(body.cleanPayment) || 0) / 100) * 100;
    let addDirty = Math.round((parseMoneyToCents(body.dirtyPayment) || 0) / 100) * 100;
    if (addClean < 0) addClean = 0;
    if (addDirty < 0) addDirty = 0;
    if (addClean <= 0 && addDirty <= 0) return res.status(400).json({error: 'At least one payment amount must be greater than 0'});

    const store = readLedger(ledgerPath);
    const nowIso = new Date().toISOString();
    const week: WeeklysWeek = store.weeks[weekEnding] || {weekEnding, entries: []};
    week.entries = Array.isArray(week.entries) ? week.entries : [];
    const beforePaid = snapshotMemberPaidTotals(store, memberId);

    const expectedAmounts = findPreviousMemberExpectedAmounts(store, memberId, weekEnding);
    const cur = getOrCreateMemberEntry(week, memberId, nowIso, expectedAmounts);
    cur.paidCleanCents = Math.max(0, Math.round(Number(cur.paidCleanCents || 0))) + addClean;
    cur.paidDirtyCents = Math.max(0, Math.round(Number(cur.paidDirtyCents || 0))) + addDirty;
    cur.updatedAt = nowIso;

    store.weeks[weekEnding] = week;
    redistributeMemberPaidFromWeek(store, memberId, findOldestMemberWeekKey(store, memberId) || weekEnding);
    appendPaymentHistoryFromDiff(store, memberId, beforePaid, nowIso);
    writeLedger(ledgerPath, store);

    const refreshed = store.weeks[weekEnding] || {weekEnding, entries: []};
    return res.status(200).json({ok: true, weekEnding, memberId, totals: totals(refreshed.entries || [])});
  }

  if (action === 'set_pay_weeklys') {
    if (
      !(preview.active
        ? hasOwnerPreviewPermission(preview, 'weeklyPayMembers')
        : hasAnyWashPermission(
            settings,
            ['washPermissionAddMemberIds', 'washPermissionEditMemberIds', 'washPermissionMarkPaidMemberIds'],
            actorId,
            owner
          ))
    ) {
      return res.status(403).json({error: 'Not allowed to edit weekly payments'});
    }
    const memberId = String(body.memberId || '').trim();
    if (!/^\d{6,25}$/.test(memberId)) return res.status(400).json({error: 'memberId is required'});
    let paidClean = Math.round((parseMoneyToCents(body.cleanPayment) || 0) / 100) * 100;
    let paidDirty = Math.round((parseMoneyToCents(body.dirtyPayment) || 0) / 100) * 100;
    if (paidClean < 0) paidClean = 0;
    if (paidDirty < 0) paidDirty = 0;

    const store = readLedger(ledgerPath);
    const week: WeeklysWeek = store.weeks[weekEnding] || {weekEnding, entries: []};
    week.entries = Array.isArray(week.entries) ? week.entries : [];
    const nowIso = new Date().toISOString();

    const expectedAmounts = findPreviousMemberExpectedAmounts(store, memberId, weekEnding);
    const cur = getOrCreateMemberEntry(week, memberId, nowIso, expectedAmounts);
    cur.paidDirtyCents = paidDirty;
    cur.paidCleanCents = paidClean;
    cur.updatedAt = nowIso;

    store.weeks[weekEnding] = week;
    redistributeMemberPaidFromWeek(store, memberId, findOldestMemberWeekKey(store, memberId) || weekEnding);
    replaceMemberPaymentHistoryForWeek(store, weekEnding, memberId, paidClean, paidDirty, nowIso);
    writeLedger(ledgerPath, store);
    return res.status(200).json({ok: true, weekEnding, memberId, totals: totals(week.entries || [])});
  }

  return res.status(400).json({error: 'Unknown action'});
}
