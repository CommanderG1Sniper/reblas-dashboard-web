#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = String(process.env.REBLAS_DATA_DIR || path.join(os.homedir(), '.reblas-dashboard-data')).trim();
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const ORDERS_PATH = path.join(DATA_DIR, 'crewOrders.json');
const SUBCREW_WASH_PATH = path.join(DATA_DIR, 'subcrewWash.json');
const EMBEDS_PATH = path.join(DATA_DIR, 'embeds.json');
const WEEKLY_STATE_PATH = path.join(DATA_DIR, 'weeklyReminderState.json');
const API_BASE = 'https://discord.com/api/v10';

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeChannelId(raw) {
  const value = String(raw || '').trim();
  return /^\d{6,25}$/.test(value) ? value : '';
}

function normalizeDiscordImageUrl(raw) {
  const value = String(raw || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function getSettings() {
  return readJson(SETTINGS_PATH, {});
}

function getBotToken(settings) {
  return String(
    settings?.botToken ||
      process.env.DISCORD_BOT_TOKEN ||
      process.env.BOT_TOKEN ||
      process.env.REBLAS_BOT_TOKEN ||
      process.env.DISCORD_TOKEN ||
      ''
  ).trim();
}

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

function formatWholeCents(cents) {
  return Math.round(Number(cents || 0) / 100).toLocaleString();
}

function truncateEmbedText(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text || 'None';
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function applyTemplate(template, values) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

function outlineColorToDecimal(hex) {
  const clean = String(hex || '').trim().replace('#', '').slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0x3b82f6;
  return parseInt(clean, 16);
}

function formatMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) return 'None';
  return materials.map((entry) => `${entry.matName || entry.matId} x${entry.quantity}`).join(', ');
}

function getEmbedsStore() {
  return readJson(EMBEDS_PATH, {subCrewTemplates: {}, announcements: []});
}

function getOrderTemplate() {
  const raw = getEmbedsStore()?.subCrewTemplates?.subcrew_order_update || {};
  return {
    title: String(raw?.title || '{crewName} Order {statusLabel}').trim().slice(0, 200) || '{crewName} Order {statusLabel}',
    description:
      String(
        raw?.description ||
          'Status: {statusLabel}\nItems:\n{items}\n\nQuantity: {quantity}\nDirty Wash: {dirtyWash}\nClean Cost: {cleanCost}\nDirty Cash: {dirtyCash}\nMaterials: {materials}\nNote: {note}\nCancel Reason: {cancelReason}'
      )
        .trim()
        .slice(0, 1500) ||
      'Status: {statusLabel}',
    color: String(raw?.color || '#22c55e').trim() || '#22c55e',
  };
}

function getWashTemplate() {
  const raw = getEmbedsStore()?.subCrewTemplates?.subcrew_wash_log || {};
  return {
    title: String(raw?.title || '{crewName} Wash Log').trim().slice(0, 200) || '{crewName} Wash Log',
    description:
      String(
        raw?.description ||
          'Date: {date}\nDirty Collected: {dirtyCollected}\nWash Rate: {washRate}\nClean Returned: {cleanReturned}\nCurrent Dirty Collected Total: {dirtyCollectedTotal}'
      )
        .trim()
        .slice(0, 1500) ||
      'Wash Log',
    color: String(raw?.color || '#3b82f6').trim() || '#3b82f6',
  };
}

function getOrderStatusLabel(status) {
  switch (String(status || '').trim()) {
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

function getOrderStatusColor(status) {
  switch (String(status || '').trim()) {
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

function getWashStatusLabel(status) {
  switch (String(status || '').trim()) {
    case 'paid':
      return 'Paid';
    case 'pending':
      return 'Pending';
    default:
      return 'Collected';
  }
}

function getWashStatusColor(status, fallbackHex) {
  switch (String(status || '').trim()) {
    case 'paid':
      return 0x22c55e;
    case 'pending':
      return 0xf59e0b;
    default:
      return outlineColorToDecimal(fallbackHex || '#3b82f6');
  }
}

function buildAuthor(settings, crewName) {
  const guildName = String(settings?.guildName || 'Reblas Mafia');
  const guildAvatar = normalizeDiscordImageUrl(settings?.guildAvatar);
  return {
    name: `${guildName} • ${crewName}`,
    ...(guildAvatar ? {icon_url: guildAvatar} : {}),
  };
}

function buildOrderEmbed(settings, crewName, crewOutlineColor, order) {
  const template = getOrderTemplate();
  const itemImageUrl = normalizeDiscordImageUrl(order?.itemImageUrl);
  const lines = Array.isArray(order?.lines) && order.lines.length > 0 ? order.lines : [];
  const itemsList = lines.map((line) => `${line.itemName} x${line.quantity}`).join('\n') || String(order?.itemName || '');
  const statusLabel = getOrderStatusLabel(order?.status);
  const values = {
    crewName,
    itemName: itemsList,
    quantity: String(order?.quantity || 0),
    dirtyWash: formatWholeCents(order?.totalDirtyWashRequirementCents),
    cleanCost: formatWholeCents(order?.totalCleanCashCents),
    dirtyCash: formatWholeCents(order?.totalDirtyCashCents),
    materials: formatMaterials(order?.materials || []),
    note: String(order?.note || '').trim() || 'None',
    items: itemsList,
    status: String(order?.status || 'placed'),
    statusLabel,
    cancelReason: String(order?.cancelReason || '').trim() || 'None',
  };

  return {
    author: buildAuthor(settings, crewName),
    title: applyTemplate(template.title, values),
    description: applyTemplate(template.description, values),
    color: getOrderStatusColor(order?.status, template.color || crewOutlineColor),
    ...(itemImageUrl ? {thumbnail: {url: itemImageUrl}} : {}),
    fields: [
      {name: 'Status', value: statusLabel, inline: true},
      {name: 'Quantity', value: String(order?.quantity || 0), inline: true},
      {name: 'Items', value: truncateEmbedText(itemsList, 1024), inline: false},
      {name: 'Dirty Wash', value: formatWholeCents(order?.totalDirtyWashRequirementCents), inline: true},
      {name: 'Clean Cost', value: formatWholeCents(order?.totalCleanCashCents), inline: true},
      {name: 'Dirty Cash', value: formatWholeCents(order?.totalDirtyCashCents), inline: true},
      {name: 'Materials', value: truncateEmbedText(formatMaterials(order?.materials || []), 1024), inline: false},
      ...(values.note !== 'None' ? [{name: 'Note', value: truncateEmbedText(values.note, 1024), inline: false}] : []),
      ...(String(order?.status || '') === 'cancelled' && values.cancelReason !== 'None'
        ? [{name: 'Cancel Reason', value: truncateEmbedText(values.cancelReason, 1024), inline: false}]
        : []),
    ],
    timestamp: String(order?.createdAt || ''),
    footer: {
      text:
        String(order?.status || '') === 'cancelled' && values.cancelReason !== 'None'
          ? `${statusLabel} • Reason: ${truncateEmbedText(values.cancelReason, 120)}`
          : `${statusLabel} • Order ID: ${String(order?.id || '').slice(-8)}`,
    },
  };
}

function buildWashEmbed(settings, crewName, crewOutlineColor, entry, dirtyWashTotalCents) {
  const template = getWashTemplate();
  const statusLabel = getWashStatusLabel(entry?.status);
  const values = {
    crewName,
    date: String(entry?.date || ''),
    dirtyCollected: formatWholeCents(entry?.dirtyCents),
    washRate: `${entry?.washRatePct || 0}%`,
    cleanReturned: formatWholeCents(entry?.cleanCents),
    dirtyCollectedTotal: formatWholeCents(dirtyWashTotalCents),
    notes: String(entry?.description || '').trim() || 'None',
  };
  return {
    author: buildAuthor(settings, crewName),
    title: applyTemplate(template.title, values),
    description: applyTemplate(template.description, values),
    color: getWashStatusColor(entry?.status, template.color || crewOutlineColor),
    fields: [
      {name: 'Status', value: statusLabel, inline: true},
      {name: 'Date', value: String(entry?.date || ''), inline: true},
      {name: 'Wash Rate', value: `${entry?.washRatePct || 0}%`, inline: true},
      {name: 'Dirty Collected', value: formatWholeCents(entry?.dirtyCents), inline: true},
      {name: 'Clean Returned', value: formatWholeCents(entry?.cleanCents), inline: true},
      {name: 'Current Dirty Total', value: formatWholeCents(dirtyWashTotalCents), inline: true},
      ...(values.notes !== 'None' ? [{name: 'Notes', value: truncateEmbedText(values.notes, 1024), inline: false}] : []),
    ],
    timestamp: String(entry?.createdAt || ''),
    footer: {
      text: `${statusLabel} • Wash Entry: ${String(entry?.id || '').slice(-8)}`,
    },
  };
}

function restyleExistingEmbed(settings, embed) {
  if (!embed || typeof embed !== 'object') return embed;
  const guildName = String(settings?.guildName || 'Reblas Mafia');
  const guildAvatar = normalizeDiscordImageUrl(settings?.guildAvatar);
  return {
    ...embed,
    author: embed.author && embed.author.name
      ? embed.author
      : {
          name: guildName,
          ...(guildAvatar ? {icon_url: guildAvatar} : {}),
        },
    ...(embed.thumbnail || !guildAvatar ? {} : {thumbnail: {url: guildAvatar}}),
    footer: embed.footer && embed.footer.text
      ? embed.footer
      : {
          text: 'Reblas Dashboard',
        },
  };
}

async function discordFetch(token, pathname, init = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord API ${res.status}${text ? `: ${text}` : ''}`);
  }
  return res;
}

async function getBotUserId(token) {
  const res = await discordFetch(token, '/users/@me', {method: 'GET'});
  const body = await res.json();
  return String(body?.id || '').trim();
}

async function getMessage(token, channelId, messageId) {
  const res = await discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {method: 'GET'});
  return res.json();
}

async function patchMessageWithButton(token, channelId, messageId, embeds, existingComponents) {
  const nextComponents =
    Array.isArray(existingComponents) && existingComponents.length > 0 ? existingComponents : buildDashboardLinkComponents();
  const res = await discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      embeds: Array.isArray(embeds) ? embeds : [],
      components: nextComponents,
    }),
  });
  return res.json().catch(() => ({}));
}

async function listRecentChannelMessages(token, channelId, limit = 100) {
  const res = await discordFetch(token, `/channels/${channelId}/messages?limit=${limit}`, {method: 'GET'});
  return res.json();
}

function collectTrackedTargets(settings) {
  const orders = readJson(ORDERS_PATH, {orders: []}).orders || [];
  const wash = readJson(SUBCREW_WASH_PATH, {crews: {}}).crews || {};
  const targets = [];
  const crewById = new Map((settings?.subCrews || []).map((crew) => [String(crew.id || '').trim(), crew]));

  for (const order of orders) {
    const channelId = normalizeChannelId(order?.embedChannelId);
    const messageId = normalizeChannelId(order?.embedMessageId);
    if (channelId && messageId) {
      const crew =
        String(order?.crewId || '') === 'main'
          ? {name: 'Reblas Mafia', outlineColor: String(settings?.outlineColor || '#3b82f6')}
          : crewById.get(String(order?.crewId || '').trim()) || {name: 'Crew', outlineColor: String(settings?.outlineColor || '#3b82f6')};
      targets.push({
        kind: 'order',
        channelId,
        messageId,
        embed: buildOrderEmbed(settings, String(crew.name || 'Crew'), String(crew.outlineColor || settings?.outlineColor || '#3b82f6'), order),
      });
    }
  }

  for (const [crewId, bucket] of Object.entries(wash)) {
    const crew = crewById.get(String(crewId || '').trim()) || {name: 'Crew', outlineColor: String(settings?.outlineColor || '#3b82f6')};
    const transactions = Array.isArray(bucket?.transactions) ? bucket.transactions : [];
    const dirtyWashTotalCents = transactions.reduce((sum, entry) => sum + Math.max(0, Number(entry?.dirtyCents || 0)), 0);
    const orderUsedCents = orders
      .filter((order) => String(order?.crewId || '').trim() === String(crewId || '').trim() && String(order?.status || '') !== 'cancelled')
      .reduce((sum, order) => sum + Math.max(0, Number(order?.totalDirtyWashRequirementCents || 0)), 0);
    const availableDirtyCents = dirtyWashTotalCents - orderUsedCents;
    for (const entry of transactions) {
      const channelId = normalizeChannelId(entry?.embedChannelId);
      const messageId = normalizeChannelId(entry?.embedMessageId);
      if (channelId && messageId) {
        targets.push({
          kind: 'wash',
          channelId,
          messageId,
          embed: buildWashEmbed(
            settings,
            String(crew.name || 'Crew'),
            String(crew.outlineColor || settings?.outlineColor || '#3b82f6'),
            entry,
            availableDirtyCents
          ),
        });
      }
    }
  }

  return targets;
}

function collectKnownChannels(settings) {
  const channels = new Set();
  const add = (value) => {
    const id = normalizeChannelId(value);
    if (id) channels.add(id);
  };

  add(settings?.mainCrewWashLogChannelId);
  add(settings?.mainCrewOrderUpdatesChannelId);
  for (const crew of settings?.subCrews || []) {
    add(crew?.washLogChannelId);
    add(crew?.orderUpdatesChannelId);
  }

  const embeds = readJson(EMBEDS_PATH, {announcements: []});
  for (const entry of embeds?.announcements || []) add(entry?.channelId);

  const weeklyState = readJson(WEEKLY_STATE_PATH, {});
  add(weeklyState?.testChannelId);

  return Array.from(channels);
}

async function main() {
  const settings = getSettings();
  const token = getBotToken(settings);
  if (!token) {
    throw new Error('Bot token missing in protected runtime settings.');
  }

  const botUserId = await getBotUserId(token);
  const patched = [];
  const skipped = [];
  const failed = [];
  const seen = new Set();

  for (const target of collectTrackedTargets(settings)) {
    const key = `${target.channelId}:${target.messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const message = await getMessage(token, target.channelId, target.messageId);
      await patchMessageWithButton(
        token,
        target.channelId,
        target.messageId,
        [target.embed],
        Array.isArray(message?.components) ? message.components : []
      );
      patched.push(target);
    } catch (error) {
      failed.push({error: error instanceof Error ? error.message : String(error), ...target});
    }
  }

  for (const channelId of collectKnownChannels(settings)) {
    try {
      const messages = await listRecentChannelMessages(token, channelId, 100);
      for (const message of Array.isArray(messages) ? messages : []) {
        const messageId = normalizeChannelId(message?.id);
        const authorId = String(message?.author?.id || '').trim();
        const key = `${channelId}:${messageId}`;
        if (!messageId || seen.has(key)) continue;
        seen.add(key);
        if (authorId !== botUserId) continue;
        if (!Array.isArray(message?.embeds) || message.embeds.length === 0) continue;
        try {
          const restyledEmbeds = message.embeds.map((embed) => restyleExistingEmbed(settings, embed));
          await patchMessageWithButton(token, channelId, messageId, restyledEmbeds, message.components || []);
          patched.push({kind: 'channel-scan', channelId, messageId});
        } catch (error) {
          failed.push({
            kind: 'channel-scan',
            channelId,
            messageId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      failed.push({
        kind: 'channel-scan',
        channelId,
        messageId: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dashboardUrl: getDashboardUrl(),
        patchedCount: patched.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        patched,
        skipped,
        failed,
        note: 'DM weekly reminder embeds cannot be backfilled unless their message IDs were stored, which they were not.',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
