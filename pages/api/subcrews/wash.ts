import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {normalizeSubCrews, resolveViewerCrewContext} from '../../../lib/sub-crews';
import {invalidateJsonFileCache, readJsonFileCached} from '../../../lib/server/json-cache';
import {resolveOwnerPreviewContext} from '../../../lib/server/owner-preview';
import {isMainGuildMember} from '../../../lib/server/viewer-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const STORE_PATH = getRuntimeDataPath('subcrewWash.json');
const ORDERS_PATH = getRuntimeDataPath('crewOrders.json');
const EMBEDS_PATH = getRuntimeDataPath('embeds.json');

type Transaction = {
  id: string;
  date: string;
  dirtyCents: number;
  washRatePct: number;
  cleanCents: number;
  status: 'collected' | 'pending' | 'paid';
  description?: string;
  createdAt: string;
  createdBy: string;
  embedMessageId?: string;
  embedChannelId?: string;
};

type CrewBucket = {
  transactions: Transaction[];
};

type Store = {
  schemaVersion: number;
  crews: Record<string, CrewBucket>;
};

const DEFAULT_STORE: Store = {
  schemaVersion: 2,
  crews: {},
};

const DEFAULT_WASH_LOG_TEMPLATE = {
  title: '{crewName} Wash Log',
  description:
    'Date: {date}\nDirty Collected: {dirtyCollected}\nWash Rate: {washRate}\nClean Returned: {cleanReturned}\nCurrent Dirty Collected Total: {dirtyCollectedTotal}',
  color: '#3b82f6',
};

function getDashboardUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://reblasmafia.win').trim();
}

function buildDashboardLinkComponents() {
  const url = getDashboardUrl();
  if (!/^https?:\/\//i.test(url)) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: 'Open Dashboard',
          url,
        },
      ],
    },
  ];
}

function normalizeRoleIdList(raw: any) {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const id = String(item || '').trim();
    if (/^\d{6,25}$/.test(id)) out.push(id);
  }
  return Array.from(new Set(out));
}

function buildRoleMentionPayload(rawRoleIds: any) {
  const roleIds = normalizeRoleIdList(rawRoleIds);
  if (roleIds.length === 0) return {content: '', allowedMentions: {parse: [] as string[]}};
  return {
    content: roleIds.map((roleId) => `<@&${roleId}>`).join(' '),
    allowedMentions: {
      parse: [] as string[],
      roles: roleIds,
    },
  };
}

type EmbedSendResult = {
  ok: boolean;
  error?: string;
  messageId?: string;
};

function truncateEmbedText(value: string, maxLength: number) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text || 'None';
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
  }
}

function readSettings() {
  try {
    const parsed = readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
    const outlineColor = typeof parsed?.outlineColor === 'string' ? parsed.outlineColor : '#ffffff14';
    return {
      ownerDiscordId: typeof parsed?.ownerDiscordId === 'string' ? parsed.ownerDiscordId : '',
      coOwnerDiscordIds: Array.isArray(parsed?.coOwnerDiscordIds) ? parsed.coOwnerDiscordIds : [],
      guildName: typeof parsed?.guildName === 'string' ? parsed.guildName : 'Reblas Mafia',
      guildAvatar: typeof parsed?.guildAvatar === 'string' ? parsed.guildAvatar : '',
      outlineColor,
      botToken: typeof parsed?.botToken === 'string' ? parsed.botToken : '',
      defaultWashRatePct: clampRate(parsed?.defaultWashRatePct),
      subCrews: normalizeSubCrews(parsed?.subCrews, outlineColor),
    };
  } catch {
    return {
      ownerDiscordId: '',
      coOwnerDiscordIds: [],
      guildName: 'Reblas Mafia',
      guildAvatar: '',
      outlineColor: '#ffffff14',
      botToken: '',
      defaultWashRatePct: 25,
      subCrews: [],
    };
  }
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

function normalizeStatus(raw: any): Transaction['status'] {
  return raw === 'paid' || raw === 'pending' ? raw : 'collected';
}

function readStore(): Store {
  ensureFiles();
  try {
    const parsed = readJsonFileCached<any>(STORE_PATH, () => DEFAULT_STORE);
    const defaultWashRatePct = readSettings().defaultWashRatePct;
    const crews = parsed?.crews && typeof parsed.crews === 'object' ? parsed.crews : {};
    const out: Record<string, CrewBucket> = {};
    for (const [crewId, bucket] of Object.entries<any>(crews)) {
      out[String(crewId)] = {
        transactions: Array.isArray(bucket?.transactions)
          ? bucket.transactions
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
                      : calcClean(
                          Math.max(0, Math.floor(Number(entry?.dirtyCents || 0))),
                          clampRate(entry?.washRatePct ?? defaultWashRatePct)
                        )
                  )
                ),
                status: normalizeStatus(entry?.status),
                description: String(entry?.description || ''),
                createdAt: String(entry?.createdAt || ''),
                createdBy: String(entry?.createdBy || ''),
                embedMessageId: String(entry?.embedMessageId || '').trim(),
                embedChannelId: String(entry?.embedChannelId || '').trim(),
              }))
              .filter((entry: Transaction) => entry.id && /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
          : [],
      };
    }
    return {
      schemaVersion: 2,
      crews: out,
    };
  } catch {
    return DEFAULT_STORE;
  }
}

