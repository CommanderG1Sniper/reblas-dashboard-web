import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../lib/server/runtime-data';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from './auth/[...nextauth]';
import {invalidateJsonFileCache, readJsonFileCached} from '../../lib/server/json-cache';
import {hasOwnerAccess} from '../../lib/owner-access';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const ITEMS_PATH = getRuntimeDataPath('items.json');

type ItemCategory = 'mats' | 'orders';

type ItemMaterialRequirement = {
  matId: string;
  quantity: number;
};

type ItemRecord = {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  imageUrl: string;
  dirtyWashRequirementCents: number;
  cleanCashCents: number;
  dirtyCashCents: number;
  materials: ItemMaterialRequirement[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type ItemsFile = {
  schemaVersion: number;
  items: ItemRecord[];
};

const DEFAULTS: ItemsFile = {
  schemaVersion: 2,
  items: [],
};

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(ITEMS_PATH)) {
    fs.writeFileSync(ITEMS_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  }
}

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function isOwner(session: any, settings: any) {
  return hasOwnerAccess(settings, session?.discordId);
}

function normalizeText(v: any, maxLen: number) {
  return String(v ?? '')
    .trim()
    .slice(0, maxLen);
}

function normalizeMoneyCents(v: any) {
  return Math.max(0, Math.floor(Number(v || 0)));
}

function normalizeCategory(v: any): ItemCategory {
  return v === 'mats' ? 'mats' : 'orders';
}

function normalizeMaterials(raw: any): ItemMaterialRequirement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => ({
      matId: normalizeText(entry?.matId, 120),
      quantity: Math.max(1, Math.floor(Number(entry?.quantity || 1))),
    }))
    .filter((entry) => !!entry.matId);
}

function normalizeItem(raw: any): ItemRecord | null {
  const id = normalizeText(raw?.id, 120);
  const name = normalizeText(raw?.name, 120);
  if (!id || !name) return null;

  return {
    id,
    name,
    description: normalizeText(raw?.description, 240),
    category: normalizeCategory(raw?.category),
    imageUrl: normalizeText(raw?.imageUrl, 500),
    dirtyWashRequirementCents: normalizeMoneyCents(raw?.dirtyWashRequirementCents ?? raw?.priceCents),
    cleanCashCents: normalizeMoneyCents(raw?.cleanCashCents),
    dirtyCashCents: normalizeMoneyCents(raw?.dirtyCashCents),
    materials: normalizeMaterials(raw?.materials),
    active: raw?.active !== undefined ? !!raw.active : true,
    createdAt: normalizeText(raw?.createdAt, 80),
    updatedAt: normalizeText(raw?.updatedAt, 80),
  };
}

function readItems(): ItemsFile {
  ensureFiles();
  const parsed = readJsonFileCached<any>(ITEMS_PATH, () => DEFAULTS);
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
  const items = rawItems.map(normalizeItem).filter(Boolean) as ItemRecord[];
  return {
    schemaVersion: 2,
    items,
  };
}

function writeItems(next: ItemsFile) {
  ensureFiles();
  const tmp = `${ITEMS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, ITEMS_PATH);
  invalidateJsonFileCache(ITEMS_PATH);
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const settings = readSettings();
    const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
    if (!session) return res.status(401).json({error: 'Login required'});

    if (req.method === 'GET') {
      return res.status(200).json(readItems());
    }

    if (!isOwner(session as any, settings)) {
      return res.status(403).json({error: 'Owner only'});
    }

    const store = readItems();
    const body = (req.body || {}) as any;

    if (req.method === 'POST') {
      const action = normalizeText(body?.action, 40);

      if (action === 'create') {
        const now = new Date().toISOString();
        const candidate = normalizeItem({
          id: makeId(),
          name: body?.item?.name,
          description: body?.item?.description,
          category: body?.item?.category,
          imageUrl: body?.item?.imageUrl,
          dirtyWashRequirementCents: body?.item?.dirtyWashRequirementCents,
          cleanCashCents: body?.item?.cleanCashCents,
          dirtyCashCents: body?.item?.dirtyCashCents,
          materials: body?.item?.materials,
          active: body?.item?.active,
          createdAt: now,
          updatedAt: now,
        });
        if (!candidate) return res.status(400).json({error: 'Item name is required'});
        store.items.unshift(candidate);
        writeItems(store);
        return res.status(200).json({ok: true, store: readItems()});
      }

      if (action === 'update') {
        const id = normalizeText(body?.id, 120);
        const idx = store.items.findIndex((item) => item.id === id);
        if (idx < 0) return res.status(404).json({error: 'Item not found'});

        const prev = store.items[idx];
        const next = normalizeItem({
          ...prev,
          name: body?.item?.name ?? prev.name,
          description: body?.item?.description ?? prev.description,
          category: body?.item?.category ?? prev.category,
          imageUrl: body?.item?.imageUrl ?? prev.imageUrl,
          dirtyWashRequirementCents: body?.item?.dirtyWashRequirementCents ?? prev.dirtyWashRequirementCents,
          cleanCashCents: body?.item?.cleanCashCents ?? prev.cleanCashCents,
          dirtyCashCents: body?.item?.dirtyCashCents ?? prev.dirtyCashCents,
          materials: body?.item?.materials ?? prev.materials,
          active: body?.item?.active ?? prev.active,
          createdAt: prev.createdAt,
          updatedAt: new Date().toISOString(),
        });
        if (!next) return res.status(400).json({error: 'Item name is required'});
        store.items[idx] = next;
        writeItems(store);
        return res.status(200).json({ok: true, store: readItems()});
      }

      if (action === 'delete') {
        const id = normalizeText(body?.id, 120);
        store.items = store.items.filter((item) => item.id !== id);
        writeItems(store);
        return res.status(200).json({ok: true, store: readItems()});
      }

      return res.status(400).json({error: 'Unsupported action'});
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({error: 'Method not allowed'});
  } catch (error: any) {
    return res.status(500).json({error: error?.message || 'Failed to process items request'});
  }
}
