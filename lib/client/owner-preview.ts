import React from 'react';
import {hasOwnerAccess} from '../owner-access';
import {
  OWNER_PREVIEW_EVENT,
  OWNER_PREVIEW_MEMBER_STORAGE_KEY,
  OWNER_PREVIEW_STORAGE_KEY,
  normalizeOwnerPreviewMemberId,
} from '../owner-preview';

function readOwnerPreviewMode() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(OWNER_PREVIEW_STORAGE_KEY) === '1';
}

function writeOwnerPreviewMode(enabled: boolean) {
  if (typeof window === 'undefined') return;
  if (enabled) window.localStorage.setItem(OWNER_PREVIEW_STORAGE_KEY, '1');
  else window.localStorage.removeItem(OWNER_PREVIEW_STORAGE_KEY);
  window.dispatchEvent(new Event(OWNER_PREVIEW_EVENT));
}

function readOwnerPreviewMemberId() {
  if (typeof window === 'undefined') return '';
  return normalizeOwnerPreviewMemberId(window.localStorage.getItem(OWNER_PREVIEW_MEMBER_STORAGE_KEY));
}

function writeOwnerPreviewMemberId(memberId: string) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeOwnerPreviewMemberId(memberId);
  if (normalized) window.localStorage.setItem(OWNER_PREVIEW_MEMBER_STORAGE_KEY, normalized);
  else window.localStorage.removeItem(OWNER_PREVIEW_MEMBER_STORAGE_KEY);
  window.dispatchEvent(new Event(OWNER_PREVIEW_EVENT));
}

export function useOwnerPreviewMode(settings: any, discordId: string) {
  const actorId = String(discordId || '').trim();
  const ownerId = String(settings?.ownerDiscordId || '').trim();
  const actualCanManageSettings = hasOwnerAccess(settings, actorId);
  const actualIsPrimaryOwner = !!actorId && !!ownerId && actorId === ownerId;
  const [previewMemberMode, setPreviewMemberModeState] = React.useState(false);
  const [previewMemberId, setPreviewMemberIdState] = React.useState('');

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => {
      const memberId = actualCanManageSettings ? readOwnerPreviewMemberId() : '';
      const enabled = actualCanManageSettings ? readOwnerPreviewMode() && !!memberId : false;
      setPreviewMemberIdState(memberId);
      setPreviewMemberModeState(enabled);
    };

    sync();
    const onStorage = () => sync();
    const onPreviewChange = () => sync();
    window.addEventListener('storage', onStorage);
    window.addEventListener(OWNER_PREVIEW_EVENT, onPreviewChange);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(OWNER_PREVIEW_EVENT, onPreviewChange);
    };
  }, [actualCanManageSettings]);

  const startPreviewMode = React.useCallback(
    async (memberId: string) => {
      if (!actualCanManageSettings) return;
      const normalized = normalizeOwnerPreviewMemberId(memberId);
      if (!normalized) return;
      writeOwnerPreviewMemberId(normalized);
      writeOwnerPreviewMode(true);
      setPreviewMemberIdState(normalized);
      setPreviewMemberModeState(true);
    },
    [actualCanManageSettings]
  );

  const stopPreviewMode = React.useCallback(async () => {
    if (!actualCanManageSettings) return;
    writeOwnerPreviewMode(false);
    writeOwnerPreviewMemberId('');
    setPreviewMemberModeState(false);
    setPreviewMemberIdState('');
    void fetch('/api/owner-preview', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'clear'}),
    }).catch(() => null);
  }, [actualCanManageSettings]);

  const setPreviewMemberId = React.useCallback(
    (memberId: string) => {
      if (!actualCanManageSettings) return;
      const normalized = normalizeOwnerPreviewMemberId(memberId);
      writeOwnerPreviewMemberId(normalized);
      setPreviewMemberIdState(normalized);
    },
    [actualCanManageSettings]
  );

  const effectiveDiscordId = previewMemberMode && previewMemberId ? previewMemberId : actorId;
  const effectiveIsPrimaryOwner = !!effectiveDiscordId && !!ownerId && effectiveDiscordId === ownerId;

  return {
    previewMemberMode: actualCanManageSettings ? previewMemberMode : false,
    previewMemberId: actualCanManageSettings ? previewMemberId : '',
    setPreviewMemberId,
    startPreviewMode,
    stopPreviewMode,
    effectiveDiscordId,
    actualCanManageSettings,
    actualIsPrimaryOwner,
    canManageSettings: actualCanManageSettings && !previewMemberMode,
    isPrimaryOwner: previewMemberMode ? effectiveIsPrimaryOwner : actualIsPrimaryOwner,
  };
}
