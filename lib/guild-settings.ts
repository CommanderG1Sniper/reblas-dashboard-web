import {useCallback, useEffect, useState} from 'react';
import {normalizeSubCrews, type DashboardAccessMode, type SubCrew, type ViewerRole} from './sub-crews';
import {normalizeDiscordIdList} from './owner-access';
import {
  buildOwnerPreviewHeaders,
  normalizeOwnerPreviewMemberId,
  OWNER_PREVIEW_EVENT,
  OWNER_PREVIEW_MEMBER_STORAGE_KEY,
  OWNER_PREVIEW_STORAGE_KEY,
} from './owner-preview';

export type ButtonStyle = { color: string };
export type ReactionRole = {
  id: string;
  emoji: string;
  label: string;
  roleId: string;
  description: string;
};

export type GuildSettings = {
  ownerDiscordId: string;
  coOwnerDiscordIds: string[];

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
  buttonStyles: ButtonStyle[]; // 4 styles, colors-only
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
  jobTrackingViewOnlyAccess: boolean;
  dashboardAccessMode: DashboardAccessMode;
  weeklysTrackerAccess: boolean;

  membersDisplayRoleIds: string[];
  membersExcludeRoleIds: string[];
  subCrews: SubCrew[];
  viewerRole: ViewerRole;
  viewerSubCrewId: string;
  viewerSubCrewName: string;
  viewerOutlineColor: string;
};

const DEFAULT_BTN = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b'];

const DEFAULTS: GuildSettings = {
  ownerDiscordId: '',
  coOwnerDiscordIds: [],

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
  buttonStyles: DEFAULT_BTN.map((c) => ({color: c})),
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
  jobTrackingViewOnlyAccess: false,
  dashboardAccessMode: 'none',
  weeklysTrackerAccess: false,

  membersDisplayRoleIds: [],
  membersExcludeRoleIds: [],
  subCrews: [],
  viewerRole: 'main',
  viewerSubCrewId: '',
  viewerSubCrewName: '',
  viewerOutlineColor: '#ffffff14',
};

function isHexColor(v: string) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}

