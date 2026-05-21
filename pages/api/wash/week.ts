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

const SETTINGS_PATH = getRuntimeDataPath('settings.json');

type WashStatus = 'collected' | 'pending' | 'paid';

type WashEntry = {
  id: string;
  memberId: string;
  washRatePct: number; // 0-100
  dirtyCents: number;
  cleanCents: number;
  paidDirtyCents?: number;
  paidCleanCents?: number;
  status: WashStatus;
  createdAt: string;
  updatedAt: string;
};

type WashWeek = {
  weekEnding: string; // YYYY-MM-DD (Sunday)
  entries: WashEntry[];
};

type WashFile = {
  schemaVersion?: number; // v2 introduces collected/pending/paid
  weeks: Record<string, WashWeek>;
};

function ensureDataDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

function ensureWashFile(washPath: string) {
  ensureDataDir(path.dirname(washPath));
  if (!fs.existsSync(washPath)) {
    const init: WashFile = {schemaVersion: 2, weeks: {}};
    fs.writeFileSync(washPath, JSON.stringify(init, null, 2), 'utf8');
  }
}

function readSettings(): any {
  ensureDataDir(getRuntimeDataDir());
  return readJsonFileCached(SETTINGS_PATH, () => ({}));
}

function writeWash(washPath: string, next: WashFile) {
  ensureWashFile(washPath);
  const tmp = washPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, washPath);
  invalidateJsonFileCache(washPath);
}

function normalizeStatusV2(raw: any): WashStatus {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'pending') return 'pending';
  return 'collected';
}

function migrateToV2IfNeeded(store: any, washPath: string): WashFile {
  const weeks = store?.weeks && typeof store.weeks === 'object' ? store.weeks : {};
  const ver = Number(store?.schemaVersion || 0) || 0;

  // already v2
  if (ver >= 2) {
    return {schemaVersion: 2, weeks} as WashFile;
  }

  // v1 -> v2 migration: old 'pending' meant "unpaid", so map it to 'collected'
  const migrated: WashFile = {schemaVersion: 2, weeks: {}};

  for (const [weekEnding, wk] of Object.entries<any>(weeks)) {
    const entries = Array.isArray(wk?.entries) ? wk.entries : [];
    const nextEntries: WashEntry[] = entries.map((e: any) => {
      const createdAt = String(e?.createdAt || new Date().toISOString());
      const updatedAt = String(e?.updatedAt || createdAt);

      const oldStatus = String(e?.status || '').trim().toLowerCase();
      const status: WashStatus = oldStatus === 'paid' ? 'paid' : 'collected';

      return {
        id: String(e?.id || ''),
        memberId: String(e?.memberId || ''),
        washRatePct: Number(e?.washRatePct || 0) || 0,
        dirtyCents: Number(e?.dirtyCents || 0) || 0,
        cleanCents: Number(e?.cleanCents || 0) || 0,
        status,
        createdAt,
        updatedAt,
      };
    });

    migrated.weeks[String(weekEnding)] = {
      weekEnding: String(weekEnding),
      entries: nextEntries,
    };
  }

  // persist migration once
  try {
    writeWash(washPath, migrated);
  } catch {
    // ignore; we'll still return migrated in-memory
  }

  return migrated;
}

function readWash(washPath: string): WashFile {
  ensureWashFile(washPath);
  const parsed = readJsonFileCached<any>(washPath, () => ({schemaVersion: 2, weeks: {}}));
  return migrateToV2IfNeeded(parsed, washPath);
}

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
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

function hasWashPermission(settings: any, key: string, actorId: string, owner: boolean) {
  if (owner) return true;
  if (!actorId) return false;
  const allowed = normalizeMemberIdList(settings?.[key]);
  return allowed.includes(actorId);
}