function writeStore(next: Store) {
  ensureFiles();
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
  invalidateJsonFileCache(STORE_PATH);
}

function getDiscordId(session: any) {
  return String(session?.discordId || session?.user?.id || '').trim();
}

function sortTransactions(entries: Transaction[]) {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(a.createdAt || '') < String(b.createdAt || '') ? 1 : -1;
  });
}

function readOrdersValueForCrew(crewId: string) {
  try {
    const parsed = readJsonFileCached<any>(ORDERS_PATH, () => ({orders: []}));
    const orders = Array.isArray(parsed?.orders) ? parsed.orders : [];
    return orders.reduce((sum: number, order: any) => {
      if (String(order?.crewId || '').trim() !== crewId) return sum;
      return sum + Math.max(0, Math.floor(Number((order?.totalDirtyWashRequirementCents ?? order?.totalPriceCents) || 0)));
    }, 0);
  } catch {
    return 0;
  }
}

function buildResponse(crewId: string, crewName: string, transactions: Transaction[]) {
  const sorted = sortTransactions(transactions);
  const dirtyCollectedCents = sorted.reduce((sum, entry) => sum + (Number(entry.dirtyCents || 0) || 0), 0);
  const cleanReturnedCents = sorted.reduce((sum, entry) => sum + (Number(entry.cleanCents || 0) || 0), 0);
  const orderUsedCents = readOrdersValueForCrew(crewId);
  return {
    crewId,
    crewName,
    transactions: sorted,
    totals: {
      dirtyCollectedCents,
      cleanReturnedCents,
      orderUsedCents,
      availableDirtyCents: dirtyCollectedCents - orderUsedCents,
      entryCount: sorted.length,
      collectedCount: sorted.filter((entry) => entry.status === 'collected').length,
      pendingCount: sorted.filter((entry) => entry.status === 'pending').length,
      paidCount: sorted.filter((entry) => entry.status === 'paid').length,
    },
  };
}

function formatWholeCents(cents: number) {
  return Math.round(Number(cents || 0) / 100).toLocaleString();
}

function outlineColorToDecimal(hex: string) {
  const clean = String(hex || '').trim().replace('#', '').slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0x3b82f6;
  return parseInt(clean, 16);
}

