import {hasOwnerAccess} from '../owner-access';
import {readJsonFileCached} from './json-cache';
import {getRuntimeDataPath} from './runtime-data';
import {weekEndingSundayMelbourne} from '../time/melbourne';

const WEEKLYS_MEMBERS_PATH = getRuntimeDataPath('weeklys.json');

export type WeeklysMembersStore = {
  activeMemberIds: string[];
  weeks: Record<string, {weekEnding: string; memberIds: string[]}>;
};

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

export function readWeeklysMembersStore(weeklysMembersPath = WEEKLYS_MEMBERS_PATH): WeeklysMembersStore {
  const j = readJsonFileCached<any>(weeklysMembersPath, () => ({}));
  const activeMemberIds = normalizeMemberIdList(j?.activeMemberIds);
  const weeksRaw = j?.weeks && typeof j.weeks === 'object' ? j.weeks : {};
  const weeks: Record<string, {weekEnding: string; memberIds: string[]}> = {};
  for (const [k, v] of Object.entries<any>(weeksRaw)) {
    const weekEnding = String(k || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) continue;
    weeks[weekEnding] = {weekEnding, memberIds: normalizeMemberIdList(v?.memberIds)};
  }
  return {activeMemberIds, weeks};
}

export function resolveWeeklysMembersForWeek(store: WeeklysMembersStore, weekEnding: string): string[] {
  const exact = store.weeks[weekEnding];
  if (exact) return normalizeMemberIdList(exact.memberIds);
  const keys = Object.keys(store.weeks).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k <= weekEnding).sort();
  if (keys.length > 0) {
    const last = keys[keys.length - 1];
    return normalizeMemberIdList(store.weeks[last]?.memberIds);
  }
  return normalizeMemberIdList(store.activeMemberIds);
}

export function hasWeeklysTrackerAccess(settings: any, discordId: any, weeklysMembersPath = WEEKLYS_MEMBERS_PATH, weekEnding = '') {
  const actorId = String(discordId || '').trim();
  if (!actorId) return false;
  if (hasOwnerAccess(settings, actorId)) return true;
  const targetWeek = /^\d{4}-\d{2}-\d{2}$/.test(String(weekEnding || '').trim())
    ? String(weekEnding).trim()
    : weekEndingSundayMelbourne(new Date());
  const store = readWeeklysMembersStore(weeklysMembersPath);
  return resolveWeeklysMembersForWeek(store, targetWeek).includes(actorId);
}
