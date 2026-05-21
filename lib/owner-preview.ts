export const OWNER_PREVIEW_STORAGE_KEY = 'reblas_owner_preview_member_mode';
export const OWNER_PREVIEW_MEMBER_STORAGE_KEY = 'reblas_owner_preview_member_id';
export const OWNER_PREVIEW_EVENT = 'reblas-owner-preview-change';
export const OWNER_PREVIEW_HEADER = 'x-reblas-owner-preview';
export const OWNER_PREVIEW_MEMBER_HEADER = 'x-reblas-owner-preview-member-id';

export type OwnerPreviewPermissionKey =
  | 'washAdd'
  | 'washEdit'
  | 'washDelete'
  | 'washMarkPending'
  | 'washMarkPaid'
  | 'weeklyManageMembers'
  | 'weeklySetAmounts'
  | 'weeklyPayMembers'
  | 'weeklyGovPayments';

export type OwnerPreviewPermissions = Record<OwnerPreviewPermissionKey, boolean>;

export const DEFAULT_OWNER_PREVIEW_PERMISSIONS: OwnerPreviewPermissions = {
  washAdd: false,
  washEdit: false,
  washDelete: false,
  washMarkPending: false,
  washMarkPaid: false,
  weeklyManageMembers: false,
  weeklySetAmounts: false,
  weeklyPayMembers: false,
  weeklyGovPayments: false,
};

function hasListedPermission(memberIds: any, discordId: string) {
  const actorId = String(discordId || '').trim();
  if (!actorId || !Array.isArray(memberIds)) return false;
  return memberIds.map((id) => String(id || '').trim()).includes(actorId);
}

export function normalizeOwnerPreviewMemberId(raw: any) {
  const value = String(raw || '').trim();
  return /^\d{6,25}$/.test(value) ? value : '';
}

export function deriveOwnerPreviewPermissions(settings: any, discordId: string): OwnerPreviewPermissions {
  const actorId = String(discordId || '').trim();
  const washAdd = hasListedPermission(settings?.washPermissionAddMemberIds, actorId);
  const washEdit = hasListedPermission(settings?.washPermissionEditMemberIds, actorId);
  const washDelete = hasListedPermission(settings?.washPermissionDeleteMemberIds, actorId);
  const washMarkPending = hasListedPermission(settings?.washPermissionMarkPendingMemberIds, actorId);
  const washMarkPaid = hasListedPermission(settings?.washPermissionMarkPaidMemberIds, actorId);

  return {
    washAdd,
    washEdit,
    washDelete,
    washMarkPending,
    washMarkPaid,
    weeklyManageMembers: washAdd || washEdit,
    weeklySetAmounts: washAdd || washEdit,
    weeklyPayMembers: washAdd || washEdit || washMarkPaid,
    weeklyGovPayments: washAdd || washEdit,
  };
}

export function buildOwnerPreviewHeaders(enabled: boolean, previewMemberId?: string): Record<string, string> {
  const memberId = normalizeOwnerPreviewMemberId(previewMemberId);
  if (!enabled || !memberId) return {};
  return {
    [OWNER_PREVIEW_HEADER]: '1',
    [OWNER_PREVIEW_MEMBER_HEADER]: memberId,
  };
}
