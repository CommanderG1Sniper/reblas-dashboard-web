import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {readJsonFileCached} from '../../../lib/server/json-cache';
import {previousMonthRangeMelbourne} from '../../../lib/time/melbourne';
import {normalizeSubCrews, resolveViewerCrewContext} from '../../../lib/sub-crews';
import {resolveOwnerPreviewContext} from '../../../lib/server/owner-preview';
import {isMainGuildMember} from '../../../lib/server/viewer-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const MEMBERS_PATH = getRuntimeDataPath('members.json');
const WASH_PATH = getRuntimeDataPath('wash.json');
const TOP_DIRTY_TTL_MS = 30_000;

let topDirtyCache: {key: string; topId: string; expiresAt: number} | null = null;

function readSettings(): any {
  const settings = readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
  const outlineColor = typeof settings?.outlineColor === 'string' ? settings.outlineColor : '#ffffff14';
  return {
    ...settings,
    subCrews: normalizeSubCrews(settings?.subCrews, outlineColor),
  };
}

function selectMembersBucket(payload: any, subCrewId: string) {
  const crews = payload?.crews && typeof payload.crews === 'object' ? payload.crews : {};
  if (subCrewId) {
    const bucket = crews?.[subCrewId];
    if (bucket && typeof bucket === 'object') {
      return {
        members: Array.isArray(bucket.members) ? bucket.members : [],
      };
    }
  }

  return {
    members: Array.isArray(payload?.members) ? payload.members : [],
  };
}

function washVersionKey() {
  try {
    return String(fs.statSync(WASH_PATH).mtimeMs || 0);
  } catch {
    return '0';
  }
}

function topPrevMonthDirtyMemberId(): string {
  const {start, end} = previousMonthRangeMelbourne(new Date());
  const cacheKey = `${start}:${end}:${washVersionKey()}`;
  const nowMs = Date.now();
  if (topDirtyCache && topDirtyCache.key === cacheKey && topDirtyCache.expiresAt > nowMs) {
    return topDirtyCache.topId;
  }

  const store = readJsonFileCached<any>(WASH_PATH, () => ({weeks: {}}));
  const weeks = store?.weeks && typeof store.weeks === 'object' ? store.weeks : {};

  const byMember: Record<string, number> = {};

  for (const [weekEnding, wk] of Object.entries<any>(weeks)) {
    const weekKey = String(weekEnding || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) continue;
    if (weekKey < start || weekKey > end) continue;

    const entries = Array.isArray(wk?.entries) ? wk.entries : [];
    for (const e of entries) {
      const memberId = String(e?.memberId || '').trim();
      if (!memberId) continue;
      const dirty = Number(e?.dirtyCents || 0) || 0;
      if (dirty <= 0) continue;
      byMember[memberId] = (byMember[memberId] || 0) + dirty;
    }
  }

  let topId = '';
  let topDirty = 0;
  for (const [memberId, dirty] of Object.entries(byMember)) {
    if (dirty > topDirty) {
      topDirty = dirty;
      topId = memberId;
    }
  }

  topDirtyCache = {
    key: cacheKey,
    topId,
    expiresAt: nowMs + TOP_DIRTY_TTL_MS,
  };
  return topId;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
    if (!session) return res.status(401).json({error: 'Login required'});

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({error: 'Method not allowed'});
    }

    const settings = readSettings();
    const myId = String((session as any)?.discordId || '').trim();
    const preview = resolveOwnerPreviewContext(req, settings, myId);
    const viewer = resolveViewerCrewContext({
      ownerDiscordId: String(settings?.ownerDiscordId || ''),
      coOwnerDiscordIds: Array.isArray(settings?.coOwnerDiscordIds) ? settings.coOwnerDiscordIds : [],
      discordId: preview.effectiveDiscordId,
      outlineColor: String(settings?.outlineColor || '#ffffff14'),
      subCrews: Array.isArray(settings?.subCrews) ? settings.subCrews : [],
      isMainGuildMember: isMainGuildMember(preview.effectiveDiscordId),
    });

    if (viewer.viewerRole !== 'owner' && viewer.viewerRole !== 'main') {
      return res.status(200).json({member: null});
    }

    const topId = topPrevMonthDirtyMemberId();
    const payload = readJsonFileCached<any>(MEMBERS_PATH, () => ({}));
    const bucket = selectMembersBucket(payload, '');
    const top = topId ? bucket.members.find((m: any) => String(m?.id || '').trim() === topId) : null;

    return res.status(200).json({
      member: top
        ? {
            id: String(top.id || ''),
            displayName: String(top.displayName || top.nick || top.globalName || top.username || top.id || ''),
            avatarUrl: String(top.avatarUrl || ''),
          }
        : null,
    });
  } catch (error) {
    console.error('[members/member-of-month] failed', error);
    return res.status(200).json({member: null});
  }
}
