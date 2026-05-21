import type {NextApiRequest, NextApiResponse} from 'next';
import {getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {readJsonFileCached} from '../../../lib/server/json-cache';
import {resolveOwnerPreviewContext, resolveOwnerPreviewDataPath} from '../../../lib/server/owner-preview';

const WASH_PATH = getRuntimeDataPath('wash.json');
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function readWash(washPath: string): any {
  return readJsonFileCached(washPath, () => ({weeks: {}}));
}

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function validYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeStatus(raw: any): 'collected' | 'pending' | 'paid' {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'pending') return 'pending';
  return 'collected';
}

function entryPaidCleanCents(e: any) {
  const v = Number(e?.paidCleanCents);
  if (Number.isFinite(v)) return Math.max(0, Math.round(v));
  return normalizeStatus(e?.status) === 'paid' ? Math.max(0, Math.round(Number(e?.cleanCents || 0))) : 0;
}

function entryPaidDirtyCents(e: any) {
  const v = Number(e?.paidDirtyCents);
  if (Number.isFinite(v)) return Math.max(0, Math.round(v));
  return normalizeStatus(e?.status) === 'paid' ? Math.max(0, Math.round(Number(e?.dirtyCents || 0))) : 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  const actorId = String((session as any)?.discordId || '').trim();
  const preview = resolveOwnerPreviewContext(req, readSettings(), actorId);
  const washPath = resolveOwnerPreviewDataPath(preview, 'wash.json', {weeks: {}});

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const uptoRaw = String(req.query.upto || '').trim();
  const upto = uptoRaw && validYMD(uptoRaw) ? uptoRaw : '';

  const store = readWash(washPath);
  const weeks = store?.weeks && typeof store.weeks === 'object' ? store.weeks : {};

  const byMember: Record<
    string,
    {
      memberId: string;
      dirtyCents: number;
      cleanCents: number;
      entryCount: number;
      lastWeekEnding: string;
    }
  > = {};

  let totalDirty = 0;
  let totalClean = 0;
  let totalEntries = 0;

  for (const [weekEnding, wk] of Object.entries<any>(weeks)) {
    if (upto && String(weekEnding) > upto) continue;
    const entries = Array.isArray(wk?.entries) ? wk.entries : [];

    for (const e of entries) {
      const memberId = String(e?.memberId || '').trim();
      if (!memberId) continue;

      const paidDirty = entryPaidDirtyCents(e);
      const paidClean = entryPaidCleanCents(e);

      totalDirty += paidDirty;
      totalClean += paidClean;
      totalEntries += 1;

      if (!byMember[memberId]) {
        byMember[memberId] = {
          memberId,
          dirtyCents: 0,
          cleanCents: 0,
          entryCount: 0,
          lastWeekEnding: String(weekEnding),
        };
      }

      byMember[memberId].dirtyCents += paidDirty;
      byMember[memberId].cleanCents += paidClean;
      byMember[memberId].entryCount += 1;
      if (String(weekEnding) > String(byMember[memberId].lastWeekEnding)) {
        byMember[memberId].lastWeekEnding = String(weekEnding);
      }
    }
  }

  const members = Object.values(byMember).sort((a, b) => b.dirtyCents - a.dirtyCents);

  return res.status(200).json({
    upto: upto || null,
    members,
    totals: {
      dirtyCents: totalDirty,
      cleanCents: totalClean,
      entryCount: totalEntries,
    },
  });
}
