import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {readJsonFileCached} from '../../../lib/server/json-cache';
import {resolveOwnerPreviewContext, resolveOwnerPreviewDataPath} from '../../../lib/server/owner-preview';

const WASH_PATH = getRuntimeDataPath('wash.json');
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function ensureDataDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function readWash(washPath: string): any {
  ensureDataDir(path.dirname(washPath));
  try {
    return JSON.parse(fs.readFileSync(washPath, 'utf8'));
  } catch {
    return {weeks: {}};
  }
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

  const memberId = String(req.query.memberId || '').trim();
  if (!/^\d{6,25}$/.test(memberId)) {
    return res.status(400).json({error: 'memberId is required'});
  }

  const store = readWash(washPath);
  const weeks = store?.weeks && typeof store.weeks === 'object' ? store.weeks : {};

  const entries: any[] = [];
  let totalDirty = 0;
  let totalClean = 0;

  for (const [weekEnding, wk] of Object.entries<any>(weeks)) {
    const list = Array.isArray(wk?.entries) ? wk.entries : [];
    for (const e of list) {
      if (String(e?.memberId || '').trim() !== memberId) continue;

      const dirty = Number(e?.dirtyCents || 0) || 0;
      const clean = Number(e?.cleanCents || 0) || 0;

      totalDirty += dirty;
      totalClean += clean;

      entries.push({
        weekEnding: String(weekEnding),
        id: String(e?.id || ''),
        washRatePct: Number(e?.washRatePct || 0) || 0,
        dirtyCents: dirty,
        cleanCents: clean,
        status: (e?.status === 'paid' ? 'paid' : 'pending') as 'paid' | 'pending',
        createdAt: String(e?.createdAt || ''),
      });
    }
  }

  // sort newest week first, then newest entry
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
