import type {NextApiRequest, NextApiResponse} from 'next';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {readJsonFileCached} from '../../../lib/server/json-cache';
import {normalizeSubCrews, resolveViewerCrewContext} from '../../../lib/sub-crews';
import {resolveOwnerPreviewContext} from '../../../lib/server/owner-preview';
import {isMainGuildMember} from '../../../lib/server/viewer-access';
import {
  includeMainCrewOrderForDirtyReset,
  includeMainCrewWeekForDirtyReset,
} from '../../../lib/server/main-crew-dirty-reset';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const MEMBERS_PATH = getRuntimeDataPath('members.json');
const WASH_PATH = getRuntimeDataPath('wash.json');
const SUBCREW_WASH_PATH = getRuntimeDataPath('subcrewWash.json');
const ORDERS_PATH = getRuntimeDataPath('crewOrders.json');

type MemberRecord = {
  id: string;
  displayName?: string;
  nick?: string;
  globalName?: string;
  username?: string;
  avatarUrl?: string;
};

type MainWashWeek = {
  id: string;
  label: string;
  dirtyCents: number;
  cleanCents: number;
  entryCount: number;
  createdAt: string;
};

type SubCrewWashEntry = {
  id: string;
  date: string;
  dirtyCents: number;
  washRatePct: number;
  cleanCents: number;
  status: 'collected' | 'pending' | 'paid';
  description?: string;
  createdAt: string;
};

type CrewOverview = {
  id: string;
  kind: 'main' | 'subcrew';
  name: string;
  guildId: string;
  outlineColor: string;
  members: MemberRecord[];
  memberCount: number;
  washLog: MainWashWeek[] | SubCrewWashEntry[];
  washTotalDirtyCents: number;
  washCollectedDirtyCents: number;
  washCleanReturnedCents: number;
  orderUsedCents: number;
  ordersCount: number;
};

function readSettings() {
  const parsed = readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
  const outlineColor = typeof parsed?.outlineColor === 'string' ? parsed.outlineColor : '#ffffff14';
  return {
    ...parsed,
    outlineColor,
    subGuildId: typeof parsed?.subGuildId === 'string' ? parsed.subGuildId : '',
    subCrews: normalizeSubCrews(parsed?.subCrews, outlineColor),
  };
}

function readMembersStore() {
  return readJsonFileCached<any>(MEMBERS_PATH, () => ({}));
}

function readSubCrewWashStore() {
  return readJsonFileCached<any>(SUBCREW_WASH_PATH, () => ({crews: {}}));
}

function readMainWashStore() {
  return readJsonFileCached<any>(WASH_PATH, () => ({weeks: {}}));
}

function readOrdersStore() {
  return readJsonFileCached<any>(ORDERS_PATH, () => ({orders: []}));
}

function clampRate(raw: any) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function calcClean(dirtyCents: number, washRatePct: number) {
  const keepPct = 100 - washRatePct;
  return Math.round((dirtyCents * keepPct) / 100);
}

function normalizeStatus(raw: any): SubCrewWashEntry['status'] {
  return raw === 'paid' || raw === 'pending' ? raw : 'collected';
}

function normalizeMembers(raw: any): MemberRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((member: any) => ({
    id: String(member?.id || ''),
    displayName: String(member?.displayName || ''),
    nick: String(member?.nick || ''),
    globalName: String(member?.globalName || ''),
    username: String(member?.username || ''),
    avatarUrl: String(member?.avatarUrl || ''),
  }));
}