function normalizeButtonStyles(raw: any): ButtonStyle[] {
  const out: ButtonStyle[] = [];
  for (let i = 0; i < 4; i++) {
    const it = Array.isArray(raw) ? raw[i] : undefined;
    let c = '';
    if (typeof it === 'string') c = it.trim();
    else if (it && typeof it === 'object') c = String((it as any).color || '').trim();
    out.push({color: isHexColor(c) ? c : DEFAULT_BTN[i]});
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

function normalizeDiscordId(raw: any): string {
  const value = String(raw || '').trim();
  return /^\d{6,25}$/.test(value) ? value : '';
}

function normalizeTwitchLogin(raw: any): string {
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

function normalizeRate(raw: any): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 25;
  return Math.max(0, Math.min(100, n));
}

function normalizePercent(raw: any, fallback: number, min = 1, max = 100): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

type Store = {
  settings: GuildSettings;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string;
  loaded: boolean;
};

let store: Store = {
  settings: DEFAULTS,
  loading: false,
  saving: false,
  dirty: false,
  error: '',
  loaded: false,
};

const listeners = new Set<() => void>();
let autosaveTimer: any = null;

function notify() {
  listeners.forEach((fn) => fn());
}

function getSnapshot() {
  return store;
}

async function apiGetSettings(): Promise<GuildSettings> {
  const previewEnabled =
    typeof window !== 'undefined' && window.localStorage.getItem(OWNER_PREVIEW_STORAGE_KEY) === '1';
  const previewMemberId =
    typeof window !== 'undefined' ? normalizeOwnerPreviewMemberId(window.localStorage.getItem(OWNER_PREVIEW_MEMBER_STORAGE_KEY)) : '';
  const res = await fetch('/api/settings', {
    method: 'GET',
    headers: buildOwnerPreviewHeaders(previewEnabled, previewMemberId),
  });
  if (!res.ok) throw new Error(`GET /api/settings failed (${res.status})`);
  const j = await res.json();

  const outlineRaw = typeof j.outlineColor === 'string' ? j.outlineColor.trim() : '';
  const outlineColor = isHexColor(outlineRaw) ? outlineRaw : DEFAULTS.outlineColor;
  const memberOfMonthGlowColor = isHexColor(String(j.memberOfMonthGlowColor || '').trim())
    ? String(j.memberOfMonthGlowColor).trim()
    : DEFAULTS.memberOfMonthGlowColor;
  const memberOfMonthAvatarRingColor = isHexColor(String(j.memberOfMonthAvatarRingColor || '').trim())
    ? String(j.memberOfMonthAvatarRingColor).trim()
    : DEFAULTS.memberOfMonthAvatarRingColor;
  const memberOfMonthSparkleColor = isHexColor(String(j.memberOfMonthSparkleColor || '').trim())
    ? String(j.memberOfMonthSparkleColor).trim()
    : DEFAULTS.memberOfMonthSparkleColor;
  const memberOfMonthTextColor = isHexColor(String(j.memberOfMonthTextColor || '').trim())
    ? String(j.memberOfMonthTextColor).trim()
    : DEFAULTS.memberOfMonthTextColor;

  return {
    ...DEFAULTS,
    ...j,
    ownerDiscordId: typeof j.ownerDiscordId === 'string' ? j.ownerDiscordId : '',
    coOwnerDiscordIds: normalizeDiscordIdList(j.coOwnerDiscordIds),
    subGuildId: typeof j.subGuildId === 'string' ? j.subGuildId : '',
    defaultWashRatePct: normalizeRate(j.defaultWashRatePct),
    mainCrewDirtyResetDate:
      typeof j.mainCrewDirtyResetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.mainCrewDirtyResetDate)
        ? j.mainCrewDirtyResetDate
        : '',
    miningDailyPriceStartDate:
      typeof j.miningDailyPriceStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.miningDailyPriceStartDate)
        ? j.miningDailyPriceStartDate
        : '',
    mainCrewWashLogChannelId: typeof j.mainCrewWashLogChannelId === 'string' ? j.mainCrewWashLogChannelId : '',
    mainCrewWashLogMentionRoleIds: normalizeRoleIdList(j.mainCrewWashLogMentionRoleIds),
    mainCrewOrderUpdatesChannelId:
      typeof j.mainCrewOrderUpdatesChannelId === 'string' ? j.mainCrewOrderUpdatesChannelId : '',
    mainCrewOrderUpdatesMentionRoleIds: normalizeRoleIdList(j.mainCrewOrderUpdatesMentionRoleIds),
    welcomeBotMainEnabled:
      j.welcomeBotMainEnabled !== undefined ? !!j.welcomeBotMainEnabled : DEFAULTS.welcomeBotMainEnabled,
    welcomeBotMainTempCategoryId: normalizeDiscordId(j.welcomeBotMainTempCategoryId),
    welcomeBotMainRoleRequestChannelId: normalizeDiscordId(j.welcomeBotMainRoleRequestChannelId),
    welcomeBotMainRequestTagRoleIds: normalizeRoleIdList(j.welcomeBotMainRequestTagRoleIds),
    welcomeBotMainBaseRoleIds:
      j.welcomeBotMainBaseRoleIds !== undefined
        ? normalizeRoleIdList(j.welcomeBotMainBaseRoleIds)
        : normalizeRoleIdList([j.welcomeBotMainBaseRoleId]),
    welcomeBotSubEnabled:
      j.welcomeBotSubEnabled !== undefined ? !!j.welcomeBotSubEnabled : DEFAULTS.welcomeBotSubEnabled,
    welcomeBotSubTempCategoryId: normalizeDiscordId(j.welcomeBotSubTempCategoryId),
    welcomeBotSubRoleRequestChannelId: normalizeDiscordId(j.welcomeBotSubRoleRequestChannelId),
    welcomeBotSubRequestTagRoleIds: normalizeRoleIdList(j.welcomeBotSubRequestTagRoleIds),
    welcomeBotSubBaseRoleIds:
      j.welcomeBotSubBaseRoleIds !== undefined
        ? normalizeRoleIdList(j.welcomeBotSubBaseRoleIds)
        : normalizeRoleIdList([j.welcomeBotSubBaseRoleId]),
    twitchNotificationsEnabled:
      j.twitchNotificationsEnabled !== undefined ? !!j.twitchNotificationsEnabled : DEFAULTS.twitchNotificationsEnabled,
    twitchClientId: typeof j.twitchClientId === 'string' ? j.twitchClientId.trim() : '',
    twitchClientSecret: typeof j.twitchClientSecret === 'string' ? j.twitchClientSecret.trim() : '',
    twitchNotificationChannelId: normalizeDiscordId(j.twitchNotificationChannelId),
    twitchNotificationMentionRoleId: normalizeDiscordId(j.twitchNotificationMentionRoleId),
    twitchStreamerLogins: normalizeTwitchLoginList(j.twitchStreamerLogins),
    miningDiscordGuildId: normalizeDiscordId(j.miningDiscordGuildId),
    miningDiscordClientId: normalizeDiscordId(j.miningDiscordClientId),
    miningBotToken: typeof j.miningBotToken === 'string' ? j.miningBotToken.trim() : '',
    miningPriceSubmissionChannelId: normalizeDiscordId(j.miningPriceSubmissionChannelId),
    miningTradingTipChannelId: normalizeDiscordId(j.miningTradingTipChannelId),
    miningMarketShiftAlertChannelId: normalizeDiscordId(j.miningMarketShiftAlertChannelId),
    miningMarketShiftAlertDeviationPct: normalizePercent(j.miningMarketShiftAlertDeviationPct, DEFAULTS.miningMarketShiftAlertDeviationPct),
    miningPricePanelInstructions: String(j.miningPricePanelInstructions || DEFAULTS.miningPricePanelInstructions).trim().slice(0, 1200),
    miningPriceSubmitRoleId: normalizeDiscordId(j.miningPriceSubmitRoleId),
    miningPriceApprovalRoleId: normalizeDiscordId(j.miningPriceApprovalRoleId),
    reactionBotEnabled:
      j.reactionBotEnabled !== undefined ? !!j.reactionBotEnabled : DEFAULTS.reactionBotEnabled,
    reactionBotChannelId: normalizeDiscordId(j.reactionBotChannelId),
    reactionBotMessageId: normalizeDiscordId(j.reactionBotMessageId),
    reactionBotChannelName: String(j.reactionBotChannelName || DEFAULTS.reactionBotChannelName).trim().slice(0, 80),
    reactionBotEmbedTitle: String(j.reactionBotEmbedTitle || DEFAULTS.reactionBotEmbedTitle).trim().slice(0, 256),
    reactionBotEmbedDescription: String(j.reactionBotEmbedDescription || DEFAULTS.reactionBotEmbedDescription)
      .trim()
      .slice(0, 1200),
    reactionBotEmbedColor: isHexColor(String(j.reactionBotEmbedColor || '').trim())
      ? String(j.reactionBotEmbedColor).trim()
      : DEFAULTS.reactionBotEmbedColor,
    reactionRoles: normalizeReactionRoles(j.reactionRoles),
    outlineColor,
    buttonStyles: normalizeButtonStyles(j.buttonStyles),
    memberOfMonthGlowColor,
    memberOfMonthAvatarRingColor,
    memberOfMonthSparkleColor,
    memberOfMonthTextColor,
    washPermissionAdd: j.washPermissionAdd !== undefined ? !!j.washPermissionAdd : DEFAULTS.washPermissionAdd,
    washPermissionEdit: j.washPermissionEdit !== undefined ? !!j.washPermissionEdit : DEFAULTS.washPermissionEdit,
    washPermissionDelete:
      j.washPermissionDelete !== undefined ? !!j.washPermissionDelete : DEFAULTS.washPermissionDelete,
    washPermissionMarkPending:
      j.washPermissionMarkPending !== undefined ? !!j.washPermissionMarkPending : DEFAULTS.washPermissionMarkPending,
    washPermissionMarkPaid:
      j.washPermissionMarkPaid !== undefined ? !!j.washPermissionMarkPaid : DEFAULTS.washPermissionMarkPaid,
    washPermissionAddMemberIds: normalizeRoleIdList(j.washPermissionAddMemberIds),
    washPermissionEditMemberIds: normalizeRoleIdList(j.washPermissionEditMemberIds),
    washPermissionDeleteMemberIds: normalizeRoleIdList(j.washPermissionDeleteMemberIds),
    washPermissionMarkPendingMemberIds: normalizeRoleIdList(j.washPermissionMarkPendingMemberIds),
    washPermissionMarkPaidMemberIds: normalizeRoleIdList(j.washPermissionMarkPaidMemberIds),
    orderPermissionViewMemberIds: normalizeRoleIdList(j.orderPermissionViewMemberIds),
    orderPermissionPlaceMemberIds: normalizeRoleIdList(j.orderPermissionPlaceMemberIds),
    orderPermissionManageMemberIds: normalizeRoleIdList(j.orderPermissionManageMemberIds),
    orderPermissionCancelMemberIds: normalizeRoleIdList(j.orderPermissionCancelMemberIds),
    jobTrackingViewOnlyDiscordIds: normalizeDiscordIdList(j.jobTrackingViewOnlyDiscordIds),
    jobTrackingViewOnlyAccess: !!j.jobTrackingViewOnlyAccess,
    weeklysTrackerAccess: !!j.weeklysTrackerAccess,
    dashboardAccessMode:
      j.dashboardAccessMode === 'owner' ||
      j.dashboardAccessMode === 'main' ||
      j.dashboardAccessMode === 'subcrew' ||
      j.dashboardAccessMode === 'job_tracking_only'
        ? j.dashboardAccessMode
        : 'none',
    membersDisplayRoleIds: normalizeRoleIdList(j.membersDisplayRoleIds),
    membersExcludeRoleIds: normalizeRoleIdList(j.membersExcludeRoleIds),
    subCrews: normalizeSubCrews(j.subCrews, outlineColor),
    viewerRole:
      j.viewerRole === 'owner' || j.viewerRole === 'subcrew' || j.viewerRole === 'external' ? j.viewerRole : 'main',
    viewerSubCrewId: typeof j.viewerSubCrewId === 'string' ? j.viewerSubCrewId : '',
    viewerSubCrewName: typeof j.viewerSubCrewName === 'string' ? j.viewerSubCrewName : '',
    viewerOutlineColor: isHexColor(String(j.viewerOutlineColor || '').trim())
      ? String(j.viewerOutlineColor).trim()
      : outlineColor,
  };
}

