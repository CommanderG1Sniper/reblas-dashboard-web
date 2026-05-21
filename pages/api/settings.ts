import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from './auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../lib/server/json-cache';
import {normalizeSubCrews, resolveViewerCrewContext, type SubCrew} from '../../lib/sub-crews';
import {hasJobTrackingViewOnlyAccess, hasOwnerAccess, normalizeDiscordIdList} from '../../lib/owner-access';
import {resolveOwnerPreviewContext} from '../../lib/server/owner-preview';
import {isMainGuildMember} from '../../lib/server/viewer-access';
import {hasWeeklysTrackerAccess} from '../../lib/server/weeklys-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const SUBCREW_BACKUP_PATH = getRuntimeDataPath('subcrews.backup.json');

type ButtonStyle = {text: string; color: string};
type ReactionRole = {
  id: string;
  emoji: string;
  label: string;
  roleId: string;
  description: string;
};

type SettingsFile = {
  ownerDiscordId: string;
  coOwnerDiscordIds: string[];

  discordClientId: string;
  discordClientSecret: string;

  guildName: string;
  guildId: string;
  subGuildId: string;
  guildAvatar: string;
  botToken: string;
  defaultWashRatePct: number;
  mainCrewDirtyResetDate: string;
  miningDailyPriceStartDate: string;
  mainCrewWashLogChannelId: string;
  mainCrewWashLogMentionRoleIds: string[];
  mainCrewOrderUpdatesChannelId: string;
  mainCrewOrderUpdatesMentionRoleIds: string[];
  welcomeBotMainEnabled: boolean;
  welcomeBotMainTempCategoryId: string;
  welcomeBotMainRoleRequestChannelId: string;
  welcomeBotMainRequestTagRoleIds: string[];
  welcomeBotMainBaseRoleIds: string[];
  welcomeBotSubEnabled: boolean;
  welcomeBotSubTempCategoryId: string;
  welcomeBotSubRoleRequestChannelId: string;
  welcomeBotSubRequestTagRoleIds: string[];
  welcomeBotSubBaseRoleIds: string[];
  twitchNotificationsEnabled: boolean;
  twitchClientId: string;
  twitchClientSecret: string;
  twitchNotificationChannelId: string;
  twitchNotificationMentionRoleId: string;
  twitchStreamerLogins: string[];
  miningDiscordGuildId: string;
  miningDiscordClientId: string;
  miningBotToken: string;
  miningPriceSubmissionChannelId: string;
  miningTradingTipChannelId: string;
  miningMarketShiftAlertChannelId: string;
  miningMarketShiftAlertDeviationPct: number;
  miningPricePanelInstructions: string;
  miningPriceSubmitRoleId: string;
  miningPriceApprovalRoleId: string;
  reactionBotEnabled: boolean;
  reactionBotChannelId: string;
  reactionBotMessageId: string;
  reactionBotChannelName: string;
  reactionBotEmbedTitle: string;
  reactionBotEmbedDescription: string;
  reactionBotEmbedColor: string;
  reactionRoles: ReactionRole[];

  dashboardBackground: string;

  outlineColor: string; // hex
  buttonStyles: ButtonStyle[]; // 4 styles
  memberOfMonthGlowColor: string; // hex
  memberOfMonthAvatarRingColor: string; // hex
  memberOfMonthSparkleColor: string; // hex
  memberOfMonthTextColor: string; // hex
  washPermissionAdd: boolean;
  washPermissionEdit: boolean;
  washPermissionDelete: boolean;
  washPermissionMarkPending: boolean;
  washPermissionMarkPaid: boolean;
  washPermissionAddMemberIds: string[];
  washPermissionEditMemberIds: string[];
  washPermissionDeleteMemberIds: string[];
  washPermissionMarkPendingMemberIds: string[];
  washPermissionMarkPaidMemberIds: string[];
  orderPermissionViewMemberIds: string[];
  orderPermissionPlaceMemberIds: string[];
  orderPermissionManageMemberIds: string[];
  orderPermissionCancelMemberIds: string[];
  jobTrackingViewOnlyDiscordIds: string[];

  // Members settings (stored in settings.json but edited via /api/members/settings)
  membersDisplayRoleIds: string[];
  membersExcludeRoleIds: string[];
  subCrews: SubCrew[];
};

