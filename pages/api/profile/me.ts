import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';

const DATA_DIR = getRuntimeDataDir();
const PROFILES_PATH = getRuntimeDataPath('memberProfiles.json');

type Profile = {
  mobileNumber: string;
  ibanAccount: string;
  updatedAt?: string;
};

type ProfilesFile = {
  byDiscordId: Record<string, Profile>;
};

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(PROFILES_PATH)) {
    const init: ProfilesFile = {byDiscordId: {}};
    fs.writeFileSync(PROFILES_PATH, JSON.stringify(init, null, 2), 'utf8');
  }
}

function readProfiles(): ProfilesFile {
  ensureFiles();
  try {
    const raw = fs.readFileSync(PROFILES_PATH, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && j.byDiscordId && typeof j.byDiscordId === 'object') {
      return {byDiscordId: j.byDiscordId as any};
    }
    return {byDiscordId: {}};
  } catch {
    return {byDiscordId: {}};
  }
}

function writeProfiles(next: ProfilesFile) {
  ensureFiles();
  const tmp = PROFILES_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, PROFILES_PATH);
}

function getDiscordId(session: any): string {
  return String(session?.discordId || session?.user?.id || '').trim();
}

function cleanField(v: any, maxLen: number) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  const me = getDiscordId(session as any);
  if (!me) return res.status(401).json({error: 'Discord ID missing from session'});

  if (req.method === 'GET') {
    const store = readProfiles();
    const p = store.byDiscordId[me] || {mobileNumber: '', ibanAccount: ''};

    return res.status(200).json({
      mobileNumber: String(p.mobileNumber || ''),
      ibanAccount: String(p.ibanAccount || ''),
    });
  }

  if (req.method === 'PUT') {
    const body = (req.body || {}) as any;

    const nextProfile: Profile = {
      mobileNumber: cleanField(body.mobileNumber, 50),
      ibanAccount: cleanField(body.ibanAccount, 80),
      updatedAt: new Date().toISOString(),
    };

    const store = readProfiles();
    store.byDiscordId[me] = nextProfile;
    writeProfiles(store);

    return res.status(200).json({
      ok: true,
      mobileNumber: nextProfile.mobileNumber,
      ibanAccount: nextProfile.ibanAccount,
    });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({error: 'Method not allowed'});
}
