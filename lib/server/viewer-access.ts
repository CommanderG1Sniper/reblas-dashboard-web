import {hasJobTrackingViewOnlyAccess} from '../owner-access';
import {resolveViewerCrewContext, type ViewerCrewContext} from '../sub-crews';
import {readJsonFileCached} from './json-cache';
import {getRuntimeDataPath} from './runtime-data';

const MEMBERS_PATH = getRuntimeDataPath('members.json');

function readMembersStore() {
  return readJsonFileCached<any>(MEMBERS_PATH, () => ({}));
}

export function isMainGuildMember(discordId: any, membersStore?: any) {
  const actorId = String(discordId || '').trim();
  if (!actorId) return false;
  const store = membersStore || readMembersStore();
  const members = Array.isArray(store?.members) ? store.members : [];
  return members.some((member: any) => String(member?.id || '').trim() === actorId);
}

export function resolveViewerAccessContext(settings: any, discordId: any): ViewerCrewContext {
  const actorId = String(discordId || '').trim();
  return resolveViewerCrewContext({
    ownerDiscordId: String(settings?.ownerDiscordId || ''),
    coOwnerDiscordIds: Array.isArray(settings?.coOwnerDiscordIds) ? settings.coOwnerDiscordIds : [],
    discordId: actorId,
    outlineColor: String(settings?.outlineColor || '#ffffff14'),
    subCrews: Array.isArray(settings?.subCrews) ? settings.subCrews : [],
    isMainGuildMember: isMainGuildMember(actorId),
    hasJobTrackingViewOnlyAccess: hasJobTrackingViewOnlyAccess(settings, actorId),
  });
}
