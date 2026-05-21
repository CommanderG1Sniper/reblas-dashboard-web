import {hasOwnerAccess, normalizeDiscordIdList} from './owner-access';

export type OrderPermissionSettings = {
  ownerDiscordId?: string;
  coOwnerDiscordIds?: string[] | null;
  orderPermissionViewMemberIds?: string[] | null;
  orderPermissionPlaceMemberIds?: string[] | null;
  orderPermissionManageMemberIds?: string[] | null;
  orderPermissionCancelMemberIds?: string[] | null;
};

export type OrderPermissions = {
  canViewOrders: boolean;
  canPlaceOrders: boolean;
  canManageOrders: boolean;
  canCancelOrders: boolean;
};

function hasListedPermission(memberIds: string[] | null | undefined, discordId: any) {
  const actorId = String(discordId || '').trim();
  if (!actorId) return false;
  return normalizeDiscordIdList(memberIds).includes(actorId);
}

export function resolveOrderPermissions(settings: OrderPermissionSettings | null | undefined, discordId: any): OrderPermissions {
  if (hasOwnerAccess(settings, discordId)) {
    return {
      canViewOrders: true,
      canPlaceOrders: true,
      canManageOrders: true,
      canCancelOrders: true,
    };
  }

  return {
    canViewOrders: hasListedPermission(settings?.orderPermissionViewMemberIds, discordId),
    canPlaceOrders: hasListedPermission(settings?.orderPermissionPlaceMemberIds, discordId),
    canManageOrders: hasListedPermission(settings?.orderPermissionManageMemberIds, discordId),
    canCancelOrders: hasListedPermission(settings?.orderPermissionCancelMemberIds, discordId),
  };
}
