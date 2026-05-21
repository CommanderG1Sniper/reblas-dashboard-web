import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

const CONFIRM_PHRASE = 'Confirm Transfer My Ownership';

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(
      SETTINGS_PATH,
      JSON.stringify(
        {
          ownerDiscordId: '',
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const current = readSettings();
  const ownerDiscordId = String(current.ownerDiscordId || '').trim();
  if (!ownerDiscordId) return res.status(409).json({error: 'Owner not set yet'});

  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  const myId = String((session as any)?.discordId || '').trim();
  if (!myId) return res.status(401).json({error: 'Login required'});
  if (myId !== ownerDiscordId) return res.status(403).json({error: 'Owner only'});

  const body = (req.body || {}) as any;
  const newOwnerDiscordId = String(body.newOwnerDiscordId || '').trim();
  const confirmPhrase = String(body.confirmPhrase || '').trim();

  if (confirmPhrase !== CONFIRM_PHRASE) {
    return res.status(400).json({error: 'Confirmation phrase mismatch'});
  }

  if (!newOwnerDiscordId) {
    return res.status(400).json({error: 'New owner Discord ID is required'});
  }

  // basic sanity: discord ids are digits
  if (!/^\d{6,25}$/.test(newOwnerDiscordId)) {
    return res.status(400).json({error: 'New owner Discord ID looks invalid'});
  }

  if (newOwnerDiscordId === ownerDiscordId) {
    return res.status(400).json({error: 'New owner is already the owner'});
  }

  const next = {
    ...current,
    ownerDiscordId: newOwnerDiscordId,
  };

  writeSettings(next);
  return res.status(200).json({ok: true, ownerDiscordId: newOwnerDiscordId});
}