async function apiSaveSettings(next: GuildSettings): Promise<GuildSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(next),
  });

  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `PUT /api/settings failed (${res.status})`);

  const outlineRaw = typeof j.outlineColor === 'string' ? j.outlineColor.trim() : '';
  const outlineColor = isHexColor(outlineRaw) ? outlineRaw : DEFAULTS.outlineColor;
  const memberOfMonthGlowColor = isHexColor(String(j.memberOfMonthGlowColor || '').trim())
    ? String(j.memberOfMonthGlowColor).trim()
    : DEFAULTS.memberOfMonthGlowColor;
  const memberOfMonthAvatarRingColor = isHexColor(String(j.memberOfMonthAvatarRingColor || '').trim())
    ? String(j.memberOfMonthAvatarRingColor).trim()
    : DEFAULTS.memberOfMonthAvatarRingColor;
  const memberOfMonthSparkleColor = isHexColor(String(j.memberOfMonthSparkleColor || '').trim())
    ? String(j.memberOfMonthSparkleColor).trim()
    : DEFAULTS.memberOfMonthSparkleColor;
  const memberOfMonthTextColor = isHexColor(String(j.memberOfMonthTextColor || '').trim())
    ? String(j.memberOfMonthTextColor).trim()
    : DEFAULTS.memberOfMonthTextColor;

  return {
    ...DEFAULTS,
    ...j,
    ownerDiscordId: typeof j.ownerDiscordId === 'string' ? j.ownerDiscordId : '',
    coOwnerDiscordIds: normalizeDiscordIdList(j.coOwnerDiscordIds),
    subGuildId: typeof j.subGuildId === 'string' ? j.subGuildId : '',
    defaultWashRatePct: normalizeRate(j.defaultWashRatePct),
    mainCrewDirtyResetDate:
      typeof j.mainCrewDirtyResetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.mainCrewDirtyResetDate)
        ? j.mainCrewDirtyResetDate
        : '',
    miningDailyPriceStartDate:
      typeof j.miningDailyPriceStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.miningDailyPriceStartDate)
        ? j.miningDailyPriceStartDate
        : '',
    mainCrewWashLogChannelId: typeof j.mainCrewWashLogChannelId === 'string' ? j.mainCrewWashLogChannelId : '',
    mainCrewWashLogMentionRoleIds: normalizeRoleIdList(j.mainCrewWashLogMentionRoleIds),
    mainCrewOrderUpdatesChannelId:
      typeof j.mainCrewOrderUpdatesChannelId === 'string' ? j.mainCrewOrderUpdatesChannelId : '',
    mainCrewOrderUpdatesMentionRoleIds: normalizeRoleIdList(j.mainCrewOrderUpdatesMentionRoleIds),
    welcomeBotMainEnabled:
      j.welcomeBotMainEnabled !== undefined ? !!j.welcomeBotMainEnabled : DEFAULTS.welcomeBotMainEnabled,
    welcomeBotMainTempCategoryId: normalizeDiscordId(j.welcomeBotMainTempCategoryId),
    welcomeBotMainRoleRequestChannelId: normalizeDiscordId(j.welcomeBotMainRoleRequestChannelId),
    welcomeBotMainRequestTagRoleIds: normalizeRoleIdList(j.welcomeBotMainRequestTagRoleIds),
    welcomeBotMainBaseRoleIds:
      j.welcomeBotMainBaseRoleIds !== undefined
        ? normalizeRoleIdList(j.welcomeBotMainBaseRoleIds)
        : normalizeRoleIdList([j.welcomeBotMainBaseRoleId]),
    welcomeBotSubEnabled:
      j.welcomeBotSubEnabled !== undefined ? !!j.welcomeBotSubEnabled : DEFAULTS.welcomeBotSubEnabled,
    welcomeBotSubTempCategoryId: normalizeDiscordId(j.welcomeBotSubTempCategoryId),
    welcomeBotSubRoleRequestChannelId: normalizeDiscordId(j.welcomeBotSubRoleRequestChannelId),
    welcomeBotSubRequestTagRoleIds: normalizeRoleIdList(j.welcomeBotSubRequestTagRoleIds),
    welcomeBotSubBaseRoleIds:
      j.welcomeBotSubBaseRoleIds !== undefined
        ? normalizeRoleIdList(j.welcomeBotSubBaseRoleIds)
        : normalizeRoleIdList([j.welcomeBotSubBaseRoleId]),
    twitchNotificationsEnabled:
      j.twitchNotificationsEnabled !== undefined ? !!j.twitchNotificationsEnabled : DEFAULTS.twitchNotificationsEnabled,
    twitchClientId: typeof j.twitchClientId === 'string' ? j.twitchClientId.trim() : '',
    twitchClientSecret: typeof j.twitchClientSecret === 'string' ? j.twitchClientSecret.trim() : '',
    twitchNotificationChannelId: normalizeDiscordId(j.twitchNotificationChannelId),
    twitchNotificationMentionRoleId: normalizeDiscordId(j.twitchNotificationMentionRoleId),
    twitchStreamerLogins: normalizeTwitchLoginList(j.twitchStreamerLogins),
    miningDiscordGuildId: normalizeDiscordId(j.miningDiscordGuildId),
    miningDiscordClientId: normalizeDiscordId(j.miningDiscordClientId),
    miningBotToken: typeof j.miningBotToken === 'string' ? j.miningBotToken.trim() : '',
    miningPriceSubmissionChannelId: normalizeDiscordId(j.miningPriceSubmissionChannelId),
    miningTradingTipChannelId: normalizeDiscordId(j.miningTradingTipChannelId),
    miningMarketShiftAlertChannelId: normalizeDiscordId(j.miningMarketShiftAlertChannelId),
    miningMarketShiftAlertDeviationPct: normalizePercent(j.miningMarketShiftAlertDeviationPct, DEFAULTS.miningMarketShiftAlertDeviationPct),
    miningPricePanelInstructions: String(j.miningPricePanelInstructions || DEFAULTS.miningPricePanelInstructions).trim().slice(0, 1200),
    miningPriceSubmitRoleId: normalizeDiscordId(j.miningPriceSubmitRoleId),
    miningPriceApprovalRoleId: normalizeDiscordId(j.miningPriceApprovalRoleId),
    reactionBotEnabled:
      j.reactionBotEnabled !== undefined ? !!j.reactionBotEnabled : DEFAULTS.reactionBotEnabled,
    reactionBotChannelId: normalizeDiscordId(j.reactionBotChannelId),
    reactionBotMessageId: normalizeDiscordId(j.reactionBotMessageId),
    reactionBotChannelName: String(j.reactionBotChannelName || DEFAULTS.reactionBotChannelName).trim().slice(0, 80),
    reactionBotEmbedTitle: String(j.reactionBotEmbedTitle || DEFAULTS.reactionBotEmbedTitle).trim().slice(0, 256),
    reactionBotEmbedDescription: String(j.reactionBotEmbedDescription || DEFAULTS.reactionBotEmbedDescription)
      .trim()
      .slice(0, 1200),
    reactionBotEmbedColor: isHexColor(String(j.reactionBotEmbedColor || '').trim())
      ? String(j.reactionBotEmbedColor).trim()
      : DEFAULTS.reactionBotEmbedColor,
    reactionRoles: normalizeReactionRoles(j.reactionRoles),
    outlineColor,
    buttonStyles: normalizeButtonStyles(j.buttonStyles),
    memberOfMonthGlowColor,
    memberOfMonthAvatarRingColor,
    memberOfMonthSparkleColor,
    memberOfMonthTextColor,
    washPermissionAdd: j.washPermissionAdd !== undefined ? !!j.washPermissionAdd : DEFAULTS.washPermissionAdd,
    washPermissionEdit: j.washPermissionEdit !== undefined ? !!j.washPermissionEdit : DEFAULTS.washPermissionEdit,
    washPermissionDelete:
      j.washPermissionDelete !== undefined ? !!j.washPermissionDelete : DEFAULTS.washPermissionDelete,
    washPermissionMarkPending:
      j.washPermissionMarkPending !== undefined ? !!j.washPermissionMarkPending : DEFAULTS.washPermissionMarkPending,
    washPermissionMarkPaid:
      j.washPermissionMarkPaid !== undefined ? !!j.washPermissionMarkPaid : DEFAULTS.washPermissionMarkPaid,
    washPermissionAddMemberIds: normalizeRoleIdList(j.washPermissionAddMemberIds),
    washPermissionEditMemberIds: normalizeRoleIdList(j.washPermissionEditMemberIds),
    washPermissionDeleteMemberIds: normalizeRoleIdList(j.washPermissionDeleteMemberIds),
    washPermissionMarkPendingMemberIds: normalizeRoleIdList(j.washPermissionMarkPendingMemberIds),
    washPermissionMarkPaidMemberIds: normalizeRoleIdList(j.washPermissionMarkPaidMemberIds),
    orderPermissionViewMemberIds: normalizeRoleIdList(j.orderPermissionViewMemberIds),
    orderPermissionPlaceMemberIds: normalizeRoleIdList(j.orderPermissionPlaceMemberIds),
    orderPermissionManageMemberIds: normalizeRoleIdList(j.orderPermissionManageMemberIds),
    orderPermissionCancelMemberIds: normalizeRoleIdList(j.orderPermissionCancelMemberIds),
    jobTrackingViewOnlyDiscordIds: normalizeDiscordIdList(j.jobTrackingViewOnlyDiscordIds),
    jobTrackingViewOnlyAccess: !!j.jobTrackingViewOnlyAccess,
    weeklysTrackerAccess: !!j.weeklysTrackerAccess,
    dashboardAccessMode:
      j.dashboardAccessMode === 'owner' ||
      j.dashboardAccessMode === 'main' ||
      j.dashboardAccessMode === 'subcrew' ||
      j.dashboardAccessMode === 'job_tracking_only'
        ? j.dashboardAccessMode
        : 'none',
    membersDisplayRoleIds: normalizeRoleIdList(j.membersDisplayRoleIds),
    membersExcludeRoleIds: normalizeRoleIdList(j.membersExcludeRoleIds),
    subCrews: normalizeSubCrews(j.subCrews, outlineColor),
    viewerRole:
      j.viewerRole === 'owner' || j.viewerRole === 'subcrew' || j.viewerRole === 'external' ? j.viewerRole : 'main',
    viewerSubCrewId: typeof j.viewerSubCrewId === 'string' ? j.viewerSubCrewId : '',
    viewerSubCrewName: typeof j.viewerSubCrewName === 'string' ? j.viewerSubCrewName : '',
    viewerOutlineColor: isHexColor(String(j.viewerOutlineColor || '').trim())
      ? String(j.viewerOutlineColor).trim()
      : outlineColor,
  };
}

