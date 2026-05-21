import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';

const SETTINGS_PATH = getRuntimeDataPath('settings.json');

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  let ownerDiscordId = '';
  let discordClientId = '';
  let discordClientSecret = '';

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    ownerDiscordId = typeof parsed.ownerDiscordId === 'string' ? parsed.ownerDiscordId.trim() : '';
    discordClientId = typeof parsed.discordClientId === 'string' ? parsed.discordClientId.trim() : '';
    discordClientSecret = typeof parsed.discordClientSecret === 'string' ? parsed.discordClientSecret.trim() : '';
  } catch {
    // ignore
  }

  return res.status(200).json({
    ownerSet: !!ownerDiscordId,
    ownerDiscordId,
    discordConfigured: !!discordClientId && !!discordClientSecret,
  });
}
