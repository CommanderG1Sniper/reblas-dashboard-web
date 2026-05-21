import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {hasOwnerAccess} from '../../../lib/owner-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const MEMBERS_PATH = getRuntimeDataPath('members.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
}

function readSettings(): any {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
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

function normalizeSubCrews(raw: any) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of raw) {
    const id = String(item?.id || '').trim();
    const name = String(item?.name || '').trim();
    if (!id || !name || seen.has(id)) continue;
    const guildId = String(item?.guildId || '').trim();
    out.push({
      id,
      name,
      guildId: /^\d{6,25}$/.test(guildId) ? guildId : '',
      outlineColor: String(item?.outlineColor || '').trim(),
      roleIds: normalizeMemberIdList(item?.roleIds),
      memberIds: normalizeMemberIdList(item?.memberIds),
    });
    seen.add(id);
  }
  return out;
}

function filterMembersForCrewRules(payload: any, crew: any) {
  const requiredRoleIds = normalizeMemberIdList(crew?.roleIds);
  if (!requiredRoleIds.length) return payload;
  const required = new Set(requiredRoleIds);
  return {
    ...payload,
    count: Array.isArray(payload?.members)
      ? payload.members.filter((member: any) => {
          const roles = Array.isArray(member?.roles) ? member.roles.map(String) : [];
          return roles.some((roleId: string) => required.has(roleId));
        }).length
      : 0,
    members: Array.isArray(payload?.members)
      ? payload.members.filter((member: any) => {
          const roles = Array.isArray(member?.roles) ? member.roles.map(String) : [];
          return roles.some((roleId: string) => required.has(roleId));
        })
      : [],
  };
}

function writeSettings(next: any) {
  ensureDataDir();
  const tmp = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
}

function writeMembers(payload: any) {
  ensureDataDir();
  const tmp = MEMBERS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, MEMBERS_PATH);
}

