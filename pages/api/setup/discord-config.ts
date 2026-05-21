import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {hasOwnerAccess} from '../../../lib/owner-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(
      SETTINGS_PATH,
      JSON.stringify(
        {
          ownerDiscordId: '',
          coOwnerDiscordIds: [],
          discordClientId: '',
          discordClientSecret: '',
          guildName: '',
          guildId: '',
          guildAvatar: '',
          botToken: '',
          dashboardBackground: '',
          outlineColor: '#ffffff14',
        },
        null,
        2
      ),
      'utf8'
    );
  }
}

function readSettings(): any {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(next: any) {
  ensureFile();
  const tmp = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const current = readSettings();
  const ownerDiscordId = String(current.ownerDiscordId || '').trim();

  if (req.method === 'GET') {
    const cid = String(current.discordClientId || '').trim();
    const hasSecret = !!String(current.discordClientSecret || '').trim();
    return res.status(200).json({
      configured: !!cid && hasSecret,
      clientIdLast4: cid ? cid.slice(-4) : '',
      hasSecret,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  // After owner is set, only owner can change this
  if (ownerDiscordId) {
    const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
    const discordId = String((session as any)?.discordId || '').trim();
    if (!discordId) return res.status(401).json({error: 'Login required'});
    if (!hasOwnerAccess(current, discordId)) return res.status(403).json({error: 'Owner only'});
  }

  const body = (req.body || {}) as any;
  const discordClientId = String(body.discordClientId || '').trim();
  const discordClientSecret = String(body.discordClientSecret || '').trim();

  if (!discordClientId || !discordClientSecret) {
    return res.status(400).json({error: 'Client ID and Client Secret are required'});
  }

  const next = {
    ...current,
    discordClientId,
    discordClientSecret,
  };

  writeSettings(next);
  return res.status(200).json({ok: true});
}