const DEFAULTS: SettingsFile = {
  ownerDiscordId: '',
  coOwnerDiscordIds: [],

  discordClientId: '',
  discordClientSecret: '',

  guildName: '',
  guildId: '',
  subGuildId: '',
  guildAvatar: '',
  botToken: '',
  defaultWashRatePct: 25,
  mainCrewDirtyResetDate: '',
  miningDailyPriceStartDate: '',
  mainCrewWashLogChannelId: '',
  mainCrewWashLogMentionRoleIds: [],
  mainCrewOrderUpdatesChannelId: '',
  mainCrewOrderUpdatesMentionRoleIds: [],
  welcomeBotMainEnabled: false,
  welcomeBotMainTempCategoryId: '',
  welcomeBotMainRoleRequestChannelId: '',
  welcomeBotMainRequestTagRoleIds: [],
  welcomeBotMainBaseRoleIds: [],
  welcomeBotSubEnabled: false,
  welcomeBotSubTempCategoryId: '',
  welcomeBotSubRoleRequestChannelId: '',
  welcomeBotSubRequestTagRoleIds: [],
  welcomeBotSubBaseRoleIds: [],
  twitchNotificationsEnabled: false,
  twitchClientId: '',
  twitchClientSecret: '',
  twitchNotificationChannelId: '',
  twitchNotificationMentionRoleId: '',
  twitchStreamerLogins: [],
  miningDiscordGuildId: '',
  miningDiscordClientId: '',
  miningBotToken: '',
  miningPriceSubmissionChannelId: '',
  miningTradingTipChannelId: '',
  miningMarketShiftAlertChannelId: '',
  miningMarketShiftAlertDeviationPct: 15,
  miningPricePanelInstructions: 'Paste the full EXPORT PRICES block exactly as copied from the game. Then submit it to import today\'s prices.',
  miningPriceSubmitRoleId: '',
  miningPriceApprovalRoleId: '',
  reactionBotEnabled: false,
  reactionBotChannelId: '',
  reactionBotMessageId: '',
  reactionBotChannelName: 'reactions',
  reactionBotEmbedTitle: 'Choose Your Roles',
  reactionBotEmbedDescription: 'React below to add or remove roles.',
  reactionBotEmbedColor: '#3b82f6',
  reactionRoles: [],

  dashboardBackground: '',

  outlineColor: '#ffffff14',
  buttonStyles: [
    {text: 'Clear', color: '#3b82f6'},
    {text: 'Save', color: '#22c55e'},
    {text: 'Delete', color: '#ef4444'},
    {text: 'Action', color: '#f59e0b'},
  ],
  memberOfMonthGlowColor: '#3b82f6',
  memberOfMonthAvatarRingColor: '#3b82f6',
  memberOfMonthSparkleColor: '#3b82f6',
  memberOfMonthTextColor: '#fbbf24',
  washPermissionAdd: true,
  washPermissionEdit: true,
  washPermissionDelete: true,
  washPermissionMarkPending: true,
  washPermissionMarkPaid: true,
  washPermissionAddMemberIds: [],
  washPermissionEditMemberIds: [],
  washPermissionDeleteMemberIds: [],
  washPermissionMarkPendingMemberIds: [],
  washPermissionMarkPaidMemberIds: [],
  orderPermissionViewMemberIds: [],
  orderPermissionPlaceMemberIds: [],
  orderPermissionManageMemberIds: [],
  orderPermissionCancelMemberIds: [],
  jobTrackingViewOnlyDiscordIds: [],

  membersDisplayRoleIds: [],
  membersExcludeRoleIds: [],
  subCrews: [],
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  }
}

function readSubCrewBackup(fallbackOutlineColor: string): SubCrew[] {
  try {
    if (!fs.existsSync(SUBCREW_BACKUP_PATH)) return [];
    return normalizeSubCrews(readJsonFileCached<any>(SUBCREW_BACKUP_PATH, () => []), fallbackOutlineColor);
  } catch {
    return [];
  }
}

function writeSubCrewBackup(subCrews: SubCrew[]) {
  if (!Array.isArray(subCrews) || subCrews.length === 0) return;
  ensureFile();
  const tmp = SUBCREW_BACKUP_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(subCrews, null, 2), 'utf8');
  fs.renameSync(tmp, SUBCREW_BACKUP_PATH);
  invalidateJsonFileCache(SUBCREW_BACKUP_PATH);
}

function isHexColor(v: string) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}

function normalizeButtonStyles(raw: any): ButtonStyle[] {
  const fallback = DEFAULTS.buttonStyles;
  if (!Array.isArray(raw)) return fallback;

  const out: ButtonStyle[] = [];
  for (let i = 0; i < 4; i++) {
    const it = raw[i] || {};
    const text = typeof it.text === 'string' ? it.text : fallback[i].text;
    const colorRaw = typeof it.color === 'string' ? it.color.trim() : '';
    const color = isHexColor(colorRaw) ? colorRaw : fallback[i].color;
    out.push({text, color});
  }
  return out;
}

function normalizeRoleIdList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = String(v || '').trim();
    if (/^\d{6,25}$/.test(id)) out.push(id);
  }
  return Array.from(new Set(out));
}

function normalizeDiscordId(raw: any) {
  const value = String(raw || '').trim();
  return /^\d{6,25}$/.test(value) ? value : '';
}

function normalizeTwitchLogin(raw: any) {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\/(www\.)?twitch\.tv\//, '');
  value = value.replace(/^@/, '');
  value = value.split(/[/?#]/)[0] || '';
  return /^[a-z0-9_]{3,25}$/.test(value) ? value : '';
}

function normalizeTwitchLoginList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const login = normalizeTwitchLogin(value);
    if (login) out.push(login);
  }
  return Array.from(new Set(out));
}

function normalizeReactionRole(raw: any): ReactionRole | null {
  const id = String(raw?.id || '').trim() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const emoji = String(raw?.emoji || '').trim().slice(0, 80);
  const roleId = normalizeDiscordId(raw?.roleId);
  const label = String(raw?.label || '').trim().slice(0, 80);
  const description = String(raw?.description || '').trim().slice(0, 180);
  if (!emoji || !roleId) return null;
  return {
    id,
    emoji,
    label: label || 'Reaction Role',
    roleId,
    description,
  };
}