async function loadFromServer() {
  if (store.loading) return;

  store = {...store, loading: true, error: ''};
  notify();

  try {
    const s = await apiGetSettings();

    // If the user has local unsaved edits (dirty), don't clobber them.
    // But DO sync server-managed members filters so Members page always follows them.
    if (store.dirty) {
      store = {
        ...store,
        settings: {
          ...store.settings,
          membersDisplayRoleIds: s.membersDisplayRoleIds,
          membersExcludeRoleIds: s.membersExcludeRoleIds,
          coOwnerDiscordIds: s.coOwnerDiscordIds,
          jobTrackingViewOnlyDiscordIds: s.jobTrackingViewOnlyDiscordIds,
          jobTrackingViewOnlyAccess: s.jobTrackingViewOnlyAccess,
          weeklysTrackerAccess: s.weeklysTrackerAccess,
          dashboardAccessMode: s.dashboardAccessMode,
          viewerRole: s.viewerRole,
          viewerSubCrewId: s.viewerSubCrewId,
          viewerSubCrewName: s.viewerSubCrewName,
          viewerOutlineColor: s.viewerOutlineColor,
        },
        loaded: true,
        loading: false,
        error: '',
      };
    } else {
      store = {...store, settings: s, loaded: true, loading: false, dirty: false, error: ''};
    }
  } catch (e: any) {
    store = {...store, loading: false, error: e?.message || 'Failed to load settings'};
  }

  notify();
}

