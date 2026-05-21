import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../../lib/server/json-cache';
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
          buttonStyles: [{color:'#3b82f6'},{color:'#22c55e'},{color:'#ef4444'},{color:'#f59e0b'}],
          membersDisplayRoleIds: [],
          membersExcludeRoleIds: [],
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
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function writeSettings(next: any) {
  ensureFile();
  const tmp = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
  invalidateJsonFileCache(SETTINGS_PATH);
}

function normalizeRoleIdList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v || '').trim();
    if (/^\d{6,25}$/.test(id)) out.push(id);
  }
  return Array.from(new Set(out));
}

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const settings = readSettings();

  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  if (!isOwner(session as any, settings)) return res.status(403).json({error: 'Owner only'});

  if (req.method === 'GET') {
    return res.status(200).json({
      membersDisplayRoleIds: normalizeRoleIdList(settings.membersDisplayRoleIds),
      membersExcludeRoleIds: normalizeRoleIdList(settings.membersExcludeRoleIds),
    });
  }

  if (req.method === 'PUT') {
    const body = (req.body || {}) as any;

    const next = {
      ...settings,
      membersDisplayRoleIds:
        body.membersDisplayRoleIds !== undefined
          ? normalizeRoleIdList(body.membersDisplayRoleIds)
          : normalizeRoleIdList(settings.membersDisplayRoleIds),
      membersExcludeRoleIds:
        body.membersExcludeRoleIds !== undefined
          ? normalizeRoleIdList(body.membersExcludeRoleIds)
          : normalizeRoleIdList(settings.membersExcludeRoleIds),
    };

    writeSettings(next);

    return res.status(200).json({
      ok: true,
      membersDisplayRoleIds: normalizeRoleIdList(next.membersDisplayRoleIds),
      membersExcludeRoleIds: normalizeRoleIdList(next.membersExcludeRoleIds),
    });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({error: 'Method not allowed'});
}
