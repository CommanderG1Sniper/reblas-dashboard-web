import type {NextApiRequest, NextApiResponse} from 'next';
import {getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {readJsonFileCached} from '../../../lib/server/json-cache';
import {resolveOwnerPreviewContext, resolveOwnerPreviewDataPath} from '../../../lib/server/owner-preview';
import {hasWeeklysTrackerAccess} from '../../../lib/server/weeklys-access';

const WEEKLYS_LEDGER_PATH = getRuntimeDataPath('weeklysLedger.json');
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function readLedger(ledgerPath: string) {
  const j = readJsonFileCached<any>(ledgerPath, () => ({weeks: {}}));
  return j?.weeks && typeof j.weeks === 'object' ? j.weeks : {};
}

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function statusFromPaid(e: any): 'collected' | 'paid' {
  const clean = Math.max(0, Math.round(Number(e?.cleanCents || 0)));
  const dirty = Math.max(0, Math.round(Number(e?.dirtyCents || 0)));
  const paidClean = Math.round(Number(e?.paidCleanCents || 0));
  const paidDirty = Math.round(Number(e?.paidDirtyCents || 0));
  return paidClean >= clean && paidDirty >= dirty ? 'paid' : 'collected';
}

function normalizePaymentHistory(raw: any) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => ({
      id: String(entry?.id || '').trim(),
      cleanCents: Math.max(0, Math.round(Number(entry?.cleanCents || 0))),
      dirtyCents: Math.max(0, Math.round(Number(entry?.dirtyCents || 0))),
      createdAt: String(entry?.createdAt || '').trim(),
      updatedAt: String(entry?.updatedAt || '').trim(),
    }))
    .filter((entry: any) => entry.id && (entry.cleanCents > 0 || entry.dirtyCents > 0) && entry.createdAt);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  const actorId = String((session as any)?.discordId || '').trim();
  const settings = readSettings();
  const preview = resolveOwnerPreviewContext(req, settings, actorId);
  const ledgerPath = resolveOwnerPreviewDataPath(preview, 'weeklysLedger.json', {weeks: {}});

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const memberId = String(req.query.memberId || '').trim();
  if (!/^\d{6,25}$/.test(memberId)) {
    return res.status(400).json({error: 'memberId is required'});
  }
  if (!hasWeeklysTrackerAccess(settings, preview.effectiveDiscordId)) {
    return res.status(403).json({error: 'Weeklys tracker access required'});
  }

  const weeks = readLedger(ledgerPath);
  const entries: any[] = [];
  let totalDirty = 0;
  let totalClean = 0;

  for (const [weekEnding, wk] of Object.entries<any>(weeks)) {
    const list = Array.isArray(wk?.entries) ? wk.entries : [];
    for (const e of list) {
      if (String(e?.memberId || '').trim() !== memberId) continue;

      const dirty = Math.max(0, Math.round(Number(e?.dirtyCents || 0)));
      const clean = Math.max(0, Math.round(Number(e?.cleanCents || 0)));
      const paidDirty = Math.max(0, Math.round(Number(e?.paidDirtyCents || 0)));
      const paidClean = Math.max(0, Math.round(Number(e?.paidCleanCents || 0)));
      const paymentHistory = normalizePaymentHistory(e?.paymentHistory);

      if (paymentHistory.length > 0) {
        for (const payment of paymentHistory) {
          totalDirty += payment.dirtyCents;
          totalClean += payment.cleanCents;
          entries.push({
            weekEnding: String(weekEnding),
            id: payment.id,
            dirtyCents: payment.dirtyCents,
            cleanCents: payment.cleanCents,
            createdAt: payment.createdAt,
          });
        }
        continue;
      }

      if (paidDirty <= 0 && paidClean <= 0) continue;
      totalDirty += paidDirty;
      totalClean += paidClean;
      entries.push({
        weekEnding: String(weekEnding),
        id: String(e?.id || ''),
        dirtyCents: paidDirty,
        cleanCents: paidClean,
        createdAt: String(e?.updatedAt || e?.createdAt || ''),
      });
    }
  }

  entries.sort((a, b) => {
    const w = String(b.weekEnding).localeCompare(String(a.weekEnding));
    if (w !== 0) return w;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  return res.status(200).json({
    memberId,
    totals: {dirtyCents: totalDirty, cleanCents: totalClean, entryCount: entries.length},
    entries,
  });
}
