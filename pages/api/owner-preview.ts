import type {NextApiRequest, NextApiResponse} from 'next';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from './auth/[...nextauth]';
import {readJsonFileCached} from '../../lib/server/json-cache';
import {getRuntimeDataPath} from '../../lib/server/runtime-data';
import {hasOwnerAccess} from '../../lib/owner-access';
import {clearOwnerPreviewData} from '../../lib/server/owner-preview';

const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  const actorId = String((session as any)?.discordId || '').trim();
  const settings = readSettings();
  if (!hasOwnerAccess(settings, actorId)) return res.status(403).json({error: 'Owner or co-owner only'});

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const action = String((req.body || {}).action || '').trim();
  if (action !== 'clear') return res.status(400).json({error: 'Unknown action'});

  return res.status(200).json({ok: true, ...clearOwnerPreviewData(actorId)});
}