function readMembers(): any {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(MEMBERS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
}

function defaultAvatarIndexFromId(id: string): number {
  try {
    return Number(BigInt(id) % 5n);
  } catch {
    return 0;
  }
}

function buildAvatarUrl(guildId: string, member: any): string {
  const user = member?.user || {};
  const id = String(user?.id || '').trim();
  if (!id) return '';
  if (member?.avatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${id}/avatars/${member.avatar}.png?size=128`;
  }
  if (user?.avatar) {
    return `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128`;
  }
  const idx = defaultAvatarIndexFromId(id);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function importGuild(guildId: string, botToken: string) {
  const rolesUrl = `https://discord.com/api/v10/guilds/${guildId}/roles`;
  const rolesRes = await fetch(rolesUrl, {
    method: 'GET',
    headers: {Authorization: `Bot ${botToken}`},
  });

  if (!rolesRes.ok) {
    const txt = await rolesRes.text().catch(() => '');
    throw new Error(`Discord roles API error (${rolesRes.status}): ${txt.slice(0, 500)}`);
  }

  const rolesRaw = (await rolesRes.json()) as any[];
  const roleMap: Record<string, {name: string; position: number; color: number}> = {};
  for (const r of rolesRaw || []) {
    const id = String(r?.id || '').trim();
    if (!id) continue;
    roleMap[id] = {
      name: String(r?.name || '').trim(),
      position: Number(r?.position || 0),
      color: Number(r?.color || 0),
    };
  }

  const roleOrder = Object.entries(roleMap)
    .map(([id, v]) => ({id, name: v.name, position: v.position, color: v.color}))
    .sort((a, b) => b.position - a.position);

  const all: any[] = [];
  let after = '0';
  for (let page = 0; page < 50; page++) {
    const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: {Authorization: `Bot ${botToken}`},
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Discord members API error (${r.status}): ${txt.slice(0, 500)}`);
    }
    const batch = (await r.json()) as any[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const m of batch) {
      const u = m.user || {};
      const id = String(u.id || '').trim();
      if (!id) continue;
      const username = String(u.username || '').trim();
      const globalName = String(u.global_name || '').trim();
      const nick = String(m.nick || '').trim();
      const displayName = nick || globalName || username || id;
      const roleIds = Array.isArray(m.roles) ? m.roles.map(String) : [];
      const roleIdsNoEveryone = roleIds.filter((rid: string) => rid && rid !== guildId);
      const rolesSorted = roleIdsNoEveryone
        .slice()
        .sort((a: string, b: string) => (roleMap[b]?.position || 0) - (roleMap[a]?.position || 0));
      const topRolePosition = rolesSorted.length ? (roleMap[rolesSorted[0]]?.position || 0) : 0;
      all.push({
        id,
        username,
        globalName,
        nick,
        displayName,
        avatarUrl: buildAvatarUrl(guildId, m),
        roles: roleIdsNoEveryone,
        rolesSorted,
        topRolePosition,
      });
    }

    const last = batch[batch.length - 1]?.user?.id;
    after = String(last || after);
    if (batch.length < 1000) break;
  }

  all.sort((a, b) => {
    const d = Number(b.topRolePosition || 0) - Number(a.topRolePosition || 0);
    if (d !== 0) return d;
    return String(a.displayName || '').localeCompare(String(b.displayName || ''));
  });

  return {
    guildId,
    importedAt: new Date().toISOString(),
    count: all.length,
    roleOrder,
    roleMap,
    members: all,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const settings = readSettings();

  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  if (!isOwner(session as any, settings)) return res.status(403).json({error: 'Owner only'});

  const guildId = String(settings?.guildId || '').trim();
  const subGuildId = String(settings?.subGuildId || '').trim();
  const botToken = String(settings?.botToken || '').trim();

  if (!guildId) return res.status(400).json({error: 'Guild ID is missing (set it in Main Settings).'});
  if (!botToken) return res.status(400).json({error: 'Bot Token is missing (set it in Main Settings).'});

  try {
    const subCrews = normalizeSubCrews(settings?.subCrews);
    const requestedCrewId = String(req.body?.crewId || req.query?.crewId || '').trim();

    if (requestedCrewId) {
      const crew = subCrews.find((item) => item.id === requestedCrewId);
      if (!crew) return res.status(404).json({error: 'Sub crew not found'});
      if (!subGuildId) return res.status(400).json({error: 'Sub Guild ID is missing (set it in Setup).'});

      const crewPayload = filterMembersForCrewRules(await importGuild(subGuildId, botToken), crew);
      const store = readMembers();
      const nextStore: any = {
        guildId: String(store?.guildId || guildId),
        importedAt: store?.importedAt || null,
        count: Number(store?.count || 0) || 0,
        roleOrder: Array.isArray(store?.roleOrder) ? store.roleOrder : [],
        roleMap: store?.roleMap && typeof store.roleMap === 'object' ? store.roleMap : {},
        members: Array.isArray(store?.members) ? store.members : [],
        crews: store?.crews && typeof store.crews === 'object' ? store.crews : {},
      };
      nextStore.crews[crew.id] = crewPayload;

      const nextSettings = {
        ...settings,
        subCrews: subCrews.map((item) =>
          item.id === crew.id
            ? {
                ...item,
                memberIds: normalizeMemberIdList(crewPayload.members.map((member: any) => member.id)),
              }
            : item
        ),
      };

      writeMembers(nextStore);
      writeSettings(nextSettings);

      return res.status(200).json({
        ok: true,
        crewId: crew.id,
        count: crewPayload.count,
      });
    }

    const payload = await importGuild(guildId, botToken);
    const nextSettings = {...settings, subCrews: subCrews.map((crew) => ({...crew, memberIds: []}))};
    const store: any = {
      guildId: payload.guildId,
      importedAt: payload.importedAt,
      count: payload.count,
      roleOrder: payload.roleOrder,
      roleMap: payload.roleMap,
      members: payload.members,
      crews: {},
    };

    const subGuildPayload = subGuildId ? await importGuild(subGuildId, botToken) : null;

    for (const crew of subCrews) {
      if (!subGuildPayload) continue;
      const crewPayload = filterMembersForCrewRules(subGuildPayload, crew);
      store.crews[crew.id] = crewPayload;
      const idx = nextSettings.subCrews.findIndex((item: any) => item.id === crew.id);
      if (idx >= 0) {
        nextSettings.subCrews[idx] = {
          ...nextSettings.subCrews[idx],
          memberIds: normalizeMemberIdList(crewPayload.members.map((member: any) => member.id)),
        };
      }
    }

    writeMembers(store);
    writeSettings(nextSettings);

    return res.status(200).json({
      ok: true,
      count: payload.count,
      subCrewGuilds: Object.keys(store.crews).length,
    });
  } catch (e: any) {
    return res.status(500).json({error: e?.message || 'Import failed'});
  }
}
