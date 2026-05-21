import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../../lib/server/json-cache';
import {hasOwnerAccess} from '../../../lib/owner-access';
import {
  hasOwnerPreviewPermission,
  resolveOwnerPreviewContext,
  resolveOwnerPreviewDataPath,
} from '../../../lib/server/owner-preview';
import {hasWeeklysTrackerAccess} from '../../../lib/server/weeklys-access';

const SETTINGS_PATH = getRuntimeDataPath('settings.json');

type GovPayment = {
  id: string;
  paymentType: 'clean' | 'dirty';
  amountCents: number;
  description: string;
  createdAt: string;
  updatedAt: string;
};

type GovPaymentsFile = {
  schemaVersion?: number;
  entries: GovPayment[];
};

function ensureDataDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

function ensurePaymentsFile(paymentsPath: string) {
  ensureDataDir(path.dirname(paymentsPath));
  if (!fs.existsSync(paymentsPath)) {
    const init: GovPaymentsFile = {schemaVersion: 1, entries: []};
    fs.writeFileSync(paymentsPath, JSON.stringify(init, null, 2), 'utf8');
  }
}

function readSettings(): any {
  ensureDataDir(getRuntimeDataDir());
  return readJsonFileCached(SETTINGS_PATH, () => ({}));
}

function readPayments(paymentsPath: string): GovPaymentsFile {
  ensurePaymentsFile(paymentsPath);
  const parsed = readJsonFileCached<any>(paymentsPath, () => ({schemaVersion: 1, entries: []}));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const normalized: GovPayment[] = entries
    .map((e: any) => ({
      id: String(e?.id || ''),
      paymentType: String(e?.paymentType || '').trim().toLowerCase() === 'dirty' ? 'dirty' : 'clean',
      amountCents: Math.max(0, Math.round(Number(e?.amountCents || 0))),
      description: String(e?.description || '').trim().slice(0, 120),
      createdAt: String(e?.createdAt || ''),
      updatedAt: String(e?.updatedAt || ''),
    }))
    .filter((e: GovPayment) => !!e.id && e.amountCents > 0);
  return {schemaVersion: 1, entries: normalized};
}

function writePayments(paymentsPath: string, next: GovPaymentsFile) {
  ensurePaymentsFile(paymentsPath);
  const tmp = paymentsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, paymentsPath);
  invalidateJsonFileCache(paymentsPath);
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

function hasPermission(settings: any, actorId: string, owner: boolean) {
  if (owner) return true;
  if (!actorId) return false;
  const addList = normalizeMemberIdList(settings?.washPermissionAddMemberIds);
  const editList = normalizeMemberIdList(settings?.washPermissionEditMemberIds);
  return addList.includes(actorId) || editList.includes(actorId);
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

function ymdToIsoNoonLocal(ymd: string) {
  const [yy, mm, dd] = String(ymd || '').split('-').map((x) => Number(x));
  const d = new Date(yy, (mm || 1) - 1, dd || 1, 12, 0, 0, 0);
  return d.toISOString();
}

function buildResponse(entries: GovPayment[]) {
  const sorted = [...entries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  let cleanCents = 0;
  let dirtyCents = 0;
  for (const e of sorted) {
    if (e.paymentType === 'clean') cleanCents += e.amountCents;
    else dirtyCents += e.amountCents;
  }
  return {
    entries: sorted,
    totals: {
      cleanCents,
      dirtyCents,
      entryCount: sorted.length,
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const settings = readSettings();
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  const actorId = String((session as any)?.discordId || '').trim();
  const owner = isOwner(session as any, settings);
  const preview = resolveOwnerPreviewContext(req, settings, actorId);
  const paymentsPath = resolveOwnerPreviewDataPath(preview, 'weeklysGovPayments.json', {schemaVersion: 1, entries: []});

  if (req.method === 'GET') {
    if (!hasWeeklysTrackerAccess(settings, preview.effectiveDiscordId)) {
      return res.status(403).json({error: 'Weeklys tracker access required'});
    }
    const store = readPayments(paymentsPath);
    return res.status(200).json(buildResponse(store.entries));
  }

  if (req.method === 'POST') {
    if (
      !(preview.active
        ? hasOwnerPreviewPermission(preview, 'weeklyGovPayments')
        : hasPermission(settings, actorId, owner))
    ) {
      return res.status(403).json({error: 'Not allowed to add GOV payments'});
    }

    const body = (req.body || {}) as any;
    const paymentType: 'clean' | 'dirty' = String(body?.paymentType || '').trim().toLowerCase() === 'dirty' ? 'dirty' : 'clean';
    const amountCents = Math.round((parseMoneyToCents(body?.amount) || 0) / 100) * 100;
    const description = String(body?.description || '').trim().slice(0, 120);
    const paymentDate = String(body?.paymentDate || '').trim();

    if (amountCents <= 0) return res.status(400).json({error: 'Amount must be greater than 0'});
    if (!description) return res.status(400).json({error: 'Description is required'});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return res.status(400).json({error: 'Valid payment date is required'});

    const store = readPayments(paymentsPath);
    const createdAt = ymdToIsoNoonLocal(paymentDate);
    const nowIso = new Date().toISOString();
    const entry: GovPayment = {
      id: makeId(),
      paymentType,
      amountCents,
      description,
      createdAt,
      updatedAt: nowIso,
    };

    store.entries = [entry, ...(store.entries || [])];
    writePayments(paymentsPath, store);
    return res.status(200).json({ok: true, entry, ...buildResponse(store.entries)});
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({error: 'Method not allowed'});
}
