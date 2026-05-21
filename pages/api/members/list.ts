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
const PROFILES_PATH = getRuntimeDataPath('memberProfiles.json');
const WASH_PATH = getRuntimeDataPath('wash.json');
const TOP_DIRTY_TTL_MS = 30_000;

type MembersBucket = {
  guildId: string;
  importedAt: string | null;
  count: number;
  roleOrder: any[];
  roleMap: Record<string, any>;
  members: any[];
};

let topDirtyCache: {key: string; topId: string; expiresAt: number} | null = null;

function readSettings(): any {
  const settings = readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
  const outlineColor = typeof settings?.outlineColor === 'string' ? settings.outlineColor : '#ffffff14';
  return {
    ...settings,
    subCrews: normalizeSubCrews(settings?.subCrews, outlineColor),
  };
}

function readProfiles(): Record<string, {mobileNumber?: string; ibanAccount?: string}> {
  const j = readJsonFileCached<any>(PROFILES_PATH, () => ({}));
  const by = j?.byDiscordId;
  if (!by || typeof by !== 'object') return {};
  return by as any;
}

function emptyBucket(guildId = ''): MembersBucket {
  return {
    guildId,
    importedAt: null,
    count: 0,
    roleOrder: [],
    roleMap: {},
    members: [],
  };
}

function selectMembersBucket(payload: any, subCrewId: string): MembersBucket {
  const crews = payload?.crews && typeof payload.crews === 'object' ? payload.crews : {};
  if (subCrewId) {
    const bucket = crews?.[subCrewId];
    if (bucket && typeof bucket === 'object') {
      return {
        guildId: String(bucket.guildId || ''),
        importedAt: bucket.importedAt || null,
        count: Number(bucket.count || 0) || 0,
        roleOrder: Array.isArray(bucket.roleOrder) ? bucket.roleOrder : [],
        roleMap: bucket.roleMap && typeof bucket.roleMap === 'object' ? bucket.roleMap : {},
        members: Array.isArray(bucket.members) ? bucket.members : [],
      };
    }
    return emptyBucket('');
  }

  return {
    guildId: String(payload?.guildId || ''),
    importedAt: payload?.importedAt || null,
    count: Number(payload?.count || 0) || 0,
    roleOrder: Array.isArray(payload?.roleOrder) ? payload.roleOrder : [],
    roleMap: payload?.roleMap && typeof payload.roleMap === 'object' ? payload.roleMap : {},
    members: Array.isArray(payload?.members) ? payload.members : [],
  };
}

function emptyResponse(guildId = '') {
  return {
    guildId,
    importedAt: null,
    count: 0,
    roleOrder: [],
    roleMap: {},
    members: [],
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
    const settings = readSettings();
    const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
    if (!session) return res.status(401).json({error: 'Login required'});

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
      return res.status(403).json({error: 'Main guild access required'});
    }
    const profilesById = readProfiles();
    const topDirtyId = topPrevMonthDirtyMemberId();
    const payload = readJsonFileCached<any>(MEMBERS_PATH, () => ({}));

    const bucket = selectMembersBucket(payload, '');
    if (bucket && Array.isArray(bucket.members)) {
      const members = bucket.members.map((m: any) => {
        const id = String(m?.id || '').trim();
        const p = id ? profilesById[id] : null;

        return {
          ...m,
          mobileNumber: p?.mobileNumber ? String(p.mobileNumber) : null,
          ibanAccount: p?.ibanAccount ? String(p.ibanAccount) : null,
          isPrevMonthTopDirty: id && id === topDirtyId,
        };
      });

      return res.status(200).json({
        guildId: bucket.guildId,
        importedAt: bucket.importedAt,
        roleOrder: bucket.roleOrder,
        roleMap: bucket.roleMap,
        count: members.length,
        members,
      });
    }

    return res.status(200).json(emptyResponse(String(settings?.guildId || '')));
  } catch (error) {
    console.error('[members/list] failed', error);
    return res.status(200).json(emptyResponse(''));
  }
}