function normalizeDiscordImageUrl(raw: any) {
  const value = String(raw || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function readWashLogTemplate() {
  try {
    const parsed = readJsonFileCached<any>(EMBEDS_PATH, () => ({}));
    const raw = parsed?.subCrewTemplates?.subcrew_wash_log || {};
    return {
      title: String(raw?.title || DEFAULT_WASH_LOG_TEMPLATE.title).trim().slice(0, 200) || DEFAULT_WASH_LOG_TEMPLATE.title,
      description:
        String(raw?.description || DEFAULT_WASH_LOG_TEMPLATE.description).trim().slice(0, 1500) || DEFAULT_WASH_LOG_TEMPLATE.description,
      color: String(raw?.color || DEFAULT_WASH_LOG_TEMPLATE.color).trim() || DEFAULT_WASH_LOG_TEMPLATE.color,
    };
  } catch {
    return DEFAULT_WASH_LOG_TEMPLATE;
  }
}

function applyTemplate(template: string, values: Record<string, string>) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

function washLogColorHex(status: Transaction['status'], fallbackHex: string) {
  if (status === 'paid') return '#22c55e';
  if (status === 'pending') return '#f59e0b';
  return fallbackHex;
}

function buildWashLogEmbed(args: {
  guildName?: string;
  guildAvatar?: string;
  crewName: string;
  crewOutlineColor: string;
  entry: Transaction;
  dirtyWashTotalCents: number;
}) {
  const template = readWashLogTemplate();
  const guildAvatarUrl = normalizeDiscordImageUrl(args.guildAvatar);
  const colorHex = washLogColorHex(args.entry.status, template.color || args.crewOutlineColor);
  const statusLabel = args.entry.status === 'paid' ? 'Paid' : args.entry.status === 'pending' ? 'Pending' : 'Collected';
  const values = {
    crewName: args.crewName,
    date: args.entry.date,
    dirtyCollected: formatWholeCents(args.entry.dirtyCents),
    washRate: `${args.entry.washRatePct}%`,
    cleanReturned: formatWholeCents(args.entry.cleanCents),
    dirtyCollectedTotal: formatWholeCents(args.dirtyWashTotalCents),
    notes: String(args.entry.description || '').trim() || 'None',
  };

  return {
    author: {
      name: `${args.guildName || 'Reblas Mafia'} • ${args.crewName}`,
      ...(guildAvatarUrl ? {icon_url: guildAvatarUrl} : {}),
    },
    title: applyTemplate(template.title, values),
    description: applyTemplate(template.description, values),
    color: outlineColorToDecimal(colorHex),
    fields: [
      {
        name: 'Status',
        value: statusLabel,
        inline: true,
      },
      {
        name: 'Date',
        value: args.entry.date,
        inline: true,
      },
      {
        name: 'Wash Rate',
        value: `${args.entry.washRatePct}%`,
        inline: true,
      },
      {
        name: 'Dirty Collected',
        value: formatWholeCents(args.entry.dirtyCents),
        inline: true,
      },
      {
        name: 'Clean Returned',
        value: formatWholeCents(args.entry.cleanCents),
        inline: true,
      },
      {
        name: 'Current Dirty Total',
        value: formatWholeCents(args.dirtyWashTotalCents),
        inline: true,
      },
      ...(values.notes !== 'None'
        ? [
            {
              name: 'Notes',
              value: truncateEmbedText(values.notes, 1024),
              inline: false,
            },
          ]
        : []),
    ],
    timestamp: args.entry.createdAt,
    footer: {
      text: `${statusLabel} • Wash Entry: ${String(args.entry.id || '').slice(-8)}`,
    },
  } as any;
}

async function postWashLogEmbed(args: {
  botToken: string;
  channelId: string;
  mentionRoleIds?: string[];
  guildName?: string;
  guildAvatar?: string;
  crewName: string;
  crewOutlineColor: string;
  entry: Transaction;
  dirtyWashTotalCents: number;
}) {
  const token = String(args.botToken || '').trim();
  const channelId = String(args.channelId || '').trim();
  if (!token || !/^\d{6,25}$/.test(channelId)) {
    return {ok: false, error: 'Missing bot token or valid channel ID'};
  }
  const embed = buildWashLogEmbed(args);
  const mentionPayload = buildRoleMentionPayload(args.mentionRoleIds);

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify({
      content: mentionPayload.content,
      allowed_mentions: mentionPayload.allowedMentions,
      embeds: [embed],
      components: buildDashboardLinkComponents(),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {ok: false, error: `Discord API ${res.status}${text ? `: ${text}` : ''}`};
  }
  const payload = await res.json().catch(() => ({}));
  const messageId = String((payload as any)?.id || '').trim();
  return {ok: true, messageId};
}

async function updateWashLogEmbed(args: {
  botToken: string;
  channelId: string;
  messageId: string;
  mentionRoleIds?: string[];
  guildName?: string;
  guildAvatar?: string;
  crewName: string;
  crewOutlineColor: string;
  entry: Transaction;
  dirtyWashTotalCents: number;
}) {
  const token = String(args.botToken || '').trim();
  const channelId = String(args.channelId || '').trim();
  const messageId = String(args.messageId || '').trim();
  if (!token || !/^\d{6,25}$/.test(channelId) || !/^\d{6,25}$/.test(messageId)) {
    return {ok: false, error: 'Missing bot token, channel ID, or message ID'};
  }

  const embed = buildWashLogEmbed(args);
  const mentionPayload = buildRoleMentionPayload(args.mentionRoleIds);
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify({
      content: mentionPayload.content,
      allowed_mentions: mentionPayload.allowedMentions,
      embeds: [embed],
      components: buildDashboardLinkComponents(),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {ok: false, error: `Discord API ${res.status}${text ? `: ${text}` : ''}`};
  }
  return {ok: true};
}

function resolveCrewAccess(req: NextApiRequest, session: any) {
  const settings = readSettings();
  const discordId = getDiscordId(session);
  const preview = resolveOwnerPreviewContext(req, settings, discordId);
  const viewer = resolveViewerCrewContext({
    ownerDiscordId: settings.ownerDiscordId,
    coOwnerDiscordIds: settings.coOwnerDiscordIds,
    discordId: preview.effectiveDiscordId,
    outlineColor: settings.outlineColor,
    subCrews: settings.subCrews,
    isMainGuildMember: isMainGuildMember(preview.effectiveDiscordId),
  });

  const explicitCrewId = String(req.query.crewId || req.body?.crewId || '').trim();
  const crewId = viewer.viewerRole === 'subcrew' ? viewer.viewerSubCrewId : explicitCrewId;
  const crew = settings.subCrews.find((item) => item.id === crewId) || null;

  return {settings, viewer, crew, crewId, discordId: preview.effectiveDiscordId, previewActive: preview.active};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  const {settings, viewer, crew, crewId, discordId, previewActive} = resolveCrewAccess(req, session);
  if (viewer.viewerRole !== 'owner' && viewer.viewerRole !== 'subcrew') {
    return res.status(403).json({error: 'Sub crew access required'});
  }
  if (!crew || !crewId) return res.status(404).json({error: 'Sub crew not found'});
  if (viewer.viewerRole === 'subcrew' && viewer.viewerSubCrewId !== crewId) {
    return res.status(403).json({error: 'Access denied'});
  }

  const store = readStore();
  if (!store.crews[crewId]) store.crews[crewId] = {transactions: []};

  if (req.method === 'GET') {
    return res.status(200).json(buildResponse(crewId, crew.name, store.crews[crewId].transactions));
  }
  if (previewActive) {
    return res.status(403).json({error: 'Member view is read-only for sub crew wash changes'});
  }

  if (req.method === 'POST') {
    const action = String(req.body?.action || 'create').trim();

    if (action === 'create') {
      const date = String(req.body?.date || '').trim();
      const description = String(req.body?.description || '').trim().slice(0, 120);
      const dirtyCents = Math.floor(Number(req.body?.dirtyCents || 0));
      const washRatePct = clampRate(req.body?.washRatePct);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error: 'Valid date required'});
      if (!Number.isFinite(dirtyCents) || dirtyCents <= 0) {
        return res.status(400).json({error: 'Dirty amount must be greater than zero'});
      }

      const entry: Transaction = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        date,
        dirtyCents,
        washRatePct,
        cleanCents: calcClean(dirtyCents, washRatePct),
        status: 'collected',
        description,
        createdAt: new Date().toISOString(),
        createdBy: discordId,
      };
      store.crews[crewId].transactions.push(entry);
      writeStore(store);
      const payload = buildResponse(crewId, crew.name, store.crews[crewId].transactions);
      const embedResult: EmbedSendResult = await postWashLogEmbed({
        botToken: settings.botToken,
        channelId: crew.washLogChannelId || '',
        mentionRoleIds: crew.washLogMentionRoleIds || [],
        guildName: String(settings.guildName || 'Reblas Mafia'),
        guildAvatar: String(settings.guildAvatar || '').trim(),
        crewName: crew.name,
        crewOutlineColor: crew.outlineColor || settings.outlineColor,
        entry,
        dirtyWashTotalCents: payload.totals.availableDirtyCents,
      }).catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown embed error',
      }));
      if (embedResult?.ok && embedResult.messageId) {
        const entryIdx = store.crews[crewId].transactions.findIndex((item) => item.id === entry.id);
        if (entryIdx >= 0) {
          store.crews[crewId].transactions[entryIdx] = {
            ...store.crews[crewId].transactions[entryIdx],
            embedMessageId: embedResult.messageId,
            embedChannelId: crew.washLogChannelId || '',
          };
          writeStore(store);
        }
      }
      if (!embedResult?.ok) {
        console.error('[subcrews/wash] Failed to send wash log embed', {
          crewId,
          channelId: crew.washLogChannelId || '',
          error: embedResult?.error || 'Unknown error',
        });
      }
      return res.status(200).json({
        ok: true,
        embedSent: !!embedResult?.ok,
        embedError: embedResult?.ok ? '' : String(embedResult?.error || ''),
        ...payload,
      });
    }

    if (action === 'set_status') {
      const entryId = String(req.body?.entryId || '').trim();
      const status = normalizeStatus(req.body?.status);
      if (!entryId) return res.status(400).json({error: 'Entry ID required'});
      const idx = store.crews[crewId].transactions.findIndex((entry) => entry.id === entryId);
      if (idx < 0) return res.status(404).json({error: 'Wash entry not found'});
      const updatedEntry: Transaction = {
        ...store.crews[crewId].transactions[idx],
        status,
      };
      store.crews[crewId].transactions[idx] = updatedEntry;
      writeStore(store);
      const payload = buildResponse(crewId, crew.name, store.crews[crewId].transactions);
      let embedResult: EmbedSendResult | null = null;
      if (updatedEntry.embedMessageId && updatedEntry.embedChannelId) {
        embedResult = await updateWashLogEmbed({
          botToken: settings.botToken,
          channelId: updatedEntry.embedChannelId,
          messageId: updatedEntry.embedMessageId,
          mentionRoleIds: crew.washLogMentionRoleIds || [],
          guildName: String(settings.guildName || 'Reblas Mafia'),
          guildAvatar: String(settings.guildAvatar || '').trim(),
          crewName: crew.name,
          crewOutlineColor: crew.outlineColor || settings.outlineColor,
          entry: updatedEntry,
          dirtyWashTotalCents: payload.totals.availableDirtyCents,
        }).catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown embed update error',
        }));
      } else {
        embedResult = await postWashLogEmbed({
          botToken: settings.botToken,
          channelId: crew.washLogChannelId || '',
          mentionRoleIds: crew.washLogMentionRoleIds || [],
          guildName: String(settings.guildName || 'Reblas Mafia'),
          guildAvatar: String(settings.guildAvatar || '').trim(),
          crewName: crew.name,
          crewOutlineColor: crew.outlineColor || settings.outlineColor,
          entry: updatedEntry,
          dirtyWashTotalCents: payload.totals.availableDirtyCents,
        }).catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown embed send error',
        }));
        if (embedResult?.ok && embedResult.messageId) {
          store.crews[crewId].transactions[idx] = {
            ...store.crews[crewId].transactions[idx],
            embedMessageId: embedResult.messageId,
            embedChannelId: crew.washLogChannelId || '',
          };
          writeStore(store);
        }
      }
      if (!embedResult?.ok) {
        console.error('[subcrews/wash] Failed to update wash log embed', {
          crewId,
          entryId,
          channelId: updatedEntry.embedChannelId || crew.washLogChannelId || '',
          messageId: updatedEntry.embedMessageId || '',
          error: embedResult?.error || 'Unknown error',
        });
      }
      return res.status(200).json({
        ok: true,
        embedSent: !!embedResult?.ok,
        embedError: embedResult?.ok ? '' : String(embedResult?.error || ''),
        ...payload,
      });
    }

    return res.status(400).json({error: 'Unsupported action'});
  }

  if (req.method === 'DELETE') {
    const entryId = String(req.body?.entryId || '').trim();
    if (!entryId) return res.status(400).json({error: 'Entry ID required'});
    store.crews[crewId].transactions = store.crews[crewId].transactions.filter((entry) => entry.id !== entryId);
    writeStore(store);
    return res.status(200).json({
      ok: true,
      ...buildResponse(crewId, crew.name, store.crews[crewId].transactions),
    });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({error: 'Method not allowed'});
}