function summarizeMainWash(raw: any): MainWashWeek[] {
  const weeks = raw?.weeks && typeof raw.weeks === 'object' ? raw.weeks : {};
  const out: MainWashWeek[] = [];
  for (const [weekEnding, wk] of Object.entries<any>(weeks)) {
    const key = String(weekEnding || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const entries = Array.isArray(wk?.entries) ? wk.entries : [];
    let dirtyCents = 0;
    let cleanCents = 0;
    for (const entry of entries) {
      dirtyCents += Math.max(0, Math.floor(Number(entry?.dirtyCents || 0)));
      cleanCents += Math.max(0, Math.floor(Number(entry?.cleanCents || 0)));
    }
    out.push({
      id: key,
      label: key,
      dirtyCents,
      cleanCents,
      entryCount: entries.length,
      createdAt: `${key}T00:00:00.000Z`,
    });
  }
  return out.sort((a, b) => (a.label < b.label ? 1 : -1));
}

function summarizeMainWashSinceReset(raw: any, settings: any): MainWashWeek[] {
  return summarizeMainWash(raw).filter((item) => includeMainCrewWeekForDirtyReset(item.label, settings));
}

function summarizeSubCrewWash(raw: any, crewId: string): SubCrewWashEntry[] {
  const bucket = raw?.crews?.[crewId];
  const transactions = Array.isArray(bucket?.transactions) ? bucket.transactions : [];
  return transactions
    .map((entry: any) => ({
      id: String(entry?.id || ''),
      date: String(entry?.date || ''),
      dirtyCents: Math.max(0, Math.floor(Number(entry?.dirtyCents || 0))),
      washRatePct: clampRate(entry?.washRatePct),
      cleanCents: Math.max(
        0,
        Math.floor(
          Number.isFinite(Number(entry?.cleanCents))
            ? Number(entry?.cleanCents)
            : calcClean(Math.max(0, Math.floor(Number(entry?.dirtyCents || 0))), clampRate(entry?.washRatePct))
        )
      ),
      status: normalizeStatus(entry?.status),
      description: String(entry?.description || ''),
      createdAt: String(entry?.createdAt || ''),
    }))
    .filter((entry: SubCrewWashEntry) => !!entry.id)
    .sort((a: SubCrewWashEntry, b: SubCrewWashEntry) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  const settings = readSettings();
  const discordId = String((session as any)?.discordId || '').trim();
  const preview = resolveOwnerPreviewContext(req, settings, discordId);
  const viewer = resolveViewerCrewContext({
    ownerDiscordId: String(settings?.ownerDiscordId || ''),
    coOwnerDiscordIds: Array.isArray(settings?.coOwnerDiscordIds) ? settings.coOwnerDiscordIds : [],
    discordId: preview.effectiveDiscordId,
    outlineColor: String(settings?.outlineColor || '#ffffff14'),
    subCrews: settings.subCrews,
    isMainGuildMember: isMainGuildMember(preview.effectiveDiscordId),
  });
  if (viewer.viewerRole === 'external') {
    return res.status(403).json({error: 'Crew access required'});
  }
  const membersStore = readMembersStore();
  const mainWashStore = readMainWashStore();
  const subCrewWashStore = readSubCrewWashStore();
  const ordersStore = readOrdersStore();
  const allOrders = Array.isArray(ordersStore?.orders) ? ordersStore.orders : [];

  const crews: CrewOverview[] = [];

  if (viewer.viewerRole !== 'subcrew') {
    const mainMembers = normalizeMembers(membersStore?.members);
    const mainWashLog = summarizeMainWash(mainWashStore);
    const mainWashLogSinceReset = summarizeMainWashSinceReset(mainWashStore, settings);
    const mainOrderUsedCents = allOrders
      .filter((order: any) => String(order?.crewId || '') === 'main' && includeMainCrewOrderForDirtyReset(order, settings))
      .reduce(
        (sum: number, order: any) =>
          sum + Math.max(0, Math.floor(Number((order?.totalDirtyWashRequirementCents ?? order?.totalPriceCents) || 0))),
        0
      );
    crews.push({
      id: 'main',
      kind: 'main',
      name: String(settings?.guildName || '').trim() || 'Main Crew',
      guildId: String(settings?.guildId || '').trim(),
      outlineColor: String(settings?.outlineColor || '#ffffff14'),
      members: mainMembers,
      memberCount: mainMembers.length,
      washLog: mainWashLog,
      washTotalDirtyCents: mainWashLogSinceReset.reduce((sum, item) => sum + item.dirtyCents, 0),
      washCollectedDirtyCents: mainWashLogSinceReset.reduce((sum, item) => sum + item.dirtyCents, 0),
      washCleanReturnedCents: mainWashLogSinceReset.reduce((sum, item) => sum + item.cleanCents, 0),
      orderUsedCents: mainOrderUsedCents,
      ordersCount: allOrders.filter((order: any) => String(order?.crewId || '') === 'main').length,
    });
  }

  const subCrewBuckets = membersStore?.crews && typeof membersStore.crews === 'object' ? membersStore.crews : {};
  for (const crew of settings.subCrews || []) {
    if (viewer.viewerRole === 'subcrew' && viewer.viewerSubCrewId !== crew.id) continue;
    const bucket = subCrewBuckets?.[crew.id] || {};
    const members = normalizeMembers(bucket?.members);
    const washLog = summarizeSubCrewWash(subCrewWashStore, crew.id);
    const orderUsedCents = allOrders
      .filter((order: any) => String(order?.crewId || '') === crew.id)
      .reduce(
        (sum: number, order: any) =>
          sum + Math.max(0, Math.floor(Number((order?.totalDirtyWashRequirementCents ?? order?.totalPriceCents) || 0))),
        0
      );
    const washCollectedDirtyCents = washLog.reduce((sum, item) => sum + item.dirtyCents, 0);
    const washCleanReturnedCents = washLog.reduce((sum, item) => sum + item.cleanCents, 0);
    crews.push({
      id: crew.id,
      kind: 'subcrew',
      name: crew.name,
      guildId: String(settings?.subGuildId || '').trim(),
      outlineColor: crew.outlineColor || settings.outlineColor || '#ffffff14',
      members,
      memberCount: members.length,
      washLog,
      washTotalDirtyCents: washCollectedDirtyCents - orderUsedCents,
      washCollectedDirtyCents,
      washCleanReturnedCents,
      orderUsedCents,
      ordersCount: allOrders.filter((order: any) => String(order?.crewId || '') === crew.id).length,
    });
  }

  return res.status(200).json({
    crews,
  });
}
