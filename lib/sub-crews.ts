import {hasOwnerAccess, normalizeDiscordIdList} from './owner-access';

export type SubCrew = {
  id: string;
  name: string;
  guildId: string;
  outlineColor: string;
  washLogChannelId: string;
  washLogMentionRoleIds: string[];
  orderUpdatesChannelId: string;
  orderUpdatesMentionRoleIds: string[];
  roleIds: string[];
  memberIds: string[];
};

export type ViewerRole = 'owner' | 'main' | 'subcrew' | 'external';
export type DashboardAccessMode = 'owner' | 'main' | 'subcrew' | 'job_tracking_only' | 'none';

export type ViewerCrewContext = {
  viewerRole: ViewerRole;
  viewerSubCrewId: string;
  viewerSubCrewName: string;
  viewerOutlineColor: string;
  dashboardAccessMode: DashboardAccessMode;
};

export function isHexColor(v: string) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
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

export function normalizeSubCrews(raw: any, fallbackOutlineColor: string): SubCrew[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const crews: SubCrew[] = [];

  for (const item of raw) {
    const id = String(item?.id || '').trim();
    const name = String(item?.name || '').trim();
    if (!id || !name || seen.has(id)) continue;
    const guildId = String(item?.guildId || '').trim();

    const outlineRaw = String(item?.outlineColor || '').trim();
    const outlineColor = isHexColor(outlineRaw) ? outlineRaw : fallbackOutlineColor;

    crews.push({
      id,
      name,
      guildId: /^\d{6,25}$/.test(guildId) ? guildId : '',
      outlineColor,
      washLogChannelId: /^\d{6,25}$/.test(String(item?.washLogChannelId || '').trim())
        ? String(item?.washLogChannelId || '').trim()
        : '',
      washLogMentionRoleIds: normalizeRoleIdList(item?.washLogMentionRoleIds),
      orderUpdatesChannelId: /^\d{6,25}$/.test(String(item?.orderUpdatesChannelId || '').trim())
        ? String(item?.orderUpdatesChannelId || '').trim()
        : '',
      orderUpdatesMentionRoleIds: normalizeRoleIdList(item?.orderUpdatesMentionRoleIds),
      roleIds: normalizeRoleIdList(item?.roleIds),
      memberIds: normalizeRoleIdList(item?.memberIds),
    });
    seen.add(id);
  }

  return crews;
}

export function findSubCrewForMember(subCrews: SubCrew[], discordId: string): SubCrew | null {
  const memberId = String(discordId || '').trim();
  if (!memberId) return null;
  for (const crew of subCrews) {
    if (crew.memberIds.includes(memberId)) return crew;
  }
  return null;
}

export function resolveViewerCrewContext(args: {
  ownerDiscordId: string;
  coOwnerDiscordIds?: string[];
  discordId: string;
  outlineColor: string;
  subCrews: SubCrew[];
  isMainGuildMember?: boolean;
  hasJobTrackingViewOnlyAccess?: boolean;
}): ViewerCrewContext {
  const ownerDiscordId = String(args.ownerDiscordId || '').trim();
  const coOwnerDiscordIds = normalizeDiscordIdList(args.coOwnerDiscordIds);
  const discordId = String(args.discordId || '').trim();
  const outlineColor = String(args.outlineColor || '').trim();
  const subCrew = findSubCrewForMember(args.subCrews || [], discordId);
  const isMainGuildMember = !!args.isMainGuildMember;
  const hasJobTrackingAccess = !!args.hasJobTrackingViewOnlyAccess;

  if (hasOwnerAccess({ownerDiscordId, coOwnerDiscordIds}, discordId)) {
    return {
      viewerRole: 'owner',
      viewerSubCrewId: '',
      viewerSubCrewName: '',
      viewerOutlineColor: outlineColor,
      dashboardAccessMode: 'owner',
    };
  }

  if (isMainGuildMember) {
    return {
      viewerRole: 'main',
      viewerSubCrewId: '',
      viewerSubCrewName: '',
      viewerOutlineColor: outlineColor,
      dashboardAccessMode: 'main',
    };
  }

  if (subCrew) {
    return {
      viewerRole: 'subcrew',
      viewerSubCrewId: subCrew.id,
      viewerSubCrewName: subCrew.name,
      viewerOutlineColor: subCrew.outlineColor || outlineColor,
      dashboardAccessMode: 'subcrew',
    };
  }

  if (hasJobTrackingAccess) {
    return {
      viewerRole: 'external',
      viewerSubCrewId: '',
      viewerSubCrewName: '',
      viewerOutlineColor: outlineColor,
      dashboardAccessMode: 'job_tracking_only',
    };
  }

  return {
    viewerRole: 'external',
    viewerSubCrewId: '',
    viewerSubCrewName: '',
    viewerOutlineColor: outlineColor,
    dashboardAccessMode: 'none',
  };
}

export function createSubCrewId(seed = '') {
  const clean = String(seed || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 8);
  return clean ? `${clean}-${suffix}` : `subcrew-${suffix}`;
}