function clampInt(n: any, min: number, max: number) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function defaultWashRateFromSettings(settings: any) {
  return clampInt(settings?.defaultWashRatePct, 0, 100);
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

function calcClean(dirtyCents: number, washRatePct: number) {
  const keepPct = 100 - washRatePct;
  return Math.round((dirtyCents * keepPct) / 100);
}

function entryPaidCleanCents(e: Partial<WashEntry>) {
  const v = Number((e as any)?.paidCleanCents);
  if (Number.isFinite(v)) return Math.max(0, Math.round(v));
  return normalizeStatusV2((e as any)?.status) === 'paid' ? Math.max(0, Math.round(Number((e as any)?.cleanCents || 0))) : 0;
}

function entryPaidDirtyCents(e: Partial<WashEntry>) {
  const v = Number((e as any)?.paidDirtyCents);
  if (Number.isFinite(v)) return Math.max(0, Math.round(v));
  return normalizeStatusV2((e as any)?.status) === 'paid' ? Math.max(0, Math.round(Number((e as any)?.dirtyCents || 0))) : 0;
}

function totals(entries: WashEntry[]) {
  let dirty = 0;
  let clean = 0;
  for (const e of entries) {
    dirty += Number(e.dirtyCents || 0);
    clean += Number(e.cleanCents || 0);
  }
  return {dirtyCents: dirty, cleanCents: clean};
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const settings = readSettings();
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  const actorId = String((session as any)?.discordId || '').trim();
  const owner = isOwner(session as any, settings);
  const preview = resolveOwnerPreviewContext(req, settings, actorId);
  const washPath = resolveOwnerPreviewDataPath(preview, 'wash.json', {schemaVersion: 2, weeks: {}});

  const now = new Date();
  const currentWeekEnding = weekEndingSundayMelbourne(now);

  const qWeek = String(req.query.weekEnding || '').trim();
  const weekEnding = qWeek && /^\d{4}-\d{2}-\d{2}$/.test(qWeek) ? qWeek : currentWeekEnding;

  const label = weekEnding === currentWeekEnding ? 'Current Week' : weekEnding;

  if (req.method === 'GET') {
    const store = readWash(washPath);
    const week = store.weeks[weekEnding] || {weekEnding, entries: []};

    // normalize statuses in response
    const entries = (week.entries || []).map((e) => ({
      ...e,
      status: normalizeStatusV2(e.status),
      paidCleanCents: entryPaidCleanCents(e),
      paidDirtyCents: entryPaidDirtyCents(e),
    }));

    const prevWeekEnding = addDaysYMD(weekEnding, -7);
    const prev = store.weeks[prevWeekEnding];
    const globalDefaultRate = defaultWashRateFromSettings(settings);
    const suggestedWashRatePct =
      prev && Array.isArray(prev.entries) && prev.entries.length
        ? clampInt(prev.entries[prev.entries.length - 1].washRatePct, 0, 100)
        : globalDefaultRate;

    return res.status(200).json({
      weekEnding,
      label,
      suggestedWashRatePct,
      entries,
      totals: totals(entries),
    });
  }

  if (req.method === 'POST') {
    if (!(preview.active ? hasOwnerPreviewPermission(preview, 'washAdd') : hasWashPermission(settings, 'washPermissionAddMemberIds', actorId, owner))) {
      return res.status(403).json({error: 'Not allowed to add wash'});
    }

    const body = (req.body || {}) as any;

    const memberId = String(body.memberId || '').trim();
    if (!/^\d{6,25}$/.test(memberId)) {
      return res.status(400).json({error: 'memberId is required'});
    }

    const washRatePct = clampInt(body.washRatePct, 0, 100);
    const dirtyCents = Math.round((parseMoneyToCents(body.dirtyAmount) || 0) / 100) * 100;
    if (dirtyCents <= 0) return res.status(400).json({error: 'Dirty amount must be > 0'});

    const store = readWash(washPath);
    const week: WashWeek = store.weeks[weekEnding] || {weekEnding, entries: []};
    week.entries = Array.isArray(week.entries) ? week.entries : [];

    // If member already has a PAYMENT PENDING entry, add this wash into that entry
    const pendingIdx = week.entries.findIndex(
      (e) => String(e?.memberId || '') === memberId && normalizeStatusV2(e?.status) === 'pending'
    );

    const nowIso = new Date().toISOString();

    if (pendingIdx >= 0) {
      return res.status(409).json({
        error: 'Payment is pending for this member. Mark it PAID before adding more wash.',
      });
    }

    // Otherwise create a NEW entry in "Collected" status
    const cleanCents = calcClean(dirtyCents, washRatePct);

    const entry: WashEntry = {
      id: makeId(),
      memberId,
      washRatePct,
      dirtyCents,
      cleanCents,
      paidDirtyCents: 0,
      paidCleanCents: 0,
      status: 'collected',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    week.entries.unshift(entry); // newest first
    store.weeks[weekEnding] = week;
    writeWash(washPath, store);

    return res.status(200).json({
      ok: true,
      weekEnding,
      entry,
      totals: totals(week.entries),
    });
  }

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as any;

    const action = String(body.action || 'status').trim();
    const entryId = String(body.entryId || '').trim();
    if (!entryId) return res.status(400).json({error: 'entryId is required'});

    const nextStatusRaw = String(body.status || '').trim().toLowerCase();
    const nextStatus: WashStatus =
      nextStatusRaw === 'paid' ? 'paid' : nextStatusRaw === 'pending' ? 'pending' : 'collected';

    if (action === 'edit') {
      if (!(preview.active ? hasOwnerPreviewPermission(preview, 'washEdit') : hasWashPermission(settings, 'washPermissionEditMemberIds', actorId, owner))) {
        return res.status(403).json({error: 'Not allowed to edit wash'});
      }
    } else if (action === 'delete') {
      if (!(preview.active ? hasOwnerPreviewPermission(preview, 'washDelete') : hasWashPermission(settings, 'washPermissionDeleteMemberIds', actorId, owner))) {
        return res.status(403).json({error: 'Not allowed to delete wash'});
      }
    } else if (nextStatus === 'pending') {
      if (
        !(preview.active
          ? hasOwnerPreviewPermission(preview, 'washMarkPending')
          : hasWashPermission(settings, 'washPermissionMarkPendingMemberIds', actorId, owner))
      ) {
        return res.status(403).json({error: 'Not allowed to mark pending'});
      }
    } else if (nextStatus === 'paid') {
      if (
        !(preview.active
          ? hasOwnerPreviewPermission(preview, 'washMarkPaid')
          : hasWashPermission(settings, 'washPermissionMarkPaidMemberIds', actorId, owner))
      ) {
        return res.status(403).json({error: 'Not allowed to mark paid'});
      }
    }

    const store = readWash(washPath);
    const week: WashWeek | undefined = store.weeks[weekEnding];

    if (!week || !Array.isArray(week.entries)) {
      return res.status(404).json({error: 'Week not found'});
    }

    const idx = week.entries.findIndex((e) => String(e?.id || '') === entryId);
    if (idx < 0) return res.status(404).json({error: 'Entry not found'});

    const cur = week.entries[idx];
    const curStatus = normalizeStatusV2(cur.status);

    if (curStatus === 'paid') {
      return res.status(409).json({error: 'Entry is locked (paid)'});
    }

    const nowIso = new Date().toISOString();

    // ACTION: edit (only while Collected)
    if (action === 'edit') {
      if (curStatus !== 'collected') {
        return res.status(409).json({error: 'Edits are only allowed while status is Collected'});
      }

      const nextRate = clampInt(body.washRatePct, 0, 100);
      const nextDirty = Math.round((parseMoneyToCents(body.dirtyAmount) || 0) / 100) * 100;

      if (nextDirty <= 0) return res.status(400).json({error: 'Dirty amount must be > 0'});

      const nextClean = Math.round((calcClean(nextDirty, nextRate) || 0) / 100) * 100;

      const updated: WashEntry = {
        ...cur,
        washRatePct: nextRate,
        dirtyCents: nextDirty,
        cleanCents: nextClean,
        status: 'collected',
        updatedAt: nowIso,
      };

      week.entries[idx] = updated;
      store.weeks[weekEnding] = week;
      writeWash(washPath, store);

      return res.status(200).json({
        ok: true,
        weekEnding,
        entry: updated,
        totals: totals(week.entries),
      });
    }

    // ACTION: delete (only while Collected)
    if (action === 'delete') {
      if (curStatus !== 'collected') {
        return res.status(409).json({error: 'Can only delete while status is Collected'});
      }

      week.entries.splice(idx, 1);
      store.weeks[weekEnding] = week;
      writeWash(washPath, store);

      return res.status(200).json({
        ok: true,
        weekEnding,
        deletedId: entryId,
        totals: totals(week.entries),
      });
    }

    // ACTION: status (Collected -> Pending -> Paid)
    if (nextStatus === 'pending') {
      if (curStatus !== 'collected') {
        return res.status(409).json({error: 'Can only mark Pending from Collected'});
      }
    }

    if (nextStatus === 'paid') {
      if (curStatus !== 'pending') {
        return res.status(409).json({error: 'Can only mark Paid from Pending'});
      }
    }

    if (nextStatus === 'collected') {
      return res.status(400).json({error: 'Cannot move status backwards'});
    }

    const updated: WashEntry = {
      ...cur,
      paidCleanCents: nextStatus === 'paid' ? Math.max(entryPaidCleanCents(cur), Number(cur.cleanCents || 0)) : entryPaidCleanCents(cur),
      paidDirtyCents: nextStatus === 'paid' ? Math.max(entryPaidDirtyCents(cur), Number(cur.dirtyCents || 0)) : entryPaidDirtyCents(cur),
      status: nextStatus,
      updatedAt: nowIso,
    };

    week.entries[idx] = updated;
    store.weeks[weekEnding] = week;
    writeWash(washPath, store);

    return res.status(200).json({
      ok: true,
      weekEnding,
      entry: updated,
      totals: totals(week.entries),
    });
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({error: 'Method not allowed'});
}
