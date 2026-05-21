import fs from 'fs';
import path from 'path';
import type {NextApiRequest} from 'next';
import {hasOwnerAccess} from '../owner-access';
import {
  DEFAULT_OWNER_PREVIEW_PERMISSIONS,
  OWNER_PREVIEW_HEADER,
  OWNER_PREVIEW_MEMBER_HEADER,
  deriveOwnerPreviewPermissions,
  normalizeOwnerPreviewMemberId,
  type OwnerPreviewPermissionKey,
  type OwnerPreviewPermissions,
} from '../owner-preview';
import {getRuntimeDataDir, getRuntimeDataPath} from './runtime-data';
import {invalidateJsonFileCache} from './json-cache';

export type OwnerPreviewContext = {
  active: boolean;
  actorId: string;
  effectiveDiscordId: string;
  previewMemberId: string;
  permissions: OwnerPreviewPermissions;
};

function previewRootDir(actorId: string) {
  return path.join(getRuntimeDataDir(), '_owner-preview', actorId);
}

function ensureParentDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

export function resolveOwnerPreviewContext(
  req: NextApiRequest,
  settings: any,
  actorId: string
): OwnerPreviewContext {
  const normalizedActorId = String(actorId || '').trim();
  const requested = String(req.headers[OWNER_PREVIEW_HEADER] || '').trim() === '1';
  const previewMemberId = normalizeOwnerPreviewMemberId(req.headers[OWNER_PREVIEW_MEMBER_HEADER]);

  if (!requested || !previewMemberId || !normalizedActorId || !hasOwnerAccess(settings, normalizedActorId)) {
    return {
      active: false,
      actorId: normalizedActorId,
      effectiveDiscordId: normalizedActorId,
      previewMemberId: '',
      permissions: {...DEFAULT_OWNER_PREVIEW_PERMISSIONS},
    };
  }

  return {
    active: true,
    actorId: normalizedActorId,
    effectiveDiscordId: previewMemberId,
    previewMemberId,
    permissions: deriveOwnerPreviewPermissions(settings, previewMemberId),
  };
}

export function resolveOwnerPreviewDataPath(
  preview: OwnerPreviewContext,
  filename: string,
  fallbackData: unknown
) {
  if (!preview.active || !preview.actorId) return getRuntimeDataPath(filename);

  const livePath = getRuntimeDataPath(filename);
  const previewPath = path.join(previewRootDir(preview.actorId), filename);
  ensureParentDir(previewPath);

  if (!fs.existsSync(previewPath)) {
    if (fs.existsSync(livePath)) fs.copyFileSync(livePath, previewPath);
    else fs.writeFileSync(previewPath, JSON.stringify(fallbackData, null, 2), 'utf8');
    invalidateJsonFileCache(previewPath);
  }

  return previewPath;
}

export function hasOwnerPreviewPermission(preview: OwnerPreviewContext, key: OwnerPreviewPermissionKey) {
  return !!preview.active && !!preview.permissions[key];
}

export function clearOwnerPreviewData(actorId: string) {
  const normalizedActorId = String(actorId || '').trim();
  if (!normalizedActorId) return {cleared: false};

  const root = previewRootDir(normalizedActorId);
  if (!fs.existsSync(root)) return {cleared: false};

  const files = collectFiles(root);
  for (const file of files) invalidateJsonFileCache(file);
  fs.rmSync(root, {recursive: true, force: true});
  return {cleared: true};
}
