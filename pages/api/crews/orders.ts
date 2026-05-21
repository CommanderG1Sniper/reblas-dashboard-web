import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../../lib/server/json-cache';
import {normalizeSubCrews, resolveViewerCrewContext} from '../../../lib/sub-crews';
import {resolveOrderPermissions} from '../../../lib/order-permissions';
import {resolveOwnerPreviewContext} from '../../../lib/server/owner-preview';
import {isMainGuildMember} from '../../../lib/server/viewer-access';
import {
  includeMainCrewOrderForDirtyReset,
  includeMainCrewWeekForDirtyReset,
} from '../../../lib/server/main-crew-dirty-reset';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const ITEMS_PATH = getRuntimeDataPath('items.json');
const ORDERS_PATH = getRuntimeDataPath('crewOrders.json');
const WASH_PATH = getRuntimeDataPath('wash.json');
const SUBCREW_WASH_PATH = getRuntimeDataPath('subcrewWash.json');
const EMBEDS_PATH = getRuntimeDataPath('embeds.json');

type ItemRecord = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  category: 'mats' | 'orders';
  dirtyWashRequirementCents: number;
  cleanCashCents: number;
  dirtyCashCents: number;
  materials: Array<{matId: string; quantity: number}>;
  active: boolean;
};

type OrderMaterial = {
  matId: string;
  matName: string;
  quantity: number;
};

type OrderLine = {
  itemId: string;
  itemName: string;
  itemImageUrl: string;
  unitDirtyWashRequirementCents: number;
  unitCleanCashCents: number;
  unitDirtyCashCents: number;
  quantity: number;
  totalDirtyWashRequirementCents: number;
  totalCleanCashCents: number;
  totalDirtyCashCents: number;
  materials: OrderMaterial[];
};

type OrderRecord = {
  id: string;
  crewId: string;
  itemId: string;
  itemName: string;
  itemImageUrl: string;
  unitDirtyWashRequirementCents: number;
  unitCleanCashCents: number;
  unitDirtyCashCents: number;
  materials: OrderMaterial[];
  quantity: number;
  totalDirtyWashRequirementCents: number;
  totalCleanCashCents: number;
  totalDirtyCashCents: number;
  lines: OrderLine[];
  note: string;
  status: 'placed' | 'pending' | 'completed' | 'cancelled';
  cancelReason: string;
  cancelledAt: string;
  cancelledBy: string;
  createdAt: string;
  createdBy: string;
  embedMessageId: string;
  embedChannelId: string;
};

type OrdersFile = {
  schemaVersion: number;
  orders: OrderRecord[];
};

type SubCrewEmbedTemplate = {
  title: string;
  description: string;
  color: string;
};

type OrderEmbedSyncResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

const DEFAULT_ORDERS: OrdersFile = {
  schemaVersion: 2,
  orders: [],
};

const DEFAULT_ORDER_UPDATE_TEMPLATE: SubCrewEmbedTemplate = {
  title: '{crewName} Order {statusLabel}',
  description:
    'Status: {statusLabel}\nItems:\n{items}\n\nDirty Wash: {dirtyWash}\nClean Cost: {cleanCost}\nDirty Cash: {dirtyCash}\nMaterials: {materials}\nNote: {note}\nCancel Reason: {cancelReason}',
  color: '#22c55e',
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

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(ORDERS_PATH)) {
    fs.writeFileSync(ORDERS_PATH, JSON.stringify(DEFAULT_ORDERS, null, 2), 'utf8');
  }
}

function resolveDiscordBotToken(raw: any) {
  const fromSettings = String(raw || '').trim();
  if (fromSettings) return fromSettings;
  const envToken = String(
    process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || process.env.REBLAS_BOT_TOKEN || process.env.DISCORD_TOKEN || ''
  ).trim();
  return envToken;
}

function readSettings() {
  const parsed = readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
  const outlineColor = typeof parsed?.outlineColor === 'string' ? parsed.outlineColor : '#ffffff14';
  return {
    ...parsed,
    botToken: resolveDiscordBotToken(parsed?.botToken),
    mainCrewOrderUpdatesChannelId:
      /^\d{6,25}$/.test(String(parsed?.mainCrewOrderUpdatesChannelId || '').trim())
        ? String(parsed.mainCrewOrderUpdatesChannelId).trim()
        : '',
    outlineColor,
    subCrews: normalizeSubCrews(parsed?.subCrews, outlineColor),
  };
}

function readCatalogItems(): ItemRecord[] {
  const parsed = readJsonFileCached<any>(ITEMS_PATH, () => ({items: []}));
  return Array.isArray(parsed?.items)
    ? parsed.items.map((item: any) => ({
        id: String(item?.id || '').trim(),
        name: String(item?.name || '').trim(),
        description: String(item?.description || '').trim(),
        imageUrl: String(item?.imageUrl || '').trim(),
        category: item?.category === 'mats' ? 'mats' : 'orders',
        dirtyWashRequirementCents: Math.max(
          0,
          Math.floor(Number((item?.dirtyWashRequirementCents ?? item?.priceCents) || 0))
        ),
        cleanCashCents: Math.max(0, Math.floor(Number(item?.cleanCashCents || 0))),
        dirtyCashCents: Math.max(0, Math.floor(Number(item?.dirtyCashCents || 0))),
        materials: Array.isArray(item?.materials)
          ? item.materials
              .map((entry: any) => ({
                matId: String(entry?.matId || '').trim(),
                quantity: Math.max(1, Math.floor(Number(entry?.quantity || 1))),
              }))
              .filter((entry: any) => !!entry.matId)
          : [],
        active: item?.active !== undefined ? !!item.active : true,
      }))
    : [];
}

