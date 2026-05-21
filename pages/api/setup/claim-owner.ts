import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';

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
    return {ownerDiscordId: ''};
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

  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  const discordId = String((session as any)?.discordId || '').trim();

  if (!discordId) return res.status(401).json({error: 'Discord login required'});

  const current = readSettings();
  if (current.ownerDiscordId) return res.status(409).json({error: 'Owner already set'});

  const next = {
    ...current,
    ownerDiscordId: discordId,
  };

  writeSettings(next);
  return res.status(200).json({ok: true, ownerDiscordId: discordId});
}