function normalizeReactionRoles(raw: any): ReactionRole[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ReactionRole[] = [];
  for (const item of raw) {
    const role = normalizeReactionRole(item);
    if (!role) continue;
    const key = `${role.emoji}:${role.roleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(role);
  }
  return out.slice(0, 25);
}

function clampRate(v: any) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 25;
  return Math.max(0, Math.min(100, n));
}

function clampPercent(v: any, fallback = 15) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, n));
}

function normalizeChannelId(raw: any) {
  return normalizeDiscordId(raw);
}

function readSettings(): SettingsFile {
  ensureFile();
  try {
    const parsed = readJsonFileCached<any>(SETTINGS_PATH, () => DEFAULTS);

    const outlineRaw = typeof parsed.outlineColor === 'string' ? parsed.outlineColor.trim() : '';
    const outlineColor = isHexColor(outlineRaw) ? outlineRaw : DEFAULTS.outlineColor;
    const memberOfMonthGlowColor = isHexColor(String(parsed.memberOfMonthGlowColor || '').trim())
      ? String(parsed.memberOfMonthGlowColor).trim()
      : DEFAULTS.memberOfMonthGlowColor;
    const memberOfMonthAvatarRingColor = isHexColor(String(parsed.memberOfMonthAvatarRingColor || '').trim())
      ? String(parsed.memberOfMonthAvatarRingColor).trim()
      : DEFAULTS.memberOfMonthAvatarRingColor;
    const memberOfMonthSparkleColor = isHexColor(String(parsed.memberOfMonthSparkleColor || '').trim())
      ? String(parsed.memberOfMonthSparkleColor).trim()
      : DEFAULTS.memberOfMonthSparkleColor;
    const memberOfMonthTextColor = isHexColor(String(parsed.memberOfMonthTextColor || '').trim())
      ? String(parsed.memberOfMonthTextColor).trim()
      : DEFAULTS.memberOfMonthTextColor;
    const subCrews = normalizeSubCrews(parsed.subCrews, outlineColor);
    const safeSubCrews = subCrews.length > 0 ? subCrews : readSubCrewBackup(outlineColor);

    if (subCrews.length > 0) {
      writeSubCrewBackup(subCrews);
    }

    return {
      ownerDiscordId: typeof parsed.ownerDiscordId === 'string' ? parsed.ownerDiscordId : DEFAULTS.ownerDiscordId,
      coOwnerDiscordIds: normalizeDiscordIdList(parsed.coOwnerDiscordIds),

      discordClientId: typeof parsed.discordClientId === 'string' ? parsed.discordClientId : DEFAULTS.discordClientId,
      discordClientSecret:
        typeof parsed.discordClientSecret === 'string' ? parsed.discordClientSecret : DEFAULTS.discordClientSecret,

      guildName: typeof parsed.guildName === 'string' ? parsed.guildName : DEFAULTS.guildName,
      guildId: typeof parsed.guildId === 'string' ? parsed.guildId : DEFAULTS.guildId,
      subGuildId: typeof parsed.subGuildId === 'string' ? parsed.subGuildId : DEFAULTS.subGuildId,
      guildAvatar: typeof parsed.guildAvatar === 'string' ? parsed.guildAvatar : DEFAULTS.guildAvatar,
      botToken: typeof parsed.botToken === 'string' ? parsed.botToken : DEFAULTS.botToken,
      defaultWashRatePct: clampRate(parsed.defaultWashRatePct),
      mainCrewDirtyResetDate:
        typeof parsed.mainCrewDirtyResetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.mainCrewDirtyResetDate)
          ? parsed.mainCrewDirtyResetDate
          : DEFAULTS.mainCrewDirtyResetDate,
      miningDailyPriceStartDate:
        typeof parsed.miningDailyPriceStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.miningDailyPriceStartDate)
          ? parsed.miningDailyPriceStartDate
          : DEFAULTS.miningDailyPriceStartDate,
      mainCrewWashLogChannelId: normalizeChannelId(parsed.mainCrewWashLogChannelId),
      mainCrewWashLogMentionRoleIds: normalizeRoleIdList(parsed.mainCrewWashLogMentionRoleIds),
      mainCrewOrderUpdatesChannelId: normalizeChannelId(parsed.mainCrewOrderUpdatesChannelId),
      mainCrewOrderUpdatesMentionRoleIds: normalizeRoleIdList(parsed.mainCrewOrderUpdatesMentionRoleIds),
      welcomeBotMainEnabled:
        parsed.welcomeBotMainEnabled !== undefined ? !!parsed.welcomeBotMainEnabled : DEFAULTS.welcomeBotMainEnabled,
      welcomeBotMainTempCategoryId: normalizeChannelId(parsed.welcomeBotMainTempCategoryId),
      welcomeBotMainRoleRequestChannelId: normalizeChannelId(parsed.welcomeBotMainRoleRequestChannelId),
      welcomeBotMainRequestTagRoleIds: normalizeRoleIdList(parsed.welcomeBotMainRequestTagRoleIds),
      welcomeBotMainBaseRoleIds:
        parsed.welcomeBotMainBaseRoleIds !== undefined
          ? normalizeRoleIdList(parsed.welcomeBotMainBaseRoleIds)
          : normalizeRoleIdList([parsed.welcomeBotMainBaseRoleId]),
      welcomeBotSubEnabled:
        parsed.welcomeBotSubEnabled !== undefined ? !!parsed.welcomeBotSubEnabled : DEFAULTS.welcomeBotSubEnabled,
      welcomeBotSubTempCategoryId: normalizeChannelId(parsed.welcomeBotSubTempCategoryId),
      welcomeBotSubRoleRequestChannelId: normalizeChannelId(parsed.welcomeBotSubRoleRequestChannelId),
      welcomeBotSubRequestTagRoleIds: normalizeRoleIdList(parsed.welcomeBotSubRequestTagRoleIds),
      welcomeBotSubBaseRoleIds:
        parsed.welcomeBotSubBaseRoleIds !== undefined
          ? normalizeRoleIdList(parsed.welcomeBotSubBaseRoleIds)
          : normalizeRoleIdList([parsed.welcomeBotSubBaseRoleId]),
      twitchNotificationsEnabled:
        parsed.twitchNotificationsEnabled !== undefined
          ? !!parsed.twitchNotificationsEnabled
          : DEFAULTS.twitchNotificationsEnabled,
      twitchClientId: typeof parsed.twitchClientId === 'string' ? parsed.twitchClientId.trim() : DEFAULTS.twitchClientId,
      twitchClientSecret:
        typeof parsed.twitchClientSecret === 'string' ? parsed.twitchClientSecret.trim() : DEFAULTS.twitchClientSecret,
      twitchNotificationChannelId: normalizeChannelId(parsed.twitchNotificationChannelId),
      twitchNotificationMentionRoleId: normalizeDiscordId(parsed.twitchNotificationMentionRoleId),
      twitchStreamerLogins: normalizeTwitchLoginList(parsed.twitchStreamerLogins),
      miningDiscordGuildId: normalizeDiscordId(parsed.miningDiscordGuildId),
      miningDiscordClientId: normalizeDiscordId(parsed.miningDiscordClientId),
      miningBotToken: typeof parsed.miningBotToken === 'string' ? parsed.miningBotToken.trim() : DEFAULTS.miningBotToken,
      miningPriceSubmissionChannelId: normalizeChannelId(parsed.miningPriceSubmissionChannelId),
      miningTradingTipChannelId: normalizeChannelId(parsed.miningTradingTipChannelId),
      miningMarketShiftAlertChannelId: normalizeChannelId(parsed.miningMarketShiftAlertChannelId),
      miningMarketShiftAlertDeviationPct: clampPercent(parsed.miningMarketShiftAlertDeviationPct, DEFAULTS.miningMarketShiftAlertDeviationPct),
      miningPricePanelInstructions:
        String(parsed.miningPricePanelInstructions || DEFAULTS.miningPricePanelInstructions).trim().slice(0, 1200) ||
        DEFAULTS.miningPricePanelInstructions,
      miningPriceSubmitRoleId: normalizeDiscordId(parsed.miningPriceSubmitRoleId),
      miningPriceApprovalRoleId: normalizeDiscordId(parsed.miningPriceApprovalRoleId),
      reactionBotEnabled:
        parsed.reactionBotEnabled !== undefined ? !!parsed.reactionBotEnabled : DEFAULTS.reactionBotEnabled,
      reactionBotChannelId: normalizeChannelId(parsed.reactionBotChannelId),
      reactionBotMessageId: normalizeDiscordId(parsed.reactionBotMessageId),
      reactionBotChannelName:
        String(parsed.reactionBotChannelName || DEFAULTS.reactionBotChannelName).trim().slice(0, 80) ||
        DEFAULTS.reactionBotChannelName,
      reactionBotEmbedTitle:
        String(parsed.reactionBotEmbedTitle || DEFAULTS.reactionBotEmbedTitle).trim().slice(0, 256) ||
        DEFAULTS.reactionBotEmbedTitle,
      reactionBotEmbedDescription:
        String(parsed.reactionBotEmbedDescription || DEFAULTS.reactionBotEmbedDescription).trim().slice(0, 1200) ||
        DEFAULTS.reactionBotEmbedDescription,
      reactionBotEmbedColor: isHexColor(String(parsed.reactionBotEmbedColor || '').trim())
        ? String(parsed.reactionBotEmbedColor).trim()
        : DEFAULTS.reactionBotEmbedColor,
      reactionRoles: normalizeReactionRoles(parsed.reactionRoles),

      dashboardBackground:
        typeof parsed.dashboardBackground === 'string' ? parsed.dashboardBackground : DEFAULTS.dashboardBackground,

      outlineColor,
      buttonStyles: normalizeButtonStyles(parsed.buttonStyles),
      memberOfMonthGlowColor,
      memberOfMonthAvatarRingColor,
      memberOfMonthSparkleColor,
      memberOfMonthTextColor,
      washPermissionAdd: parsed.washPermissionAdd !== undefined ? !!parsed.washPermissionAdd : DEFAULTS.washPermissionAdd,
      washPermissionEdit:
        parsed.washPermissionEdit !== undefined ? !!parsed.washPermissionEdit : DEFAULTS.washPermissionEdit,
      washPermissionDelete:
        parsed.washPermissionDelete !== undefined ? !!parsed.washPermissionDelete : DEFAULTS.washPermissionDelete,
      washPermissionMarkPending:
        parsed.washPermissionMarkPending !== undefined
          ? !!parsed.washPermissionMarkPending
          : DEFAULTS.washPermissionMarkPending,
      washPermissionMarkPaid:
        parsed.washPermissionMarkPaid !== undefined
          ? !!parsed.washPermissionMarkPaid
          : DEFAULTS.washPermissionMarkPaid,
      washPermissionAddMemberIds: normalizeRoleIdList(parsed.washPermissionAddMemberIds),
      washPermissionEditMemberIds: normalizeRoleIdList(parsed.washPermissionEditMemberIds),
      washPermissionDeleteMemberIds: normalizeRoleIdList(parsed.washPermissionDeleteMemberIds),
      washPermissionMarkPendingMemberIds: normalizeRoleIdList(parsed.washPermissionMarkPendingMemberIds),
      washPermissionMarkPaidMemberIds: normalizeRoleIdList(parsed.washPermissionMarkPaidMemberIds),
      orderPermissionViewMemberIds: normalizeRoleIdList(parsed.orderPermissionViewMemberIds),
      orderPermissionPlaceMemberIds: normalizeRoleIdList(parsed.orderPermissionPlaceMemberIds),
      orderPermissionManageMemberIds: normalizeRoleIdList(parsed.orderPermissionManageMemberIds),
      orderPermissionCancelMemberIds: normalizeRoleIdList(parsed.orderPermissionCancelMemberIds),
      jobTrackingViewOnlyDiscordIds: normalizeRoleIdList(parsed.jobTrackingViewOnlyDiscordIds),

      membersDisplayRoleIds: normalizeRoleIdList(parsed.membersDisplayRoleIds),
      membersExcludeRoleIds: normalizeRoleIdList(parsed.membersExcludeRoleIds),
      subCrews: safeSubCrews,
    };
  } catch {
    return DEFAULTS;
  }
}

function writeSettings(next: SettingsFile) {
  ensureFile();
  const tmp = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
  invalidateJsonFileCache(SETTINGS_PATH);
  writeSubCrewBackup(next.subCrews);
}

function getDiscordIdFromSession(session: any): string {
  return String(session?.discordId || '').trim();
}

function toClientPayload(
  current: SettingsFile,
  isOwner: boolean,
  viewer = resolveViewerCrewContext({
    ownerDiscordId: current.ownerDiscordId,
    coOwnerDiscordIds: current.coOwnerDiscordIds,
    discordId: '',
    outlineColor: current.outlineColor,
    subCrews: current.subCrews,
  }),
  actorDiscordId = ''
) {
  return {
    ownerDiscordId: current.ownerDiscordId,
    coOwnerDiscordIds: isOwner ? current.coOwnerDiscordIds : [],

    // SAFE to expose (needed for invite URL)
    discordClientId: current.discordClientId,

    guildName: current.guildName,
    guildId: current.guildId,
    subGuildId: current.subGuildId,
    guildAvatar: current.guildAvatar,
    botToken: isOwner ? current.botToken : '',
    defaultWashRatePct: current.defaultWashRatePct,
    mainCrewDirtyResetDate: current.mainCrewDirtyResetDate,
    miningDailyPriceStartDate: current.miningDailyPriceStartDate,
    mainCrewWashLogChannelId: current.mainCrewWashLogChannelId,
    mainCrewWashLogMentionRoleIds: current.mainCrewWashLogMentionRoleIds,
    mainCrewOrderUpdatesChannelId: current.mainCrewOrderUpdatesChannelId,
    mainCrewOrderUpdatesMentionRoleIds: current.mainCrewOrderUpdatesMentionRoleIds,
    welcomeBotMainEnabled: current.welcomeBotMainEnabled,
    welcomeBotMainTempCategoryId: current.welcomeBotMainTempCategoryId,
    welcomeBotMainRoleRequestChannelId: current.welcomeBotMainRoleRequestChannelId,
    welcomeBotMainRequestTagRoleIds: current.welcomeBotMainRequestTagRoleIds,
    welcomeBotMainBaseRoleIds: current.welcomeBotMainBaseRoleIds,
    welcomeBotSubEnabled: current.welcomeBotSubEnabled,
    welcomeBotSubTempCategoryId: current.welcomeBotSubTempCategoryId,
    welcomeBotSubRoleRequestChannelId: current.welcomeBotSubRoleRequestChannelId,
    welcomeBotSubRequestTagRoleIds: current.welcomeBotSubRequestTagRoleIds,
    welcomeBotSubBaseRoleIds: current.welcomeBotSubBaseRoleIds,
    twitchNotificationsEnabled: current.twitchNotificationsEnabled,
    twitchClientId: current.twitchClientId,
    twitchClientSecret: isOwner ? current.twitchClientSecret : '',
    twitchNotificationChannelId: current.twitchNotificationChannelId,
    twitchNotificationMentionRoleId: current.twitchNotificationMentionRoleId,
    twitchStreamerLogins: current.twitchStreamerLogins,
    miningDiscordGuildId: current.miningDiscordGuildId,
    miningDiscordClientId: current.miningDiscordClientId,
    miningBotToken: isOwner ? current.miningBotToken : '',
    miningPriceSubmissionChannelId: current.miningPriceSubmissionChannelId,
    miningTradingTipChannelId: current.miningTradingTipChannelId,
    miningMarketShiftAlertChannelId: current.miningMarketShiftAlertChannelId,
    miningMarketShiftAlertDeviationPct: current.miningMarketShiftAlertDeviationPct,
    miningPricePanelInstructions: current.miningPricePanelInstructions,
    miningPriceSubmitRoleId: current.miningPriceSubmitRoleId,
    miningPriceApprovalRoleId: current.miningPriceApprovalRoleId,
    reactionBotEnabled: current.reactionBotEnabled,
    reactionBotChannelId: current.reactionBotChannelId,
    reactionBotMessageId: current.reactionBotMessageId,
    reactionBotChannelName: current.reactionBotChannelName,
    reactionBotEmbedTitle: current.reactionBotEmbedTitle,
    reactionBotEmbedDescription: current.reactionBotEmbedDescription,
    reactionBotEmbedColor: current.reactionBotEmbedColor,
    reactionRoles: current.reactionRoles,

    dashboardBackground: current.dashboardBackground,
    outlineColor: current.outlineColor,
    buttonStyles: current.buttonStyles,
    memberOfMonthGlowColor: current.memberOfMonthGlowColor,
    memberOfMonthAvatarRingColor: current.memberOfMonthAvatarRingColor,
    memberOfMonthSparkleColor: current.memberOfMonthSparkleColor,
    memberOfMonthTextColor: current.memberOfMonthTextColor,
    washPermissionAdd: current.washPermissionAdd,
    washPermissionEdit: current.washPermissionEdit,
    washPermissionDelete: current.washPermissionDelete,
    washPermissionMarkPending: current.washPermissionMarkPending,
    washPermissionMarkPaid: current.washPermissionMarkPaid,
    washPermissionAddMemberIds: current.washPermissionAddMemberIds,
    washPermissionEditMemberIds: current.washPermissionEditMemberIds,
    washPermissionDeleteMemberIds: current.washPermissionDeleteMemberIds,
    washPermissionMarkPendingMemberIds: current.washPermissionMarkPendingMemberIds,
    washPermissionMarkPaidMemberIds: current.washPermissionMarkPaidMemberIds,
    orderPermissionViewMemberIds: current.orderPermissionViewMemberIds,
    orderPermissionPlaceMemberIds: current.orderPermissionPlaceMemberIds,
    orderPermissionManageMemberIds: current.orderPermissionManageMemberIds,
    orderPermissionCancelMemberIds: current.orderPermissionCancelMemberIds,
    jobTrackingViewOnlyDiscordIds: isOwner ? current.jobTrackingViewOnlyDiscordIds : [],
    jobTrackingViewOnlyAccess: viewer.dashboardAccessMode === 'job_tracking_only',
    dashboardAccessMode: viewer.dashboardAccessMode,
    weeklysTrackerAccess: hasWeeklysTrackerAccess(current, actorDiscordId),

    membersDisplayRoleIds: current.membersDisplayRoleIds,
    membersExcludeRoleIds: current.membersExcludeRoleIds,
    subCrews: isOwner ? current.subCrews : [],
    viewerRole: viewer.viewerRole,
    viewerSubCrewId: viewer.viewerSubCrewId,
    viewerSubCrewName: viewer.viewerSubCrewName,
    viewerOutlineColor: viewer.viewerOutlineColor,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const current = readSettings();

  if (req.method === 'GET') {
    const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
    const discordId = getDiscordIdFromSession(session);
    const preview = resolveOwnerPreviewContext(req, current, discordId);
    const isOwner = hasOwnerAccess(current, discordId);
    const viewer = resolveViewerCrewContext({
      ownerDiscordId: current.ownerDiscordId,
      coOwnerDiscordIds: current.coOwnerDiscordIds,
      discordId: preview.effectiveDiscordId,
      outlineColor: current.outlineColor,
      subCrews: current.subCrews,
      isMainGuildMember: isMainGuildMember(preview.effectiveDiscordId),
      hasJobTrackingViewOnlyAccess: hasJobTrackingViewOnlyAccess(current, preview.effectiveDiscordId),
    });

    return res.status(200).json(toClientPayload(current, isOwner, viewer, preview.effectiveDiscordId));
  }

  if (req.method === 'PUT') {
    let actorDiscordId = '';
    if (current.ownerDiscordId) {
      const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
      actorDiscordId = getDiscordIdFromSession(session);
      if (!actorDiscordId) return res.status(401).json({error: 'Login required'});
      if (!hasOwnerAccess(current, actorDiscordId)) return res.status(403).json({error: 'Owner only'});
    } else {
      return res.status(409).json({error: 'Owner not initialized yet'});
    }

    const body = (req.body || {}) as Partial<SettingsFile> & {
      welcomeBotMainBaseRoleId?: string;
      welcomeBotSubBaseRoleId?: string;
    };

    const outlineRaw = typeof body.outlineColor === 'string' ? body.outlineColor.trim() : '';
    const outlineColor = isHexColor(outlineRaw) ? outlineRaw : current.outlineColor;
    const incomingSubCrews =
      body.subCrews !== undefined ? normalizeSubCrews(body.subCrews, outlineColor) : null;
    const preserveExistingSubCrews =
      incomingSubCrews !== null &&
      current.subCrews.length > 0 &&
      incomingSubCrews.length === 0 &&
      (body as any)?.allowEmptySubCrews !== true;
    const memberOfMonthGlowColor = isHexColor(String(body.memberOfMonthGlowColor || '').trim())
      ? String(body.memberOfMonthGlowColor).trim()
      : current.memberOfMonthGlowColor;
    const memberOfMonthAvatarRingColor = isHexColor(String(body.memberOfMonthAvatarRingColor || '').trim())
      ? String(body.memberOfMonthAvatarRingColor).trim()
      : current.memberOfMonthAvatarRingColor;
    const memberOfMonthSparkleColor = isHexColor(String(body.memberOfMonthSparkleColor || '').trim())
      ? String(body.memberOfMonthSparkleColor).trim()
      : current.memberOfMonthSparkleColor;
    const memberOfMonthTextColor = isHexColor(String(body.memberOfMonthTextColor || '').trim())
      ? String(body.memberOfMonthTextColor).trim()
      : current.memberOfMonthTextColor;

    const next: SettingsFile = {
      ...current,

      // never editable here:
      ownerDiscordId: current.ownerDiscordId,
      coOwnerDiscordIds:
        body.coOwnerDiscordIds !== undefined
          ? normalizeDiscordIdList(body.coOwnerDiscordIds)
          : current.coOwnerDiscordIds,
      discordClientId: current.discordClientId,
      discordClientSecret: current.discordClientSecret,

      // editable:
      guildName: typeof body.guildName === 'string' ? body.guildName : current.guildName,
      guildId: typeof body.guildId === 'string' ? body.guildId : current.guildId,
      subGuildId: typeof body.subGuildId === 'string' ? body.subGuildId : current.subGuildId,
      guildAvatar: typeof body.guildAvatar === 'string' ? body.guildAvatar : current.guildAvatar,
      botToken: typeof body.botToken === 'string' ? body.botToken : current.botToken,
      defaultWashRatePct:
        body.defaultWashRatePct !== undefined ? clampRate(body.defaultWashRatePct) : current.defaultWashRatePct,
      mainCrewDirtyResetDate:
        typeof body.mainCrewDirtyResetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.mainCrewDirtyResetDate)
          ? body.mainCrewDirtyResetDate
          : '',
      miningDailyPriceStartDate:
        typeof body.miningDailyPriceStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.miningDailyPriceStartDate)
          ? body.miningDailyPriceStartDate
          : '',
      mainCrewWashLogChannelId:
        body.mainCrewWashLogChannelId !== undefined
          ? normalizeChannelId(body.mainCrewWashLogChannelId)
          : current.mainCrewWashLogChannelId,
      mainCrewWashLogMentionRoleIds:
        body.mainCrewWashLogMentionRoleIds !== undefined
          ? normalizeRoleIdList(body.mainCrewWashLogMentionRoleIds)
          : current.mainCrewWashLogMentionRoleIds,
      mainCrewOrderUpdatesChannelId:
        body.mainCrewOrderUpdatesChannelId !== undefined
          ? normalizeChannelId(body.mainCrewOrderUpdatesChannelId)
          : current.mainCrewOrderUpdatesChannelId,
      mainCrewOrderUpdatesMentionRoleIds:
        body.mainCrewOrderUpdatesMentionRoleIds !== undefined
          ? normalizeRoleIdList(body.mainCrewOrderUpdatesMentionRoleIds)
          : current.mainCrewOrderUpdatesMentionRoleIds,
      welcomeBotMainEnabled:
        body.welcomeBotMainEnabled !== undefined ? !!body.welcomeBotMainEnabled : current.welcomeBotMainEnabled,
      welcomeBotMainTempCategoryId:
        body.welcomeBotMainTempCategoryId !== undefined
          ? normalizeChannelId(body.welcomeBotMainTempCategoryId)
          : current.welcomeBotMainTempCategoryId,
      welcomeBotMainRoleRequestChannelId:
        body.welcomeBotMainRoleRequestChannelId !== undefined
          ? normalizeChannelId(body.welcomeBotMainRoleRequestChannelId)
          : current.welcomeBotMainRoleRequestChannelId,
      welcomeBotMainRequestTagRoleIds:
        body.welcomeBotMainRequestTagRoleIds !== undefined
          ? normalizeRoleIdList(body.welcomeBotMainRequestTagRoleIds)
          : current.welcomeBotMainRequestTagRoleIds,
      welcomeBotMainBaseRoleIds:
        body.welcomeBotMainBaseRoleIds !== undefined
          ? normalizeRoleIdList(body.welcomeBotMainBaseRoleIds)
          : body.welcomeBotMainBaseRoleId !== undefined
            ? normalizeRoleIdList([body.welcomeBotMainBaseRoleId])
            : current.welcomeBotMainBaseRoleIds,
      welcomeBotSubEnabled:
        body.welcomeBotSubEnabled !== undefined ? !!body.welcomeBotSubEnabled : current.welcomeBotSubEnabled,
      welcomeBotSubTempCategoryId:
        body.welcomeBotSubTempCategoryId !== undefined
          ? normalizeChannelId(body.welcomeBotSubTempCategoryId)
          : current.welcomeBotSubTempCategoryId,
      welcomeBotSubRoleRequestChannelId:
        body.welcomeBotSubRoleRequestChannelId !== undefined
          ? normalizeChannelId(body.welcomeBotSubRoleRequestChannelId)
          : current.welcomeBotSubRoleRequestChannelId,
      welcomeBotSubRequestTagRoleIds:
        body.welcomeBotSubRequestTagRoleIds !== undefined
          ? normalizeRoleIdList(body.welcomeBotSubRequestTagRoleIds)
          : current.welcomeBotSubRequestTagRoleIds,
      welcomeBotSubBaseRoleIds:
        body.welcomeBotSubBaseRoleIds !== undefined
          ? normalizeRoleIdList(body.welcomeBotSubBaseRoleIds)
          : body.welcomeBotSubBaseRoleId !== undefined
            ? normalizeRoleIdList([body.welcomeBotSubBaseRoleId])
            : current.welcomeBotSubBaseRoleIds,
      twitchNotificationsEnabled:
        body.twitchNotificationsEnabled !== undefined
          ? !!body.twitchNotificationsEnabled
          : current.twitchNotificationsEnabled,
      twitchClientId:
        body.twitchClientId !== undefined
          ? String(body.twitchClientId || '').trim()
          : current.twitchClientId,
      twitchClientSecret:
        body.twitchClientSecret !== undefined
          ? String(body.twitchClientSecret || '').trim()
          : current.twitchClientSecret,
      twitchNotificationChannelId:
        body.twitchNotificationChannelId !== undefined
          ? normalizeChannelId(body.twitchNotificationChannelId)
          : current.twitchNotificationChannelId,
      twitchNotificationMentionRoleId:
        body.twitchNotificationMentionRoleId !== undefined
          ? normalizeDiscordId(body.twitchNotificationMentionRoleId)
          : current.twitchNotificationMentionRoleId,
      twitchStreamerLogins:
        body.twitchStreamerLogins !== undefined
          ? normalizeTwitchLoginList(body.twitchStreamerLogins)
          : current.twitchStreamerLogins,
      miningDiscordGuildId:
        body.miningDiscordGuildId !== undefined
          ? normalizeDiscordId(body.miningDiscordGuildId)
          : current.miningDiscordGuildId,
      miningDiscordClientId:
        body.miningDiscordClientId !== undefined
          ? normalizeDiscordId(body.miningDiscordClientId)
          : current.miningDiscordClientId,
      miningBotToken:
        body.miningBotToken !== undefined
          ? String(body.miningBotToken || '').trim()
          : current.miningBotToken,
      miningPriceSubmissionChannelId:
        body.miningPriceSubmissionChannelId !== undefined
          ? normalizeChannelId(body.miningPriceSubmissionChannelId)
          : current.miningPriceSubmissionChannelId,
      miningTradingTipChannelId:
        body.miningTradingTipChannelId !== undefined
          ? normalizeChannelId(body.miningTradingTipChannelId)
          : current.miningTradingTipChannelId,
      miningMarketShiftAlertChannelId:
        body.miningMarketShiftAlertChannelId !== undefined
          ? normalizeChannelId(body.miningMarketShiftAlertChannelId)
          : current.miningMarketShiftAlertChannelId,
      miningMarketShiftAlertDeviationPct:
        body.miningMarketShiftAlertDeviationPct !== undefined
          ? clampPercent(body.miningMarketShiftAlertDeviationPct, DEFAULTS.miningMarketShiftAlertDeviationPct)
          : current.miningMarketShiftAlertDeviationPct,
      miningPricePanelInstructions:
        body.miningPricePanelInstructions !== undefined
          ? String(body.miningPricePanelInstructions || '').trim().slice(0, 1200) || DEFAULTS.miningPricePanelInstructions
          : current.miningPricePanelInstructions,
      miningPriceSubmitRoleId:
        body.miningPriceSubmitRoleId !== undefined
          ? normalizeDiscordId(body.miningPriceSubmitRoleId)
          : current.miningPriceSubmitRoleId,
      miningPriceApprovalRoleId:
        body.miningPriceApprovalRoleId !== undefined
          ? normalizeDiscordId(body.miningPriceApprovalRoleId)
          : current.miningPriceApprovalRoleId,
      reactionBotEnabled:
        body.reactionBotEnabled !== undefined ? !!body.reactionBotEnabled : current.reactionBotEnabled,
      reactionBotChannelId:
        body.reactionBotChannelId !== undefined
          ? normalizeChannelId(body.reactionBotChannelId)
          : current.reactionBotChannelId,
      reactionBotMessageId:
        body.reactionBotMessageId !== undefined
          ? normalizeDiscordId(body.reactionBotMessageId)
          : current.reactionBotMessageId,
      reactionBotChannelName:
        body.reactionBotChannelName !== undefined
          ? String(body.reactionBotChannelName || '').trim().slice(0, 80) || DEFAULTS.reactionBotChannelName
          : current.reactionBotChannelName,
      reactionBotEmbedTitle:
        body.reactionBotEmbedTitle !== undefined
          ? String(body.reactionBotEmbedTitle || '').trim().slice(0, 256) || DEFAULTS.reactionBotEmbedTitle
          : current.reactionBotEmbedTitle,
      reactionBotEmbedDescription:
        body.reactionBotEmbedDescription !== undefined
          ? String(body.reactionBotEmbedDescription || '').trim().slice(0, 1200) ||
            DEFAULTS.reactionBotEmbedDescription
          : current.reactionBotEmbedDescription,
      reactionBotEmbedColor:
        body.reactionBotEmbedColor !== undefined && isHexColor(String(body.reactionBotEmbedColor || '').trim())
          ? String(body.reactionBotEmbedColor).trim()
          : current.reactionBotEmbedColor,
      reactionRoles:
        body.reactionRoles !== undefined ? normalizeReactionRoles(body.reactionRoles) : current.reactionRoles,

      dashboardBackground:
        typeof body.dashboardBackground === 'string' ? body.dashboardBackground : current.dashboardBackground,

      outlineColor,
      buttonStyles: body.buttonStyles ? normalizeButtonStyles(body.buttonStyles) : current.buttonStyles,
      memberOfMonthGlowColor,
      memberOfMonthAvatarRingColor,
      memberOfMonthSparkleColor,
      memberOfMonthTextColor,
      washPermissionAdd: body.washPermissionAdd !== undefined ? !!body.washPermissionAdd : current.washPermissionAdd,
      washPermissionEdit:
        body.washPermissionEdit !== undefined ? !!body.washPermissionEdit : current.washPermissionEdit,
      washPermissionDelete:
        body.washPermissionDelete !== undefined ? !!body.washPermissionDelete : current.washPermissionDelete,
      washPermissionMarkPending:
        body.washPermissionMarkPending !== undefined
          ? !!body.washPermissionMarkPending
          : current.washPermissionMarkPending,
      washPermissionMarkPaid:
        body.washPermissionMarkPaid !== undefined ? !!body.washPermissionMarkPaid : current.washPermissionMarkPaid,
      washPermissionAddMemberIds:
        body.washPermissionAddMemberIds !== undefined
          ? normalizeRoleIdList(body.washPermissionAddMemberIds)
          : current.washPermissionAddMemberIds,
      washPermissionEditMemberIds:
        body.washPermissionEditMemberIds !== undefined
          ? normalizeRoleIdList(body.washPermissionEditMemberIds)
          : current.washPermissionEditMemberIds,
      washPermissionDeleteMemberIds:
        body.washPermissionDeleteMemberIds !== undefined
          ? normalizeRoleIdList(body.washPermissionDeleteMemberIds)
          : current.washPermissionDeleteMemberIds,
      washPermissionMarkPendingMemberIds:
        body.washPermissionMarkPendingMemberIds !== undefined
          ? normalizeRoleIdList(body.washPermissionMarkPendingMemberIds)
          : current.washPermissionMarkPendingMemberIds,
      washPermissionMarkPaidMemberIds:
        body.washPermissionMarkPaidMemberIds !== undefined
          ? normalizeRoleIdList(body.washPermissionMarkPaidMemberIds)
          : current.washPermissionMarkPaidMemberIds,
      orderPermissionViewMemberIds:
        body.orderPermissionViewMemberIds !== undefined
          ? normalizeRoleIdList(body.orderPermissionViewMemberIds)
          : current.orderPermissionViewMemberIds,
      orderPermissionPlaceMemberIds:
        body.orderPermissionPlaceMemberIds !== undefined
          ? normalizeRoleIdList(body.orderPermissionPlaceMemberIds)
          : current.orderPermissionPlaceMemberIds,
      orderPermissionManageMemberIds:
        body.orderPermissionManageMemberIds !== undefined
          ? normalizeRoleIdList(body.orderPermissionManageMemberIds)
          : current.orderPermissionManageMemberIds,
      orderPermissionCancelMemberIds:
        body.orderPermissionCancelMemberIds !== undefined
          ? normalizeRoleIdList(body.orderPermissionCancelMemberIds)
          : current.orderPermissionCancelMemberIds,
      jobTrackingViewOnlyDiscordIds:
        body.jobTrackingViewOnlyDiscordIds !== undefined
          ? normalizeRoleIdList(body.jobTrackingViewOnlyDiscordIds)
          : current.jobTrackingViewOnlyDiscordIds,

      // keep members filters owned by /api/members/settings
      membersDisplayRoleIds: current.membersDisplayRoleIds,
      membersExcludeRoleIds: current.membersExcludeRoleIds,
      subCrews:
        incomingSubCrews === null
          ? current.subCrews
          : preserveExistingSubCrews
            ? current.subCrews
            : incomingSubCrews,
    };

    writeSettings(next);
    return res.status(200).json(
      toClientPayload(
        next,
        hasOwnerAccess(next, actorDiscordId),
        resolveViewerCrewContext({
          ownerDiscordId: next.ownerDiscordId,
          coOwnerDiscordIds: next.coOwnerDiscordIds,
          discordId: actorDiscordId,
          outlineColor: next.outlineColor,
          subCrews: next.subCrews,
          isMainGuildMember: isMainGuildMember(actorDiscordId),
          hasJobTrackingViewOnlyAccess: hasJobTrackingViewOnlyAccess(next, actorDiscordId),
        }),
        actorDiscordId
      )
    );
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({error: 'Method not allowed'});
}