function readItems() {
  return readCatalogItems().filter((item) => item.category === 'orders');
}

function buildMatNameMap() {
  const names = new Map<string, string>();
  for (const item of readCatalogItems()) {
    if (item.category === 'mats') names.set(item.id, item.name);
  }
  return names;
}

function aggregateMaterials(materials: OrderMaterial[]) {
  const grouped = new Map<string, OrderMaterial>();
  for (const entry of materials) {
    const key = entry.matId || entry.matName;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += Math.max(1, Math.floor(Number(entry.quantity || 0)));
    } else {
      grouped.set(key, {
        matId: entry.matId,
        matName: entry.matName,
        quantity: Math.max(1, Math.floor(Number(entry.quantity || 0))),
      });
    }
  }
  return Array.from(grouped.values());
}

function buildLineFromItem(item: ItemRecord, quantity: number, matNames: Map<string, string>): OrderLine {
  const safeQty = Math.max(1, Math.floor(Number(quantity || 1)));
  const materials = aggregateMaterials(
    (item.materials || []).map((entry) => ({
      matId: entry.matId,
      matName: matNames.get(entry.matId) || entry.matId,
      quantity: Math.max(1, Math.floor(Number(entry.quantity || 1))) * safeQty,
    }))
  );
  return {
    itemId: item.id,
    itemName: item.name,
    itemImageUrl: item.imageUrl || '',
    unitDirtyWashRequirementCents: item.dirtyWashRequirementCents,
    unitCleanCashCents: item.cleanCashCents,
    unitDirtyCashCents: item.dirtyCashCents,
    quantity: safeQty,
    totalDirtyWashRequirementCents: item.dirtyWashRequirementCents * safeQty,
    totalCleanCashCents: item.cleanCashCents * safeQty,
    totalDirtyCashCents: item.dirtyCashCents * safeQty,
    materials,
  };
}

function normalizeLine(raw: any, matNames: Map<string, string>): OrderLine | null {
  const itemId = String(raw?.itemId || '').trim();
  const itemName = String(raw?.itemName || '').trim();
  const quantity = Math.max(1, Math.floor(Number(raw?.quantity || 1)));
  if (!itemId && !itemName) return null;

  const unitDirtyWashRequirementCents = Math.max(
    0,
    Math.floor(Number((raw?.unitDirtyWashRequirementCents ?? raw?.unitPriceCents) || 0))
  );
  const unitCleanCashCents = Math.max(0, Math.floor(Number(raw?.unitCleanCashCents || 0)));
  const unitDirtyCashCents = Math.max(0, Math.floor(Number(raw?.unitDirtyCashCents || 0)));

  const materials = aggregateMaterials(
    Array.isArray(raw?.materials)
      ? raw.materials
          .map((entry: any) => ({
            matId: String(entry?.matId || '').trim(),
            matName: String(entry?.matName || '').trim() || matNames.get(String(entry?.matId || '').trim()) || String(entry?.matId || '').trim(),
            quantity: Math.max(1, Math.floor(Number(entry?.quantity || 1))),
          }))
          .filter((entry: OrderMaterial) => !!entry.matId || !!entry.matName)
      : []
  );

  return {
    itemId,
    itemName: itemName || itemId,
    itemImageUrl: String(raw?.itemImageUrl || '').trim(),
    unitDirtyWashRequirementCents,
    unitCleanCashCents,
    unitDirtyCashCents,
    quantity,
    totalDirtyWashRequirementCents: Math.max(
      0,
      Math.floor(Number(raw?.totalDirtyWashRequirementCents ?? unitDirtyWashRequirementCents * quantity))
    ),
    totalCleanCashCents: Math.max(0, Math.floor(Number(raw?.totalCleanCashCents ?? unitCleanCashCents * quantity))),
    totalDirtyCashCents: Math.max(0, Math.floor(Number(raw?.totalDirtyCashCents ?? unitDirtyCashCents * quantity))),
    materials,
  };
}

function summarizeOrder(lines: OrderLine[]) {
  const safeLines = lines.filter(Boolean);
  const primary = safeLines[0] || null;
  return {
    itemId: primary?.itemId || '',
    itemName:
      safeLines.length <= 1
        ? primary?.itemName || ''
        : `${primary?.itemName || 'Order'} +${safeLines.length - 1} more`,
    itemImageUrl: primary?.itemImageUrl || '',
    unitDirtyWashRequirementCents: primary?.unitDirtyWashRequirementCents || 0,
    unitCleanCashCents: primary?.unitCleanCashCents || 0,
    unitDirtyCashCents: primary?.unitDirtyCashCents || 0,
    quantity: safeLines.reduce((sum, line) => sum + Math.max(1, Math.floor(Number(line.quantity || 1))), 0),
    materials: aggregateMaterials(safeLines.flatMap((line) => line.materials || [])),
    totalDirtyWashRequirementCents: safeLines.reduce((sum, line) => sum + Math.max(0, Number(line.totalDirtyWashRequirementCents || 0)), 0),
    totalCleanCashCents: safeLines.reduce((sum, line) => sum + Math.max(0, Number(line.totalCleanCashCents || 0)), 0),
    totalDirtyCashCents: safeLines.reduce((sum, line) => sum + Math.max(0, Number(line.totalDirtyCashCents || 0)), 0),
  };
}

