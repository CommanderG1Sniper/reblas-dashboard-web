import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../../lib/server/json-cache';
import {weekEndingSundayMelbourne} from '../../../lib/time/melbourne';
import {hasOwnerAccess} from '../../../lib/owner-access';
import {
  hasOwnerPreviewPermission,
  resolveOwnerPreviewContext,
  resolveOwnerPreviewDataPath,
} from '../../../lib/server/owner-preview';
import {hasWeeklysTrackerAccess} from '../../../lib/server/weeklys-access';

const SETTINGS_PATH = getRuntimeDataPath('settings.json');

type WeeklysFile = {
  // Legacy shape kept for migration support
  activeMemberIds?: string[];
  // Week-scoped snapshots: a week inherits nearest previous snapshot
  weeks?: Record<string, {weekEnding: string; memberIds: string[]}>;
  customMembers?: Array<{id: string; displayName: string; avatarUrl?: string}>;
};

function ensureDataDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, {recursive: true});
}

function ensureWeeklysFile(weeklysPath: string) {
  ensureDataDir(path.dirname(weeklysPath));
  if (!fs.existsSync(weeklysPath)) {
    const init: WeeklysFile = {weeks: {}};
    fs.writeFileSync(weeklysPath, JSON.stringify(init, null, 2), 'utf8');
  }
}

function readSettings() {
  ensureDataDir(getRuntimeDataDir());
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function normalizeMemberIdList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const id = String(item || '').trim();
    if (!/^\d{6,25}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeWeeks(raw: any): Record<string, {weekEnding: string; memberIds: string[]}> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, {weekEnding: string; memberIds: string[]}> = {};
  for (const [k, v] of Object.entries<any>(raw)) {
    const weekEnding = String(k || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) continue;
    const memberIds = normalizeMemberIdList(v?.memberIds);
    out[weekEnding] = {weekEnding, memberIds};
  }
  return out;
}

function normalizeCustomMembers(raw: any): Array<{id: string; displayName: string; avatarUrl: string}> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{id: string; displayName: string; avatarUrl: string}> = [];
  for (const item of raw) {
    const id = String(item?.id || '').trim();
    if (!/^\d{6,25}$/.test(id) || seen.has(id)) continue;
    const displayName = String(item?.displayName || '').trim().slice(0, 64) || id;
    const avatarUrl = String(item?.avatarUrl || '').trim().slice(0, 512);
    seen.add(id);
    out.push({id, displayName, avatarUrl});
  }
  return out;
}

function readWeeklys(weeklysPath: string): WeeklysFile {
  ensureWeeklysFile(weeklysPath);
  const j = readJsonFileCached<any>(weeklysPath, () => ({weeks: {}}));
  return {
    activeMemberIds: normalizeMemberIdList(j?.activeMemberIds),
    weeks: normalizeWeeks(j?.weeks),
    customMembers: normalizeCustomMembers(j?.customMembers),
  };
}

function writeWeeklys(weeklysPath: string, next: WeeklysFile) {
  ensureWeeklysFile(weeklysPath);
  const tmp = weeklysPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, weeklysPath);
  invalidateJsonFileCache(weeklysPath);
}

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
}

function isInList(raw: any, actorId: string) {
  return normalizeMemberIdList(raw).includes(actorId);
}

function canManageWeeklysMembers(settings: any, actorId: string, owner: boolean) {
  if (owner) return true;
  if (!actorId) return false;
  return (
    isInList(settings?.washPermissionAddMemberIds, actorId) ||
    isInList(settings?.washPermissionEditMemberIds, actorId)
  );
}

function resolveMemberIdsForWeek(store: WeeklysFile, weekEnding: string): string[] {
  const weeks = store.weeks || {};
  const exact = weeks[weekEnding];
  if (exact) return normalizeMemberIdList(exact.memberIds);

  const keys = Object.keys(weeks).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k <= weekEnding).sort();
  if (keys.length > 0) {
    const last = keys[keys.length - 1];
    return normalizeMemberIdList(weeks[last]?.memberIds);
  }

  // Legacy fallback if snapshots haven't been created yet
  return normalizeMemberIdList(store.activeMemberIds);
}

