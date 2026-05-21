import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {normalizeSubCrews} from '../../../lib/sub-crews';
import {hasOwnerAccess} from '../../../lib/owner-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const outlineColor = typeof parsed?.outlineColor === 'string' ? parsed.outlineColor : '#ffffff14';
    return {
      ...parsed,
      subCrews: normalizeSubCrews(parsed?.subCrews, outlineColor),
    };
  } catch {
    return {
      ownerDiscordId: '',
      coOwnerDiscordIds: [],
      botToken: '',
      subCrews: [],
    };
  }
}

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const settings = readSettings();
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  if (!isOwner(session as any, settings)) return res.status(403).json({error: 'Owner only'});

  const crewId = String(req.query?.crewId || '').trim();
  const explicitGuildId = String(req.query?.guildId || '').trim();
  const crew = crewId ? (settings.subCrews || []).find((item: any) => item.id === crewId) || null : null;
  const guildId = explicitGuildId || String(settings?.subGuildId || '').trim();
  if (!guildId) return res.status(400).json({error: 'Sub Guild ID is required'});

  const botToken = String(settings?.botToken || '').trim();
  if (!botToken) return res.status(400).json({error: 'Bot Token is missing'});

  try {
    const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      method: 'GET',
      headers: {Authorization: `Bot ${botToken}`},
    });
    if (!rolesRes.ok) {
      const txt = await rolesRes.text().catch(() => '');
      return res.status(500).json({error: `Discord roles API error (${rolesRes.status}): ${txt.slice(0, 500)}`});
    }
    const rolesRaw = (await rolesRes.json()) as any[];
    const roles = (Array.isArray(rolesRaw) ? rolesRaw : [])
      .map((role: any) => ({
        id: String(role?.id || '').trim(),
        name: String(role?.name || '').trim(),
        position: Number(role?.position || 0),
        color: Number(role?.color || 0),
      }))
      .filter((role) => !!role.id && role.name !== '@everyone')
      .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));

    return res.status(200).json({
      crewId,
      guildId,
      crewName: String(crew?.name || '').trim(),
      roles,
    });
  } catch (e: any) {
    return res.status(500).json({error: e?.message || 'Failed to load sub crew roles'});
  }
}