function normalizeOrderStatus(raw: any): OrderRecord['status'] {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'pending') return 'pending';
  if (value === 'completed') return 'completed';
  if (value === 'cancelled') return 'cancelled';
  return 'placed';
}

function readOrders(): OrdersFile {
  ensureFiles();
  const matNames = buildMatNameMap();
  const parsed = readJsonFileCached<any>(ORDERS_PATH, () => DEFAULT_ORDERS);
  const orders = Array.isArray(parsed?.orders) ? parsed.orders : [];
  return {
    schemaVersion: 2,
    orders: orders
      .map((order: any) => {
        const rawLines = Array.isArray(order?.lines) ? order.lines : [];
        const lines =
          rawLines.length > 0
            ? rawLines.map((line: any) => normalizeLine(line, matNames)).filter(Boolean) as OrderLine[]
            : [
                normalizeLine(
                  {
                    itemId: order?.itemId,
                    itemName: order?.itemName,
                    itemImageUrl: order?.itemImageUrl,
                    unitDirtyWashRequirementCents: order?.unitDirtyWashRequirementCents ?? order?.unitPriceCents,
                    unitCleanCashCents: order?.unitCleanCashCents,
                    unitDirtyCashCents: order?.unitDirtyCashCents,
                    quantity: order?.quantity,
                    totalDirtyWashRequirementCents: order?.totalDirtyWashRequirementCents ?? order?.totalPriceCents,
                    totalCleanCashCents: order?.totalCleanCashCents,
                    totalDirtyCashCents: order?.totalDirtyCashCents,
                    materials: Array.isArray(order?.materials)
                      ? order.materials.map((entry: any) => ({
                          ...entry,
                          quantity: Math.max(1, Math.floor(Number(entry?.quantity || 1))) * Math.max(1, Math.floor(Number(order?.quantity || 1))),
                        }))
                      : [],
                  },
                  matNames
                ),
              ].filter(Boolean) as OrderLine[];

        if (!lines.length) return null;
        const summary = summarizeOrder(lines);
        return {
          id: String(order?.id || '').trim(),
          crewId: String(order?.crewId || '').trim(),
          itemId: String(order?.itemId || '').trim() || summary.itemId,
          itemName: String(order?.itemName || '').trim() || summary.itemName,
          itemImageUrl: String(order?.itemImageUrl || '').trim() || summary.itemImageUrl,
          unitDirtyWashRequirementCents: Math.max(
            0,
            Math.floor(Number((order?.unitDirtyWashRequirementCents ?? order?.unitPriceCents) || summary.unitDirtyWashRequirementCents))
          ),
          unitCleanCashCents: Math.max(0, Math.floor(Number(order?.unitCleanCashCents || summary.unitCleanCashCents))),
          unitDirtyCashCents: Math.max(0, Math.floor(Number(order?.unitDirtyCashCents || summary.unitDirtyCashCents))),
          materials: aggregateMaterials(
            Array.isArray(order?.materials)
              ? order.materials
                  .map((entry: any) => ({
                    matId: String(entry?.matId || '').trim(),
                    matName: String(entry?.matName || '').trim() || matNames.get(String(entry?.matId || '').trim()) || String(entry?.matId || '').trim(),
                    quantity: Math.max(1, Math.floor(Number(entry?.quantity || 1))),
                  }))
                  .filter((entry: OrderMaterial) => !!entry.matId || !!entry.matName)
              : summary.materials
          ),
          quantity: Math.max(1, Math.floor(Number(order?.quantity || summary.quantity || 1))),
          totalDirtyWashRequirementCents: Math.max(
            0,
            Math.floor(Number((order?.totalDirtyWashRequirementCents ?? order?.totalPriceCents) || summary.totalDirtyWashRequirementCents))
          ),
          totalCleanCashCents: Math.max(0, Math.floor(Number(order?.totalCleanCashCents || summary.totalCleanCashCents))),
          totalDirtyCashCents: Math.max(0, Math.floor(Number(order?.totalDirtyCashCents || summary.totalDirtyCashCents))),
          lines,
          note: String(order?.note || '').trim(),
          status: normalizeOrderStatus(order?.status),
          cancelReason: String(order?.cancelReason || '').trim(),
          cancelledAt: String(order?.cancelledAt || ''),
          cancelledBy: String(order?.cancelledBy || '').trim(),
          createdAt: String(order?.createdAt || ''),
          createdBy: String(order?.createdBy || '').trim(),
          embedMessageId: String(order?.embedMessageId || '').trim(),
          embedChannelId: String(order?.embedChannelId || '').trim(),
        };
      })
      .filter((order: OrderRecord | null): order is OrderRecord => !!order && !!order.id && !!order.crewId),
  };
}

function readMainWashDirtyTotalCents(settings: any) {
  const parsed = readJsonFileCached<any>(WASH_PATH, () => ({weeks: {}}));
  const weeks = parsed?.weeks && typeof parsed.weeks === 'object' ? parsed.weeks : {};
  let dirtyCents = 0;
  for (const [weekEnding, wk] of Object.entries<any>(weeks)) {
    if (!includeMainCrewWeekForDirtyReset(weekEnding, settings)) continue;
    const entries = Array.isArray(wk?.entries) ? wk.entries : [];
    for (const entry of entries) {
      dirtyCents += Math.max(0, Math.floor(Number(entry?.dirtyCents || 0)));
    }
  }
  return dirtyCents;
}