function defaultAvatarUrlForId(id: string) {
  try {
    const idx = Number((BigInt(id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

function avatarUrlFromHash(id: string, hash: string) {
  const ext = String(hash || '').startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=128`;
}

async function fetchDiscordUserViaBot(discordId: string, botToken: string) {
  const token = String(botToken || '').trim();
  if (!token) return null;
  const res = await fetch(`https://discord.com/api/v10/users/${encodeURIComponent(discordId)}`, {
    headers: {Authorization: `Bot ${token}`},
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => ({}));
  const id = String((j as any)?.id || '').trim();
  if (!/^\d{6,25}$/.test(id)) return null;
  const avatarHash = String((j as any)?.avatar || '').trim();
  const avatarUrl = avatarHash ? avatarUrlFromHash(id, avatarHash) : defaultAvatarUrlForId(id);
  const fetchedName = String((j as any)?.global_name || (j as any)?.username || '').trim();
  return {id, fetchedName, avatarUrl};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  const actorId = String((session as any)?.discordId || '').trim();
  const settings = readSettings();
  const owner = isOwner(session as any, settings);
  const preview = resolveOwnerPreviewContext(req, settings, actorId);
  const weeklysPath = resolveOwnerPreviewDataPath(preview, 'weeklys.json', {weeks: {}});

  const qWeek = String(req.query.weekEnding || '').trim();
  const weekEnding = /^\d{4}-\d{2}-\d{2}$/.test(qWeek) ? qWeek : weekEndingSundayMelbourne(new Date());

  if (req.method === 'GET') {
    if (!hasWeeklysTrackerAccess(settings, preview.effectiveDiscordId, weeklysPath, weekEnding)) {
      return res.status(403).json({error: 'Weeklys tracker access required'});
    }
    const store = readWeeklys(weeklysPath);
    return res.status(200).json({
      weekEnding,
      activeMemberIds: resolveMemberIdsForWeek(store, weekEnding),
      customMembers: normalizeCustomMembers(store.customMembers),
    });
  }

  if (req.method === 'PUT') {
    if (
      !(preview.active
        ? hasOwnerPreviewPermission(preview, 'weeklyManageMembers')
        : canManageWeeklysMembers(settings, actorId, owner))
    ) {
      return res.status(403).json({error: 'Not allowed to edit weekly members'});
    }

    const body = (req.body || {}) as any;
    const activeMemberIds = normalizeMemberIdList(body?.activeMemberIds);
    const current = readWeeklys(weeklysPath);
    const weeks = {...(current.weeks || {})};
    const prevForWeek = resolveMemberIdsForWeek(current, weekEnding);
    const removedSet = new Set(prevForWeek.filter((id) => !activeMemberIds.includes(id)));

    weeks[weekEnding] = {
      weekEnding,
      memberIds: activeMemberIds,
    };

    // Removed members should be removed from this week and any future snapshots.
    if (removedSet.size) {
      for (const [k, v] of Object.entries(weeks)) {
        if (k < weekEnding) continue;
        const pruned = normalizeMemberIdList(v?.memberIds).filter((id) => !removedSet.has(id));
        weeks[k] = {weekEnding: k, memberIds: pruned};
      }
    }

    const next: WeeklysFile = {weeks};
    next.customMembers = normalizeCustomMembers(current.customMembers);
    writeWeeklys(weeklysPath, next);
    return res.status(200).json({
      weekEnding,
      activeMemberIds: resolveMemberIdsForWeek(next, weekEnding),
      customMembers: normalizeCustomMembers(next.customMembers),
    });
  }

  if (req.method === 'POST') {
    if (
      !(preview.active
        ? hasOwnerPreviewPermission(preview, 'weeklyManageMembers')
        : canManageWeeklysMembers(settings, actorId, owner))
    ) {
      return res.status(403).json({error: 'Not allowed to edit weekly members'});
    }

    const body = (req.body || {}) as any;
    const discordId = String(body?.discordId || body?.id || '').trim();
    if (!/^\d{6,25}$/.test(discordId)) {
      return res.status(400).json({error: 'Valid Discord ID is required'});
    }

    const inputName = String(body?.displayName || body?.name || '').trim().slice(0, 64);
    const inputAvatar = String(body?.avatarUrl || '').trim().slice(0, 512);
    const fetched = await fetchDiscordUserViaBot(discordId, String(settings?.botToken || '').trim());

    const displayName = inputName || fetched?.fetchedName || discordId;
    const avatarUrl = inputAvatar || fetched?.avatarUrl || defaultAvatarUrlForId(discordId);

    const current = readWeeklys(weeklysPath);
    const customMembers = normalizeCustomMembers(current.customMembers);
    const idx = customMembers.findIndex((m) => String(m.id) === discordId);
    const nextMember = {id: discordId, displayName, avatarUrl};
    if (idx >= 0) customMembers[idx] = nextMember;
    else customMembers.push(nextMember);

    const next: WeeklysFile = {
      weeks: normalizeWeeks(current.weeks),
      customMembers,
    };
    writeWeeklys(weeklysPath, next);
    return res.status(200).json({
      ok: true,
      member: nextMember,
      customMembers,
      weekEnding,
      activeMemberIds: resolveMemberIdsForWeek(next, weekEnding),
    });
  }

  res.setHeader('Allow', 'GET, PUT, POST');
  return res.status(405).json({error: 'Method not allowed'});
}
