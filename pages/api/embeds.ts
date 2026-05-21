import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from './auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../lib/server/json-cache';
import {hasOwnerAccess} from '../../lib/owner-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const EMBEDS_PATH = getRuntimeDataPath('embeds.json');

type Frequency = 'daily' | 'weekly';

type WeeklyTemplate = {
  id: 'weekly_outstanding' | 'weekly_uptodate' | 'weekly_credit';
  name: string;
  title: string;
  description: string;
  notice: string;
  statusLabel: string;
  statusEmoji: string;
};

type SubCrewEmbedTemplateId = 'subcrew_wash_log' | 'subcrew_order_update';

type SubCrewEmbedTemplate = {
  id: SubCrewEmbedTemplateId;
  name: string;
  title: string;
  description: string;
  color: string;
};

type AnnouncementEmbed = {
  id: string;
  name: string;
  title: string;
  description: string;
  channelId: string;
  mentionRoleIds: string[];
  frequency: Frequency;
  dayOfWeek: number;
  timeHHMM: string;
  color: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type EmbedsFile = {
  schemaVersion: number;
  weeklyTemplates: Record<WeeklyTemplate['id'], WeeklyTemplate>;
  weeklySummaryChannelId: string;
  weeklySummaryRoleId: string;
  subCrewTemplates: Record<SubCrewEmbedTemplateId, SubCrewEmbedTemplate>;
  announcements: AnnouncementEmbed[];
};

const DEFAULTS: EmbedsFile = {
  schemaVersion: 4,
  weeklyTemplates: {
    weekly_outstanding: {
      id: 'weekly_outstanding',
      name: 'Weekly Reminder - Outstanding',
      title: 'REMINDER',
      description: 'You currently have outstanding weeklys.',
      notice:
        'Weeklys are due on Friday/Saturday ready for Sunday handin, please ensure you have them ready to hand in.',
      statusLabel: 'Outstanding Balance Due',
      statusEmoji: '📕',
    },
    weekly_uptodate: {
      id: 'weekly_uptodate',
      name: 'Weekly Reminder - Up To Date',
      title: 'WELL DONE AND THANK YOU',
      description: 'You are up to date with your weeklys, this is highly appreciated.',
      notice:
        'Weeklys are due on Friday/Saturday ready for Sunday handin, please ensure you have them ready to hand in.',
      statusLabel: 'Up To Date',
      statusEmoji: '📘',
    },
    weekly_credit: {
      id: 'weekly_credit',
      name: 'Weekly Reminder - In Credit',
      title: 'OUTSTANDING EFFORT',
      description:
        'You are ahead of your weekly payments, your effort and proactiveness has not gone unnoticed.',
      notice:
        'Weeklys are due on Friday/Saturday ready for Sunday handin, please ensure you have them ready to hand in.',
      statusLabel: 'In Credit',
      statusEmoji: '📗',
    },
  },
  weeklySummaryChannelId: '',
  weeklySummaryRoleId: '',
  subCrewTemplates: {
    subcrew_wash_log: {
      id: 'subcrew_wash_log',
      name: 'Sub Crew Wash Log',
      title: '{crewName} Wash Log',
      description:
        'Date: {date}\nDirty Collected: {dirtyCollected}\nWash Rate: {washRate}\nClean Returned: {cleanReturned}\nCurrent Dirty Collected Total: {dirtyCollectedTotal}',
      color: '#3b82f6',
    },
    subcrew_order_update: {
      id: 'subcrew_order_update',
      name: 'Sub Crew Order Update',
      title: '{crewName} Order {statusLabel}',
      description:
        'Status: {statusLabel}\nItems:\n{items}\n\nQuantity: {quantity}\nDirty Wash: {dirtyWash}\nClean Cost: {cleanCost}\nDirty Cash: {dirtyCash}\nMaterials: {materials}\nNote: {note}\nCancel Reason: {cancelReason}',
      color: '#22c55e',
    },
  },
  announcements: [],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
}

function ensureEmbedsFile() {
  ensureDataDir();
  if (!fs.existsSync(EMBEDS_PATH)) {
    fs.writeFileSync(EMBEDS_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  }
}

function readSettings() {
  ensureDataDir();
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
}

function normalizeEmoji(v: any, fallback: string) {
  const s = String(v || '').trim();
  return s ? s.slice(0, 16) : fallback;
}

function normalizeText(v: any, fallback: string, maxLen: number) {
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  return s.slice(0, maxLen);
}

function normalizeChannelId(v: any) {
  const s = String(v || '').trim();
  return /^\d{6,25}$/.test(s) ? s : '';
}

function normalizeRoleIdList(raw: any) {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const id = String(value || '').trim();
    if (/^\d{6,25}$/.test(id)) out.push(id);
  }
  return Array.from(new Set(out));
}

function normalizeTime(v: any) {
  const s = String(v || '').trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(s) ? s : '17:00';
}

function normalizeFrequency(v: any): Frequency {
  return v === 'daily' ? 'daily' : 'weekly';
}

function normalizeColor(v: any) {
  const s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : '#3b82f6';
}

function normalizeWeeklyTemplate(raw: any, fallback: WeeklyTemplate): WeeklyTemplate {
  return {
    id: fallback.id,
    name: fallback.name,
    title: normalizeText(raw?.title, fallback.title, 120),
    description: normalizeText(raw?.description, fallback.description, 400),
    notice: normalizeText(raw?.notice, fallback.notice, 400),
    statusLabel: normalizeText(raw?.statusLabel, fallback.statusLabel, 80),
    statusEmoji: normalizeEmoji(raw?.statusEmoji, fallback.statusEmoji),
  };
}

function normalizeAnnouncement(raw: any, fallback?: AnnouncementEmbed): AnnouncementEmbed {
  const nowIso = new Date().toISOString();
  const prev = fallback || {
    id: '',
    name: 'Untitled Embed',
    title: 'Announcement',
    description: '',
    channelId: '',
    mentionRoleIds: [],
    frequency: 'weekly' as Frequency,
    dayOfWeek: 5,
    timeHHMM: '17:00',
    color: '#3b82f6',
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const dayRaw = Math.floor(Number(raw?.dayOfWeek));
  const dayOfWeek = Number.isFinite(dayRaw) ? Math.max(0, Math.min(6, dayRaw)) : prev.dayOfWeek;

  return {
    id: String(prev.id || raw?.id || '').trim(),
    name: normalizeText(raw?.name, prev.name, 120),
    title: normalizeText(raw?.title, prev.title, 120),
    description: normalizeText(raw?.description, prev.description, 400),
    channelId: normalizeChannelId(raw?.channelId ?? prev.channelId),
    mentionRoleIds: normalizeRoleIdList(raw?.mentionRoleIds ?? prev.mentionRoleIds),
    frequency: normalizeFrequency(raw?.frequency ?? prev.frequency),
    dayOfWeek,
    timeHHMM: normalizeTime(raw?.timeHHMM ?? prev.timeHHMM),
    color: normalizeColor(raw?.color ?? prev.color),
    enabled: raw?.enabled !== undefined ? !!raw.enabled : !!prev.enabled,
    createdAt: String(prev.createdAt || nowIso),
    updatedAt: nowIso,
  };
}

function normalizeSubCrewTemplate(raw: any, fallback: SubCrewEmbedTemplate): SubCrewEmbedTemplate {
  return {
    id: fallback.id,
    name: normalizeText(raw?.name, fallback.name, 120),
    title: normalizeText(raw?.title, fallback.title, 200),
    description: normalizeText(raw?.description, fallback.description, 1500),
    color: normalizeColor(raw?.color ?? fallback.color),
  };
}

function readEmbeds(): EmbedsFile {
  ensureEmbedsFile();
  const j = readJsonFileCached<any>(EMBEDS_PATH, () => DEFAULTS);
  const wt = j?.weeklyTemplates && typeof j.weeklyTemplates === 'object' ? j.weeklyTemplates : {};
  const st = j?.subCrewTemplates && typeof j.subCrewTemplates === 'object' ? j.subCrewTemplates : {};
  const announcementsRaw = Array.isArray(j?.announcements) ? j.announcements : [];
  const announcements = announcementsRaw
    .map((a: any) => normalizeAnnouncement(a))
    .filter((a: AnnouncementEmbed) => !!a.id);
  return {
    schemaVersion: 4,
    weeklyTemplates: {
      weekly_outstanding: normalizeWeeklyTemplate(wt.weekly_outstanding, DEFAULTS.weeklyTemplates.weekly_outstanding),
      weekly_uptodate: normalizeWeeklyTemplate(wt.weekly_uptodate, DEFAULTS.weeklyTemplates.weekly_uptodate),
      weekly_credit: normalizeWeeklyTemplate(wt.weekly_credit, DEFAULTS.weeklyTemplates.weekly_credit),
    },
    weeklySummaryChannelId: normalizeChannelId(j?.weeklySummaryChannelId),
    weeklySummaryRoleId: normalizeChannelId(j?.weeklySummaryRoleId),
    subCrewTemplates: {
      subcrew_wash_log: normalizeSubCrewTemplate(st.subcrew_wash_log, DEFAULTS.subCrewTemplates.subcrew_wash_log),
      subcrew_order_update: normalizeSubCrewTemplate(st.subcrew_order_update, DEFAULTS.subCrewTemplates.subcrew_order_update),
    },
    announcements,
  };
}

function writeEmbeds(next: EmbedsFile) {
  ensureEmbedsFile();
  const tmp = EMBEDS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, EMBEDS_PATH);
  invalidateJsonFileCache(EMBEDS_PATH);
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const settings = readSettings();
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});
  if (!isOwner(session as any, settings)) return res.status(403).json({error: 'Owner only'});

  if (req.method === 'GET') {
    return res.status(200).json(readEmbeds());
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as any;
    const action = String(body.action || '').trim();
    const store = readEmbeds();

    if (action === 'create_announcement') {
      const base = normalizeAnnouncement(body?.announcement || {});
      const created: AnnouncementEmbed = {
        ...base,
        id: makeId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.announcements.unshift(created);
      writeEmbeds(store);
      return res.status(200).json({ok: true, announcement: created, store});
    }

    if (action === 'update_announcement') {
      const id = String(body?.id || '').trim();
      if (!id) return res.status(400).json({error: 'id is required'});
      const idx = store.announcements.findIndex((a) => a.id === id);
      if (idx < 0) return res.status(404).json({error: 'Announcement not found'});
      const prev = store.announcements[idx];
      store.announcements[idx] = normalizeAnnouncement(body?.announcement || {}, prev);
      writeEmbeds(store);
      return res.status(200).json({ok: true, announcement: store.announcements[idx], store});
    }

    if (action === 'delete_announcement') {
      const id = String(body?.id || '').trim();
      if (!id) return res.status(400).json({error: 'id is required'});
      store.announcements = store.announcements.filter((a) => a.id !== id);
      writeEmbeds(store);
      return res.status(200).json({ok: true, store});
    }

    if (action === 'update_weekly_template') {
      const id = String(body?.id || '').trim() as WeeklyTemplate['id'];
      if (!['weekly_outstanding', 'weekly_uptodate', 'weekly_credit'].includes(id)) {
        return res.status(400).json({error: 'Invalid weekly template id'});
      }
      store.weeklyTemplates[id] = normalizeWeeklyTemplate(
        body?.template || {},
        store.weeklyTemplates[id] || DEFAULTS.weeklyTemplates[id]
      );
      writeEmbeds(store);
      return res.status(200).json({ok: true, template: store.weeklyTemplates[id], store});
    }

    if (action === 'update_weekly_summary_settings') {
      store.weeklySummaryChannelId = normalizeChannelId(body?.channelId);
      store.weeklySummaryRoleId = normalizeChannelId(body?.roleId);
      writeEmbeds(store);
      return res.status(200).json({
        ok: true,
        weeklySummaryChannelId: store.weeklySummaryChannelId,
        weeklySummaryRoleId: store.weeklySummaryRoleId,
        store,
      });
    }

    if (action === 'update_subcrew_template') {
      const id = String(body?.id || '').trim() as SubCrewEmbedTemplateId;
      if (!['subcrew_wash_log', 'subcrew_order_update'].includes(id)) {
        return res.status(400).json({error: 'Invalid sub crew template id'});
      }
      store.subCrewTemplates[id] = normalizeSubCrewTemplate(
        body?.template || {},
        store.subCrewTemplates[id] || DEFAULTS.subCrewTemplates[id]
      );
      writeEmbeds(store);
      return res.status(200).json({ok: true, template: store.subCrewTemplates[id], store});
    }

    return res.status(400).json({error: 'Unknown action'});
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({error: 'Method not allowed'});
}