function readSubCrewWashDirtyTotalCents(crewId: string) {
  const parsed = readJsonFileCached<any>(SUBCREW_WASH_PATH, () => ({crews: {}}));
  const transactions = Array.isArray(parsed?.crews?.[crewId]?.transactions) ? parsed.crews[crewId].transactions : [];
  return transactions.reduce((sum: number, entry: any) => sum + Math.max(0, Math.floor(Number(entry?.dirtyCents || 0))), 0);
}

function readOrderUsedDirtyTotalCents(orders: OrderRecord[], crewId: string) {
  return orders.reduce((sum, order) => {
    if (order.crewId !== crewId) return sum;
    if (order.status === 'cancelled') return sum;
    return sum + Math.max(0, Math.floor(Number(order.totalDirtyWashRequirementCents || 0)));
  }, 0);
}

function readMainOrderUsedDirtyTotalCents(orders: OrderRecord[], settings: any) {
  return orders.reduce((sum, order) => {
    if (order.crewId !== 'main') return sum;
    if (order.status === 'cancelled') return sum;
    if (!includeMainCrewOrderForDirtyReset(order, settings)) return sum;
    return sum + Math.max(0, Math.floor(Number(order.totalDirtyWashRequirementCents || 0)));
  }, 0);
}

function readAvailableDirtyForCrewCents(crewId: string, orders: OrderRecord[], settings: any) {
  const collectedDirtyCents =
    crewId === 'main' ? readMainWashDirtyTotalCents(settings) : readSubCrewWashDirtyTotalCents(crewId);
  const usedDirtyCents =
    crewId === 'main' ? readMainOrderUsedDirtyTotalCents(orders, settings) : readOrderUsedDirtyTotalCents(orders, crewId);
  return collectedDirtyCents - usedDirtyCents;
}