async function saveNowInternal(): Promise<boolean> {
  if (store.saving) return false;

  store = {...store, saving: true, error: ''};
  notify();

  try {
    const saved = await apiSaveSettings(store.settings);
    store = {...store, settings: saved, saving: false, dirty: false, error: '', loaded: true};
    notify();
    return true;
  } catch (e: any) {
    store = {...store, saving: false, error: e?.message || 'Failed to save settings', dirty: true};
    notify();
    return false;
  }
}

function scheduleAutosave(delayMs = 800) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    if (store.dirty) void saveNowInternal();
  }, delayMs);
}

function updateDraftInternal(patch: Partial<GuildSettings>) {
  const next: GuildSettings = {...store.settings, ...patch};

  if (patch.outlineColor !== undefined) {
    const v = String(patch.outlineColor || '').trim();
    if (!isHexColor(v)) {
      store = {...store, settings: next, dirty: true, error: 'Outline color must be hex (e.g. #ffffff14).'};
      notify();
      return;
    }
  }

  if (patch.buttonStyles !== undefined) {
    next.buttonStyles = normalizeButtonStyles(patch.buttonStyles as any);
  }
  if (patch.defaultWashRatePct !== undefined) {
    next.defaultWashRatePct = normalizeRate(patch.defaultWashRatePct);
  }
  if (patch.memberOfMonthGlowColor !== undefined) {
    const v = String(patch.memberOfMonthGlowColor || '').trim();
    if (!isHexColor(v)) {
      store = {...store, settings: next, dirty: true, error: 'Member of the month glow color must be hex.'};
      notify();
      return;
    }
  }
  if (patch.memberOfMonthAvatarRingColor !== undefined) {
    const v = String(patch.memberOfMonthAvatarRingColor || '').trim();
    if (!isHexColor(v)) {
      store = {...store, settings: next, dirty: true, error: 'Member of the month avatar ring color must be hex.'};
      notify();
      return;
    }
  }
  if (patch.memberOfMonthSparkleColor !== undefined) {
    const v = String(patch.memberOfMonthSparkleColor || '').trim();
    if (!isHexColor(v)) {
      store = {...store, settings: next, dirty: true, error: 'Member of the month sparkle color must be hex.'};
      notify();
      return;
    }
  }
  if (patch.memberOfMonthTextColor !== undefined) {
    const v = String(patch.memberOfMonthTextColor || '').trim();
    if (!isHexColor(v)) {
      store = {...store, settings: next, dirty: true, error: 'Member of the month text color must be hex.'};
      notify();
      return;
    }
  }

  if (patch.membersDisplayRoleIds !== undefined) {
    next.membersDisplayRoleIds = normalizeRoleIdList(patch.membersDisplayRoleIds as any);
  }
  if (patch.mainCrewDirtyResetDate !== undefined) {
    const value = String(patch.mainCrewDirtyResetDate || '').trim();
    next.mainCrewDirtyResetDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  }
  if (patch.miningDailyPriceStartDate !== undefined) {
    const value = String(patch.miningDailyPriceStartDate || '').trim();
    next.miningDailyPriceStartDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  }
  if (patch.mainCrewWashLogChannelId !== undefined) {
    next.mainCrewWashLogChannelId = String(patch.mainCrewWashLogChannelId || '').trim().replace(/[^0-9]/g, '');
  }
  if (patch.mainCrewWashLogMentionRoleIds !== undefined) {
    next.mainCrewWashLogMentionRoleIds = normalizeRoleIdList(patch.mainCrewWashLogMentionRoleIds as any);
  }
  if (patch.mainCrewOrderUpdatesChannelId !== undefined) {
    next.mainCrewOrderUpdatesChannelId = String(patch.mainCrewOrderUpdatesChannelId || '')
      .trim()
      .replace(/[^0-9]/g, '');
  }
  if (patch.mainCrewOrderUpdatesMentionRoleIds !== undefined) {
    next.mainCrewOrderUpdatesMentionRoleIds = normalizeRoleIdList(patch.mainCrewOrderUpdatesMentionRoleIds as any);
  }
  if (patch.welcomeBotMainTempCategoryId !== undefined) {
    next.welcomeBotMainTempCategoryId = normalizeDiscordId(patch.welcomeBotMainTempCategoryId);
  }
  if (patch.welcomeBotMainRoleRequestChannelId !== undefined) {
    next.welcomeBotMainRoleRequestChannelId = normalizeDiscordId(patch.welcomeBotMainRoleRequestChannelId);
  }
  if (patch.welcomeBotMainRequestTagRoleIds !== undefined) {
    next.welcomeBotMainRequestTagRoleIds = normalizeRoleIdList(patch.welcomeBotMainRequestTagRoleIds as any);
  }
  if ((patch as any).welcomeBotMainBaseRoleIds !== undefined) {
    next.welcomeBotMainBaseRoleIds = normalizeRoleIdList((patch as any).welcomeBotMainBaseRoleIds);
  } else if ((patch as any).welcomeBotMainBaseRoleId !== undefined) {
    next.welcomeBotMainBaseRoleIds = normalizeRoleIdList([(patch as any).welcomeBotMainBaseRoleId]);
  }
  if (patch.welcomeBotSubTempCategoryId !== undefined) {
    next.welcomeBotSubTempCategoryId = normalizeDiscordId(patch.welcomeBotSubTempCategoryId);
  }
  if (patch.welcomeBotSubRoleRequestChannelId !== undefined) {
    next.welcomeBotSubRoleRequestChannelId = normalizeDiscordId(patch.welcomeBotSubRoleRequestChannelId);
  }
  if (patch.welcomeBotSubRequestTagRoleIds !== undefined) {
    next.welcomeBotSubRequestTagRoleIds = normalizeRoleIdList(patch.welcomeBotSubRequestTagRoleIds as any);
  }
  if ((patch as any).welcomeBotSubBaseRoleIds !== undefined) {
    next.welcomeBotSubBaseRoleIds = normalizeRoleIdList((patch as any).welcomeBotSubBaseRoleIds);
  } else if ((patch as any).welcomeBotSubBaseRoleId !== undefined) {
    next.welcomeBotSubBaseRoleIds = normalizeRoleIdList([(patch as any).welcomeBotSubBaseRoleId]);
  }
  if (patch.twitchNotificationsEnabled !== undefined) {
    next.twitchNotificationsEnabled = !!patch.twitchNotificationsEnabled;
  }
  if (patch.twitchClientId !== undefined) {
    next.twitchClientId = String(patch.twitchClientId || '').trim();
  }
  if (patch.twitchClientSecret !== undefined) {
    next.twitchClientSecret = String(patch.twitchClientSecret || '').trim();
  }
  if (patch.twitchNotificationChannelId !== undefined) {
    next.twitchNotificationChannelId = normalizeDiscordId(patch.twitchNotificationChannelId);
  }
  if (patch.twitchNotificationMentionRoleId !== undefined) {
    next.twitchNotificationMentionRoleId = normalizeDiscordId(patch.twitchNotificationMentionRoleId);
  }
  if (patch.twitchStreamerLogins !== undefined) {
    next.twitchStreamerLogins = normalizeTwitchLoginList(patch.twitchStreamerLogins as any);
  }
  if (patch.miningDiscordGuildId !== undefined) {
    next.miningDiscordGuildId = normalizeDiscordId(patch.miningDiscordGuildId);
  }
  if (patch.miningDiscordClientId !== undefined) {
    next.miningDiscordClientId = normalizeDiscordId(patch.miningDiscordClientId);
  }
  if (patch.miningBotToken !== undefined) {
    next.miningBotToken = String(patch.miningBotToken || '').trim();
  }
  if (patch.miningPriceSubmissionChannelId !== undefined) {
    next.miningPriceSubmissionChannelId = normalizeDiscordId(patch.miningPriceSubmissionChannelId);
  }
  if (patch.miningTradingTipChannelId !== undefined) {
    next.miningTradingTipChannelId = normalizeDiscordId(patch.miningTradingTipChannelId);
  }
  if (patch.miningMarketShiftAlertChannelId !== undefined) {
    next.miningMarketShiftAlertChannelId = normalizeDiscordId(patch.miningMarketShiftAlertChannelId);
  }
  if (patch.miningMarketShiftAlertDeviationPct !== undefined) {
    next.miningMarketShiftAlertDeviationPct = normalizePercent(
      patch.miningMarketShiftAlertDeviationPct,
      DEFAULTS.miningMarketShiftAlertDeviationPct
    );
  }
  if (patch.miningPricePanelInstructions !== undefined) {
    next.miningPricePanelInstructions = String(patch.miningPricePanelInstructions || '').trim().slice(0, 1200) || DEFAULTS.miningPricePanelInstructions;
  }
  if (patch.miningPriceSubmitRoleId !== undefined) {
    next.miningPriceSubmitRoleId = normalizeDiscordId(patch.miningPriceSubmitRoleId);
  }
  if (patch.miningPriceApprovalRoleId !== undefined) {
    next.miningPriceApprovalRoleId = normalizeDiscordId(patch.miningPriceApprovalRoleId);
  }
  if (patch.reactionBotEnabled !== undefined) {
    next.reactionBotEnabled = !!patch.reactionBotEnabled;
  }
  if (patch.reactionBotChannelId !== undefined) {
    next.reactionBotChannelId = normalizeDiscordId(patch.reactionBotChannelId);
  }
  if (patch.reactionBotMessageId !== undefined) {
    next.reactionBotMessageId = normalizeDiscordId(patch.reactionBotMessageId);
  }
  if (patch.reactionBotChannelName !== undefined) {
    next.reactionBotChannelName =
      String(patch.reactionBotChannelName || '').trim().slice(0, 80) || DEFAULTS.reactionBotChannelName;
  }
  if (patch.reactionBotEmbedTitle !== undefined) {
    next.reactionBotEmbedTitle =
      String(patch.reactionBotEmbedTitle || '').trim().slice(0, 256) || DEFAULTS.reactionBotEmbedTitle;
  }
  if (patch.reactionBotEmbedDescription !== undefined) {
    next.reactionBotEmbedDescription =
      String(patch.reactionBotEmbedDescription || '').trim().slice(0, 1200) || DEFAULTS.reactionBotEmbedDescription;
  }
  if (patch.reactionBotEmbedColor !== undefined) {
    const value = String(patch.reactionBotEmbedColor || '').trim();
    next.reactionBotEmbedColor = isHexColor(value) ? value : DEFAULTS.reactionBotEmbedColor;
  }
  if (patch.reactionRoles !== undefined) {
    next.reactionRoles = normalizeReactionRoles(patch.reactionRoles as any);
  }
  if (patch.coOwnerDiscordIds !== undefined) {
    next.coOwnerDiscordIds = normalizeDiscordIdList(patch.coOwnerDiscordIds as any);
  }

  if (patch.membersExcludeRoleIds !== undefined) {
    next.membersExcludeRoleIds = normalizeRoleIdList(patch.membersExcludeRoleIds as any);
  }
  if (patch.washPermissionAddMemberIds !== undefined) {
    next.washPermissionAddMemberIds = normalizeRoleIdList(patch.washPermissionAddMemberIds as any);
  }
  if (patch.washPermissionEditMemberIds !== undefined) {
    next.washPermissionEditMemberIds = normalizeRoleIdList(patch.washPermissionEditMemberIds as any);
  }
  if (patch.washPermissionDeleteMemberIds !== undefined) {
    next.washPermissionDeleteMemberIds = normalizeRoleIdList(patch.washPermissionDeleteMemberIds as any);
  }
  if (patch.washPermissionMarkPendingMemberIds !== undefined) {
    next.washPermissionMarkPendingMemberIds = normalizeRoleIdList(patch.washPermissionMarkPendingMemberIds as any);
  }
  if (patch.washPermissionMarkPaidMemberIds !== undefined) {
    next.washPermissionMarkPaidMemberIds = normalizeRoleIdList(patch.washPermissionMarkPaidMemberIds as any);
  }

  store = {...store, settings: next, dirty: true, error: ''};
  notify();
  scheduleAutosave();
}

export function useGuildSettings() {
  const [snap, setSnap] = useState<Store>(getSnapshot());

  useEffect(() => {
    const onChange = () => setSnap(getSnapshot());
    const onPreviewChange = () => {
      void loadFromServer();
    };
    listeners.add(onChange);
    if (typeof window !== 'undefined') window.addEventListener(OWNER_PREVIEW_EVENT, onPreviewChange);

    if (!store.loaded && !store.loading) void loadFromServer();

    return () => {
      listeners.delete(onChange);
      if (typeof window !== 'undefined') window.removeEventListener(OWNER_PREVIEW_EVENT, onPreviewChange);
    };
  }, []);

  const refresh = useCallback(async () => {
    await loadFromServer();
  }, []);

  const updateDraft = useCallback((patch: Partial<GuildSettings>) => {
    updateDraftInternal(patch);
  }, []);

  const saveNow = useCallback(async () => {
    return await saveNowInternal();
  }, []);

  return {
    settings: snap.settings,
    loading: snap.loading,
    saving: snap.saving,
    dirty: snap.dirty,
    error: snap.error,
    updateDraft,
    refresh,
    saveNow,
  };
}
