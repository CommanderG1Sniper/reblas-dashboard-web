export function normalizeDiscordIdList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const id = String(value || '').trim();
    if (/^\d{6,25}$/.test(id)) out.push(id);
  }
  return Array.from(new Set(out));
}

export function hasOwnerAccess(
  settings: {ownerDiscordId?: string; coOwnerDiscordIds?: string[] | null} | null | undefined,
  discordId: any
): boolean {
  const actorId = String(discordId || '').trim();
  if (!actorId) return false;
  const ownerId = String(settings?.ownerDiscordId || '').trim();
  if (ownerId && actorId === ownerId) return true;
  return normalizeDiscordIdList(settings?.coOwnerDiscordIds).includes(actorId);
}

export function hasJobTrackingViewOnlyAccess(
  settings: {jobTrackingViewOnlyDiscordIds?: string[] | null} | null | undefined,
  discordId: any
): boolean {
  const actorId = String(discordId || '').trim();
  if (!actorId) return false;
  return normalizeDiscordIdList(settings?.jobTrackingViewOnlyDiscordIds).includes(actorId);
}

export function hasJobTrackingReadAccess(
  settings:
    | {
        ownerDiscordId?: string;
        coOwnerDiscordIds?: string[] | null;
        jobTrackingViewOnlyDiscordIds?: string[] | null;
      }
    | null
    | undefined,
  discordId: any
): boolean {
  return hasOwnerAccess(settings, discordId) || hasJobTrackingViewOnlyAccess(settings, discordId);
}