function writeOrders(next: OrdersFile) {
  ensureFiles();
  const tmp = `${ORDERS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, ORDERS_PATH);
  invalidateJsonFileCache(ORDERS_PATH);
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isAllowedViewer(settings: any, discordId: string) {
  return resolveViewerCrewContext({
    ownerDiscordId: String(settings?.ownerDiscordId || ''),
    coOwnerDiscordIds: Array.isArray(settings?.coOwnerDiscordIds) ? settings.coOwnerDiscordIds : [],
    discordId,
    outlineColor: String(settings?.outlineColor || '#ffffff14'),
    subCrews: settings?.subCrews || [],
    isMainGuildMember: isMainGuildMember(discordId),
  });
}

function formatWholeCents(cents: number) {
  return Math.round(Number(cents || 0) / 100).toLocaleString();
}

function formatMaterials(materials: OrderMaterial[]) {
  if (!Array.isArray(materials) || materials.length === 0) return 'None';
  return materials.map((entry) => `${entry.matName || entry.matId} x${entry.quantity}`).join(', ');
}

function truncateEmbedText(value: string, maxLength: number) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text || 'None';
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function outlineColorToDecimal(hex: string) {
  const clean = String(hex || '').trim().replace('#', '').slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0x22c55e;
  return parseInt(clean, 16);
}

function normalizeDiscordImageUrl(raw: any) {
  const value = String(raw || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function getOrderStatusLabel(status: OrderRecord['status']) {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Placed';
  }
}

function getOrderStatusColor(status: OrderRecord['status'], fallbackHex: string) {
  switch (status) {
    case 'pending':
      return 0xf59e0b;
    case 'completed':
      return 0x22c55e;
    case 'cancelled':
      return 0xef4444;
    default:
      return 0x3b82f6;
  }
}

function readOrderUpdateTemplate() {
  try {
    const parsed = readJsonFileCached<any>(EMBEDS_PATH, () => ({}));
    const raw = parsed?.subCrewTemplates?.subcrew_order_update || {};
    return {
      title: String(raw?.title || DEFAULT_ORDER_UPDATE_TEMPLATE.title).trim().slice(0, 200) || DEFAULT_ORDER_UPDATE_TEMPLATE.title,
      description:
        String(raw?.description || DEFAULT_ORDER_UPDATE_TEMPLATE.description).trim().slice(0, 1500) || DEFAULT_ORDER_UPDATE_TEMPLATE.description,
      color: String(raw?.color || DEFAULT_ORDER_UPDATE_TEMPLATE.color).trim() || DEFAULT_ORDER_UPDATE_TEMPLATE.color,
    };
  } catch {
    return DEFAULT_ORDER_UPDATE_TEMPLATE;
  }
}

function applyTemplate(template: string, values: Record<string, string>) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

function buildOrderUpdateEmbed(args: {
  guildName?: string;
  guildAvatar?: string;
  crewName: string;
  crewOutlineColor: string;
  order: OrderRecord;
}) {
  const template = readOrderUpdateTemplate();
  const guildAvatarUrl = normalizeDiscordImageUrl(args.guildAvatar);
  const itemImageUrl = normalizeDiscordImageUrl(args.order.itemImageUrl);
  const itemsList = args.order.lines.map((line) => `${line.itemName} x${line.quantity}`).join('\n') || args.order.itemName;
  const statusLabel = getOrderStatusLabel(args.order.status);
  const values = {
    crewName: args.crewName,
    itemName: itemsList,
    quantity: String(args.order.quantity || 0),
    dirtyWash: formatWholeCents(args.order.totalDirtyWashRequirementCents),
    cleanCost: formatWholeCents(args.order.totalCleanCashCents),
    dirtyCash: formatWholeCents(args.order.totalDirtyCashCents),
    materials: formatMaterials(args.order.materials || []),
    note: String(args.order.note || '').trim() || 'None',
    items: itemsList,
    status: String(args.order.status || 'placed'),
    statusLabel,
    cancelReason: String(args.order.cancelReason || '').trim() || 'None',
  };

  return {
    author: {
      name: `${args.guildName || 'Reblas Mafia'} • ${args.crewName}`,
      ...(guildAvatarUrl ? {icon_url: guildAvatarUrl} : {}),
    },
    title: applyTemplate(template.title, values),
    description: applyTemplate(template.description, values),
    color: getOrderStatusColor(args.order.status, template.color || args.crewOutlineColor),
    ...(itemImageUrl ? {thumbnail: {url: itemImageUrl}} : {}),
    fields: [
      {
        name: 'Status',
        value: statusLabel,
        inline: true,
      },
      {
        name: 'Quantity',
        value: String(args.order.quantity || 0),
        inline: true,
      },
      {
        name: 'Items',
        value: truncateEmbedText(itemsList, 1024),
        inline: false,
      },
      {
        name: 'Dirty Wash',
        value: formatWholeCents(args.order.totalDirtyWashRequirementCents),
        inline: true,
      },
      {
        name: 'Clean Cost',
        value: formatWholeCents(args.order.totalCleanCashCents),
        inline: true,
      },
      {
        name: 'Dirty Cash',
        value: formatWholeCents(args.order.totalDirtyCashCents),
        inline: true,
      },
      {
        name: 'Materials',
        value: truncateEmbedText(formatMaterials(args.order.materials || []), 1024),
        inline: false,
      },
      ...(values.note !== 'None'
        ? [
            {
              name: 'Note',
              value: truncateEmbedText(values.note, 1024),
              inline: false,
            },
          ]
        : []),
      ...(args.order.status === 'cancelled' && values.cancelReason !== 'None'
        ? [
            {
              name: 'Cancel Reason',
              value: truncateEmbedText(values.cancelReason, 1024),
              inline: false,
            },
          ]
        : []),
    ],
    timestamp: args.order.createdAt,
    footer: {
      text:
        args.order.status === 'cancelled' && values.cancelReason !== 'None'
          ? `${statusLabel} • Reason: ${truncateEmbedText(values.cancelReason, 120)}`
          : `${statusLabel} • Order ID: ${String(args.order.id || '').slice(-8)}`,
    },
  } as any;
}

async function postOrderUpdateEmbed(args: {
  botToken: string;
  channelId: string;
  mentionRoleIds?: string[];
  guildName?: string;
  guildAvatar?: string;
  crewName: string;
  crewOutlineColor: string;
  order: OrderRecord;
}): Promise<OrderEmbedSyncResult> {
  const token = String(args.botToken || '').trim();
  const channelId = String(args.channelId || '').trim();
  if (!token || !/^\d{6,25}$/.test(channelId)) {
    return {ok: false, error: 'Missing bot token or valid channel ID'};
  }

  const embed = buildOrderUpdateEmbed(args);
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
  const body = await res.json().catch(() => ({}));
  return {ok: true, messageId: String(body?.id || '').trim()};
}

async function updateOrderUpdateEmbed(args: {
  botToken: string;
  channelId: string;
  messageId: string;
  mentionRoleIds?: string[];
  guildName?: string;
  guildAvatar?: string;
  crewName: string;
  crewOutlineColor: string;
  order: OrderRecord;
}): Promise<OrderEmbedSyncResult> {
  const token = String(args.botToken || '').trim();
  const channelId = String(args.channelId || '').trim();
  const messageId = String(args.messageId || '').trim();
  if (!token || !/^\d{6,25}$/.test(channelId) || !/^\d{6,25}$/.test(messageId)) {
    return {ok: false, error: 'Missing bot token, channel ID, or message ID'};
  }

  const embed = buildOrderUpdateEmbed(args);
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
  return {ok: true, messageId};
}

function resolveOrderEmbedTarget(settings: any, crewId: string, crew: any) {
  if (crewId === 'main') {
    return {
      crewName: 'Reblas Mafia',
      crewOutlineColor: String(settings?.outlineColor || '#ffffff14'),
      channelId: String(settings?.mainCrewOrderUpdatesChannelId || '').trim(),
      mentionRoleIds: normalizeRoleIdList(settings?.mainCrewOrderUpdatesMentionRoleIds),
    };
  }
  return {
    crewName: String(crew?.name || '').trim() || 'Crew',
    crewOutlineColor: String(crew?.outlineColor || settings?.outlineColor || '#ffffff14'),
    channelId: String(crew?.orderUpdatesChannelId || '').trim(),
    mentionRoleIds: normalizeRoleIdList(crew?.orderUpdatesMentionRoleIds),
  };
}

function resolveOrderEmbedBlockingReason(args: {botToken: string; channelId: string; crewName: string}) {
  if (!String(args.botToken || '').trim()) {
    return 'Bot Token is missing in Main Settings.';
  }
  if (!/^\d{6,25}$/.test(String(args.channelId || '').trim())) {
    return `${args.crewName} Order Updates Channel ID is not configured.`;
  }
  return '';
}

async function syncOrderUpdateEmbed(args: {
  botToken: string;
  order: OrderRecord;
  channelId: string;
  mentionRoleIds?: string[];
  guildName?: string;
  guildAvatar?: string;
  crewName: string;
  crewOutlineColor: string;
}): Promise<OrderEmbedSyncResult> {
  if (args.order.embedMessageId && args.order.embedChannelId) {
    return updateOrderUpdateEmbed({
      botToken: args.botToken,
      channelId: args.order.embedChannelId,
      messageId: args.order.embedMessageId,
      mentionRoleIds: args.mentionRoleIds,
      guildName: args.guildName,
      guildAvatar: args.guildAvatar,
      crewName: args.crewName,
      crewOutlineColor: args.crewOutlineColor,
      order: args.order,
    });
  }

  return postOrderUpdateEmbed({
    botToken: args.botToken,
    channelId: args.channelId,
    mentionRoleIds: args.mentionRoleIds,
    guildName: args.guildName,
    guildAvatar: args.guildAvatar,
    crewName: args.crewName,
    crewOutlineColor: args.crewOutlineColor,
    order: args.order,
  });
}

function buildResponse(crewId: string, items: ItemRecord[], orders: OrderRecord[]) {
  const crewOrders = orders.filter((order) => order.crewId === crewId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    crewId,
    items,
    orders: crewOrders,
    totals: {
      orderCount: crewOrders.length,
      openCount: crewOrders.filter((order) => order.status === 'placed' || order.status === 'pending').length,
      totalDirtyWashRequirementCents: crewOrders.reduce((sum, order) => sum + order.totalDirtyWashRequirementCents, 0),
      totalCleanCashCents: crewOrders.reduce((sum, order) => sum + order.totalCleanCashCents, 0),
      totalDirtyCashCents: crewOrders.reduce((sum, order) => sum + order.totalDirtyCashCents, 0),
    },
  };
}

function buildAllResponse(items: ItemRecord[], orders: OrderRecord[]) {
  const allOrders = orders.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    crewId: 'all',
    items,
    orders: allOrders,
    totals: {
      orderCount: allOrders.length,
      openCount: allOrders.filter((order) => order.status === 'placed' || order.status === 'pending').length,
      totalDirtyWashRequirementCents: allOrders.reduce((sum, order) => sum + order.totalDirtyWashRequirementCents, 0),
      totalCleanCashCents: allOrders.reduce((sum, order) => sum + order.totalCleanCashCents, 0),
      totalDirtyCashCents: allOrders.reduce((sum, order) => sum + order.totalDirtyCashCents, 0),
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const settings = readSettings();
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  const actorDiscordId = String((session as any)?.discordId || (session as any)?.user?.id || '').trim();
  const preview = resolveOwnerPreviewContext(req, settings, actorDiscordId);
  const effectiveDiscordId = preview.effectiveDiscordId;
  const viewer = isAllowedViewer(settings, effectiveDiscordId);
  const permissions = resolveOrderPermissions(settings, effectiveDiscordId);
  const crewId = String(req.query.crewId || req.body?.crewId || '').trim();
  const wantsAllCrews = crewId === 'all';
  const crew = crewId === 'main' ? null : (settings.subCrews || []).find((item: any) => String(item?.id || '').trim() === crewId) || null;
  if (viewer.viewerRole === 'external') return res.status(403).json({error: 'Access denied'});

  if (wantsAllCrews) {
    if (viewer.viewerRole !== 'owner') return res.status(403).json({error: 'Access denied'});
    if (preview.active && req.method !== 'GET') {
      return res.status(403).json({error: 'Member view is read-only for order changes'});
    }
    const items = readItems();
    const ordersFile = readOrders();
    if (req.method === 'GET') {
      if (!permissions.canViewOrders) return res.status(403).json({error: 'You do not have permission to view orders.'});
      console.log(
        '[crews/orders] owner all-orders GET',
        JSON.stringify({
          actorDiscordId,
          orderCount: ordersFile.orders.length,
          orders: ordersFile.orders.map((order) => ({
            id: order.id,
            crewId: order.crewId,
            itemName: order.itemName,
            status: order.status,
            createdAt: order.createdAt,
          })),
        })
      );
      return res.status(200).json(buildAllResponse(items, ordersFile.orders));
    }
    return res.status(400).json({error: 'All-crews order writes are not supported'});
  }

  if (viewer.viewerRole === 'subcrew' && crewId !== viewer.viewerSubCrewId) {
    return res.status(403).json({error: 'Access denied'});
  }
  const validCrew = crewId === 'main' || !!crew;
  if (viewer.viewerRole === 'subcrew' && crewId === 'main') return res.status(403).json({error: 'Access denied'});
  if (!validCrew) return res.status(404).json({error: 'Crew not found'});
  if (preview.active && req.method !== 'GET') {
    return res.status(403).json({error: 'Member view is read-only for order changes'});
  }

  const items = readItems();
  const ordersFile = readOrders();

  if (req.method === 'GET') {
    if (!permissions.canViewOrders) return res.status(403).json({error: 'You do not have permission to view orders.'});
    return res.status(200).json(buildResponse(crewId, items, ordersFile.orders));
  }

  if (req.method === 'POST') {
    const action = String(req.body?.action || '').trim();
    let embedSent = false;
    let embedError = '';

    if (action === 'create') {
      if (!permissions.canPlaceOrders) {
        return res.status(403).json({error: 'You do not have permission to place orders.'});
      }
      const requestedItems = Array.isArray(req.body?.items)
        ? req.body.items
        : req.body?.itemId
          ? [{itemId: req.body.itemId, quantity: req.body?.quantity}]
          : [];
      const normalizedRequests = requestedItems
        .map((entry: any) => ({
          itemId: String(entry?.itemId || '').trim(),
          quantity: Math.max(1, Math.floor(Number(entry?.quantity || 1))),
        }))
        .filter((entry: {itemId: string; quantity: number}) => !!entry.itemId);

      if (!normalizedRequests.length) {
        return res.status(400).json({error: 'Add at least one item to the cart before placing the order.'});
      }

      const mergedRequests = new Map<string, number>();
      for (const entry of normalizedRequests) {
        mergedRequests.set(entry.itemId, (mergedRequests.get(entry.itemId) || 0) + entry.quantity);
      }

      const matNames = buildMatNameMap();
      const lines: OrderLine[] = [];
      for (const [itemId, quantity] of mergedRequests.entries()) {
        const item = items.find((entry) => entry.id === itemId && entry.active);
        if (!item) return res.status(400).json({error: 'All cart items must still be active.'});
        lines.push(buildLineFromItem(item, quantity, matNames));
      }

      const summary = summarizeOrder(lines);
      const note = String(req.body?.note || '').trim().slice(0, 240);
      const createdBy = actorDiscordId;
      if (summary.totalDirtyWashRequirementCents > 0) {
        const availableDirtyCents = readAvailableDirtyForCrewCents(crewId, ordersFile.orders, settings);
        if (summary.totalDirtyWashRequirementCents > availableDirtyCents) {
          return res.status(400).json({
            error: "You currently don't have enough dirty wash to place this order.",
          });
        }
      }

      const order: OrderRecord = {
        id: makeId(),
        crewId,
        itemId: summary.itemId,
        itemName: summary.itemName,
        itemImageUrl: summary.itemImageUrl,
        unitDirtyWashRequirementCents: summary.unitDirtyWashRequirementCents,
        unitCleanCashCents: summary.unitCleanCashCents,
        unitDirtyCashCents: summary.unitDirtyCashCents,
        materials: summary.materials,
        quantity: summary.quantity,
        totalDirtyWashRequirementCents: summary.totalDirtyWashRequirementCents,
        totalCleanCashCents: summary.totalCleanCashCents,
        totalDirtyCashCents: summary.totalDirtyCashCents,
        lines,
        note,
        status: 'placed',
        cancelReason: '',
        cancelledAt: '',
        cancelledBy: '',
        createdAt: new Date().toISOString(),
        createdBy,
        embedMessageId: '',
        embedChannelId: '',
      };
      ordersFile.orders.unshift(order);
      writeOrders(ordersFile);

      const embedTarget = resolveOrderEmbedTarget(settings, crewId, crew);
      const embedBlockedReason = resolveOrderEmbedBlockingReason({
        botToken: settings.botToken,
        channelId: embedTarget.channelId,
        crewName: embedTarget.crewName,
      });
      if (embedBlockedReason) {
        embedError = embedBlockedReason;
      } else {
        const embedResult: OrderEmbedSyncResult = await syncOrderUpdateEmbed({
          botToken: settings.botToken,
          channelId: embedTarget.channelId,
          mentionRoleIds: embedTarget.mentionRoleIds,
          guildName: String(settings.guildName || 'Reblas Mafia'),
          guildAvatar: String(settings.guildAvatar || '').trim(),
          crewName: embedTarget.crewName,
          crewOutlineColor: embedTarget.crewOutlineColor,
          order,
        }).catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown order embed error',
        }));
        if (embedResult?.ok && embedResult.messageId) {
          embedSent = true;
          const orderIdx = ordersFile.orders.findIndex((entry) => entry.id === order.id && entry.crewId === crewId);
          if (orderIdx >= 0) {
            ordersFile.orders[orderIdx] = {
              ...ordersFile.orders[orderIdx],
              embedMessageId: embedResult.messageId,
              embedChannelId: embedTarget.channelId,
            };
            writeOrders(ordersFile);
          }
        }
        if (!embedResult?.ok) {
          embedError = String(embedResult?.error || 'Unknown error');
          console.error('[crews/orders] Failed to send order update embed', {
            crewId,
            channelId: embedTarget.channelId,
            error: embedResult?.error || 'Unknown error',
          });
        }
      }
    } else if (action === 'set_status') {
      if (!permissions.canManageOrders) {
        return res.status(403).json({error: 'You do not have permission to manage orders.'});
      }
      const id = String(req.body?.id || '').trim();
      const nextStatus = normalizeOrderStatus(req.body?.status);
      if (nextStatus !== 'pending' && nextStatus !== 'completed') {
        return res.status(400).json({error: 'Unsupported order status'});
      }
      const idx = ordersFile.orders.findIndex((order) => order.id === id && order.crewId === crewId);
      if (idx < 0) return res.status(404).json({error: 'Order not found'});
      ordersFile.orders[idx] = {
        ...ordersFile.orders[idx],
        status: nextStatus,
        cancelReason: '',
        cancelledAt: '',
        cancelledBy: '',
      };
      writeOrders(ordersFile);
      const updatedOrder = ordersFile.orders[idx];
      const embedTarget = resolveOrderEmbedTarget(settings, crewId, crew);
      const embedBlockedReason = resolveOrderEmbedBlockingReason({
        botToken: settings.botToken,
        channelId: embedTarget.channelId,
        crewName: embedTarget.crewName,
      });
      if (embedBlockedReason) {
        embedError = embedBlockedReason;
      } else {
        const embedResult: OrderEmbedSyncResult = await syncOrderUpdateEmbed({
          botToken: settings.botToken,
          channelId: embedTarget.channelId,
          mentionRoleIds: embedTarget.mentionRoleIds,
          guildName: String(settings.guildName || 'Reblas Mafia'),
          guildAvatar: String(settings.guildAvatar || '').trim(),
          crewName: embedTarget.crewName,
          crewOutlineColor: embedTarget.crewOutlineColor,
          order: updatedOrder,
        }).catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown order embed update error',
        }));
        if (embedResult?.ok && embedResult.messageId && (!updatedOrder.embedMessageId || !updatedOrder.embedChannelId)) {
          embedSent = true;
          ordersFile.orders[idx] = {
            ...ordersFile.orders[idx],
            embedMessageId: embedResult.messageId,
            embedChannelId: embedTarget.channelId,
          };
          writeOrders(ordersFile);
        } else if (embedResult?.ok) {
          embedSent = true;
        }
        if (!embedResult?.ok) {
          embedError = String(embedResult?.error || 'Unknown error');
          console.error('[crews/orders] Failed to update order embed status', {
            crewId,
            orderId: updatedOrder.id,
            channelId: updatedOrder.embedChannelId || embedTarget.channelId,
            messageId: updatedOrder.embedMessageId || '',
            error: embedResult?.error || 'Unknown error',
          });
        }
      }
    } else if (action === 'cancel') {
      if (!permissions.canCancelOrders) {
        return res.status(403).json({error: 'You do not have permission to cancel orders.'});
      }
      const id = String(req.body?.id || '').trim();
      const cancelReason = String(req.body?.cancelReason || '').trim().slice(0, 240);
      if (!cancelReason) {
        return res.status(400).json({error: 'Please provide a cancel reason.'});
      }
      const idx = ordersFile.orders.findIndex((order) => order.id === id && order.crewId === crewId);
      if (idx < 0) return res.status(404).json({error: 'Order not found'});
      ordersFile.orders[idx] = {
        ...ordersFile.orders[idx],
        status: 'cancelled',
        cancelReason,
        cancelledAt: new Date().toISOString(),
        cancelledBy: actorDiscordId,
      };
      writeOrders(ordersFile);
      const updatedOrder = ordersFile.orders[idx];
      const embedTarget = resolveOrderEmbedTarget(settings, crewId, crew);
      const embedBlockedReason = resolveOrderEmbedBlockingReason({
        botToken: settings.botToken,
        channelId: embedTarget.channelId,
        crewName: embedTarget.crewName,
      });
      if (embedBlockedReason) {
        embedError = embedBlockedReason;
      } else {
        const embedResult: OrderEmbedSyncResult = await syncOrderUpdateEmbed({
          botToken: settings.botToken,
          channelId: embedTarget.channelId,
          mentionRoleIds: embedTarget.mentionRoleIds,
          guildName: String(settings.guildName || 'Reblas Mafia'),
          guildAvatar: String(settings.guildAvatar || '').trim(),
          crewName: embedTarget.crewName,
          crewOutlineColor: embedTarget.crewOutlineColor,
          order: updatedOrder,
        }).catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown order embed cancel error',
        }));
        if (embedResult?.ok && embedResult.messageId && (!updatedOrder.embedMessageId || !updatedOrder.embedChannelId)) {
          embedSent = true;
          ordersFile.orders[idx] = {
            ...ordersFile.orders[idx],
            embedMessageId: embedResult.messageId,
            embedChannelId: embedTarget.channelId,
          };
          writeOrders(ordersFile);
        } else if (embedResult?.ok) {
          embedSent = true;
        }
        if (!embedResult?.ok) {
          embedError = String(embedResult?.error || 'Unknown error');
          console.error('[crews/orders] Failed to update cancelled order embed', {
            crewId,
            orderId: updatedOrder.id,
            channelId: updatedOrder.embedChannelId || embedTarget.channelId,
            messageId: updatedOrder.embedMessageId || '',
            error: embedResult?.error || 'Unknown error',
          });
        }
      }
    } else if (action === 'delete') {
      if (!permissions.canCancelOrders) {
        return res.status(403).json({error: 'You do not have permission to delete orders.'});
      }
      const id = String(req.body?.id || '').trim();
      ordersFile.orders = ordersFile.orders.filter((order) => !(order.id === id && order.crewId === crewId));
      writeOrders(ordersFile);
    } else {
      return res.status(400).json({error: 'Unsupported action'});
    }

    return res.status(200).json({
      ...buildResponse(crewId, items, readOrders().orders),
      embedSent,
      embedError,
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({error: 'Method not allowed'});
}
