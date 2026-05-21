import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from './auth/[...nextauth]';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../lib/server/runtime-data';
import {invalidateJsonFileCache, readJsonFileCached} from '../../lib/server/json-cache';
import {hasOwnerAccess} from '../../lib/owner-access';
import {resolveOwnerPreviewContext} from '../../lib/server/owner-preview';

const DATA_DIR = getRuntimeDataDir();
const SETTINGS_PATH = getRuntimeDataPath('settings.json');
const SCAV_HUNT_PATH = getRuntimeDataPath('scavHuntTracker.json');
const MEMBERS_PATH = getRuntimeDataPath('members.json');

type ScavSection = 'main' | 'garbage';
type ScavItemType = 'standard' | 'aggregate';
type ScavAggregateGroup = '' | 'garbage';

type ScavPerson = {
  id: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};

type ScavItem = {
  id: string;
  name: string;
  section: ScavSection;
  itemType: ScavItemType;
  aggregateGroup: ScavAggregateGroup;
  totalNeededWhole: number;
  qtyInVanWhole: number;
  position: number;
  createdAt: string;
  updatedAt: string;
};

type ScavContribution = {
  id: string;
  itemId: string;
  personId: string;
  qtyWhole: number;
  createdAt: string;
  updatedAt: string;
};

type ScavHuntStore = {
  schemaVersion: number;
  people: ScavPerson[];
  items: ScavItem[];
  contributions: ScavContribution[];
};

const DEFAULTS: ScavHuntStore = {
  schemaVersion: 1,
  people: [],
  items: [],
  contributions: [],
};

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive: true});
  if (!fs.existsSync(SCAV_HUNT_PATH)) {
    fs.writeFileSync(SCAV_HUNT_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  }
}

function readSettings() {
  return readJsonFileCached<any>(SETTINGS_PATH, () => ({}));
}

function readMainGuildMembers(): any[] {
  const payload = readJsonFileCached<any>(MEMBERS_PATH, () => ({}));
  return Array.isArray(payload?.members) ? payload.members : [];
}

function normalizeText(v: any, maxLen: number) {
  return String(v ?? '')
    .trim()
    .slice(0, maxLen);
}

function normalizeWhole(v: any) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 0;
  return n;
}

function normalizePositiveWhole(v: any) {
  const n = normalizeWhole(v);
  return n > 0 ? n : 0;
}

function normalizePosition(v: any) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 0;
  return n;
}

function normalizeSection(v: any): ScavSection {
  return String(v || '').trim() === 'garbage' ? 'garbage' : 'main';
}

function normalizeItemType(v: any): ScavItemType {
  return String(v || '').trim() === 'aggregate' ? 'aggregate' : 'standard';
}

function normalizeAggregateGroup(v: any): ScavAggregateGroup {
  return String(v || '').trim() === 'garbage' ? 'garbage' : '';
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function memberDisplayName(raw: any) {
  return normalizeText(raw?.displayName || raw?.nick || raw?.globalName || raw?.username || raw?.id, 120);
}

function normalizePerson(raw: any): ScavPerson | null {
  const id = normalizeText(raw?.id, 120);
  const name = normalizeText(raw?.name, 120);
  if (!id || !name) return null;
  return {
    id,
    name,
    position: normalizePosition(raw?.position),
    createdAt: normalizeText(raw?.createdAt, 80),
    updatedAt: normalizeText(raw?.updatedAt, 80),
  };
}

function normalizeItem(raw: any): ScavItem | null {
  const id = normalizeText(raw?.id, 120);
  const name = normalizeText(raw?.name, 120);
  if (!id || !name) return null;
  const itemType = normalizeItemType(raw?.itemType);
  return {
    id,
    name,
    section: normalizeSection(raw?.section),
    itemType,
    aggregateGroup: itemType === 'aggregate' ? normalizeAggregateGroup(raw?.aggregateGroup) : '',
    totalNeededWhole: normalizePositiveWhole(raw?.totalNeededWhole),
    qtyInVanWhole: normalizeWhole(raw?.qtyInVanWhole),
    position: normalizePosition(raw?.position),
    createdAt: normalizeText(raw?.createdAt, 80),
    updatedAt: normalizeText(raw?.updatedAt, 80),
  };
}

function normalizeContribution(raw: any): ScavContribution | null {
  const id = normalizeText(raw?.id, 120);
  const itemId = normalizeText(raw?.itemId, 120);
  const personId = normalizeText(raw?.personId, 120);
  if (!id || !itemId || !personId) return null;
  return {
    id,
    itemId,
    personId,
    qtyWhole: normalizeWhole(raw?.qtyWhole),
    createdAt: normalizeText(raw?.createdAt, 80),
    updatedAt: normalizeText(raw?.updatedAt, 80),
  };
}

function readStore(): ScavHuntStore {
  ensureFiles();
  const parsed = readJsonFileCached<any>(SCAV_HUNT_PATH, () => DEFAULTS);
  const people = Array.isArray(parsed?.people) ? parsed.people.map(normalizePerson).filter(Boolean) as ScavPerson[] : [];
  const items = Array.isArray(parsed?.items) ? parsed.items.map(normalizeItem).filter(Boolean) as ScavItem[] : [];
  const contributions = Array.isArray(parsed?.contributions)
    ? parsed.contributions.map(normalizeContribution).filter(Boolean) as ScavContribution[]
    : [];
  return {
    schemaVersion: 1,
    people,
    items,
    contributions,
  };
}

function writeStore(next: ScavHuntStore) {
  ensureFiles();
  const tmp = `${SCAV_HUNT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, SCAV_HUNT_PATH);
  invalidateJsonFileCache(SCAV_HUNT_PATH);
}

function sortByPositionAndName<T extends {position?: number; name?: string}>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aPos = Number(a.position || 0) > 0 ? Number(a.position || 0) : Number.MAX_SAFE_INTEGER;
    const bPos = Number(b.position || 0) > 0 ? Number(b.position || 0) : Number.MAX_SAFE_INTEGER;
    if (aPos !== bPos) return aPos - bPos;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function buildResponse(store: ScavHuntStore) {
  const people = sortByPositionAndName(store.people);
  const sortedItems = sortByPositionAndName(store.items);
  const personIds = new Set(people.map((person) => person.id));
  const standardItems = sortedItems.filter((item) => item.itemType === 'standard');
  const contributions = store.contributions.filter(
    (entry) => personIds.has(entry.personId) && standardItems.some((item) => item.id === entry.itemId)
  );

  const contributionsByItem = new Map<string, ScavContribution[]>();
  for (const entry of contributions) {
    const list = contributionsByItem.get(entry.itemId) || [];
    list.push(entry);
    contributionsByItem.set(entry.itemId, list);
  }

  function computeRow(item: ScavItem) {
    let qtyInVanWhole = Number(item.qtyInVanWhole || 0);
    let peopleTotals: Record<string, number> = {};

    if (item.itemType === 'aggregate' && item.aggregateGroup) {
      const sourceItems = standardItems.filter((candidate) => candidate.section === item.aggregateGroup);
      qtyInVanWhole = sourceItems.reduce((sum, candidate) => sum + Number(candidate.qtyInVanWhole || 0), 0);
      for (const person of people) {
        peopleTotals[person.id] = sourceItems.reduce((sum, sourceItem) => {
          const list = contributionsByItem.get(sourceItem.id) || [];
          return sum + list.filter((entry) => entry.personId === person.id).reduce((subSum, entry) => subSum + Number(entry.qtyWhole || 0), 0);
        }, 0);
      }
    } else {
      const list = contributionsByItem.get(item.id) || [];
      for (const person of people) {
        peopleTotals[person.id] = list
          .filter((entry) => entry.personId === person.id)
          .reduce((sum, entry) => sum + Number(entry.qtyWhole || 0), 0);
      }
    }

    const peopleTotalWhole = Object.values(peopleTotals).reduce((sum, value) => sum + Number(value || 0), 0);
    const totalCollectedWhole = qtyInVanWhole + peopleTotalWhole;
    const qtyNeededWhole = Math.max(0, Number(item.totalNeededWhole || 0) - totalCollectedWhole);

    return {
      ...item,
      qtyInVanWhole,
      peopleTotals,
      peopleTotalWhole,
      totalCollectedWhole,
      qtyNeededWhole,
      isComplete: Number(item.totalNeededWhole || 0) > 0 && totalCollectedWhole >= Number(item.totalNeededWhole || 0),
      canEditAdded: item.itemType === 'standard',
      canEditPeople: item.itemType === 'standard',
    };
  }

  const mainItems = sortedItems.filter((item) => item.section === 'main').map(computeRow);
  const garbageItems = sortedItems.filter((item) => item.section === 'garbage').map(computeRow);

  return {
    people,
    mainItems,
    garbageItems,
    totals: {
      itemCount: sortedItems.length,
      peopleCount: people.length,
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  const settings = readSettings();
  const actorId = String((session as any)?.discordId || '').trim();
  const preview = resolveOwnerPreviewContext(req, settings, actorId);
  const canManage = hasOwnerAccess(settings, actorId);

  if (req.method === 'GET') {
    return res.status(200).json(buildResponse(readStore()));
  }

  if (preview.active) return res.status(403).json({error: 'Member view is read-only for scav hunt changes'});
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const body = (req.body || {}) as any;
  const action = normalizeText(body.action, 40);
  const store = readStore();

  if (action === 'create_person') {
    if (!canManage) return res.status(403).json({error: 'Owner or co-owner only'});
    const memberId = normalizeText(body.memberId, 120);
    const sourceMember = memberId ? readMainGuildMembers().find((member) => String(member?.id || '').trim() === memberId) : null;
    const name = sourceMember ? memberDisplayName(sourceMember) : normalizeText(body.name, 120);
    const position = normalizePosition(body.position);
    if (!name) return res.status(400).json({error: 'Person name is required'});
    if (memberId && !sourceMember) return res.status(404).json({error: 'Member not found in main guild list'});
    const nowIso = new Date().toISOString();
    const existingById = memberId ? store.people.find((person) => person.id === memberId) : null;
    if (existingById) {
      return res.status(409).json({error: 'That member is already added'});
    }
    const existingByName = store.people.find((person) => String(person.name || '').trim().toLowerCase() === name.toLowerCase());
    if (existingByName && memberId) {
      const oldId = existingByName.id;
      existingByName.id = memberId;
      existingByName.name = name;
      existingByName.position = position || existingByName.position;
      existingByName.updatedAt = nowIso;
      for (const contribution of store.contributions) {
        if (contribution.personId === oldId) contribution.personId = memberId;
      }
      writeStore(store);
      return res.status(200).json({ok: true, ...buildResponse(store)});
    }
    if (existingByName) return res.status(409).json({error: 'A person with that name already exists'});
    store.people.push({
      id: memberId || makeId(),
      name,
      position,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  if (action === 'remove_person') {
    if (!canManage) return res.status(403).json({error: 'Owner or co-owner only'});
    const personId = normalizeText(body.personId, 120);
    if (!personId) return res.status(400).json({error: 'Person is required'});
    if (!store.people.some((person) => person.id === personId)) return res.status(404).json({error: 'Person not found'});
    store.people = store.people.filter((person) => person.id !== personId);
    store.contributions = store.contributions.filter((entry) => entry.personId !== personId);
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  if (action === 'create_item') {
    if (!canManage) return res.status(403).json({error: 'Owner or co-owner only'});
    const name = normalizeText(body.name, 120);
    const section = normalizeSection(body.section);
    const itemType = normalizeItemType(body.itemType);
    const aggregateGroup = itemType === 'aggregate' ? normalizeAggregateGroup(body.aggregateGroup) : '';
    const totalNeededWhole = normalizePositiveWhole(body.totalNeededWhole);
    const position = normalizePosition(body.position);
    if (!name) return res.status(400).json({error: 'Item name is required'});
    if (itemType === 'aggregate' && !aggregateGroup) {
      return res.status(400).json({error: 'Aggregate source group is required'});
    }
    if (store.items.some((item) => String(item.name || '').trim().toLowerCase() === name.toLowerCase() && item.section === section)) {
      return res.status(409).json({error: 'An item with that name already exists in this section'});
    }
    const nowIso = new Date().toISOString();
    store.items.push({
      id: makeId(),
      name,
      section,
      itemType,
      aggregateGroup,
      totalNeededWhole,
      qtyInVanWhole: 0,
      position,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  if (action === 'update_item') {
    if (!canManage) return res.status(403).json({error: 'Owner or co-owner only'});
    const itemId = normalizeText(body.itemId, 120);
    const item = store.items.find((candidate) => candidate.id === itemId);
    if (!item) return res.status(404).json({error: 'Item not found'});
    const name = normalizeText(body.name, 120);
    const section = normalizeSection(body.section);
    const itemType = normalizeItemType(body.itemType);
    const aggregateGroup = itemType === 'aggregate' ? normalizeAggregateGroup(body.aggregateGroup) : '';
    if (!name) return res.status(400).json({error: 'Item name is required'});
    if (itemType === 'aggregate' && !aggregateGroup) {
      return res.status(400).json({error: 'Aggregate source group is required'});
    }
    if (store.items.some((candidate) => candidate.id !== itemId && String(candidate.name || '').trim().toLowerCase() === name.toLowerCase() && candidate.section === section)) {
      return res.status(409).json({error: 'An item with that name already exists in this section'});
    }
    item.name = name;
    item.section = section;
    item.itemType = itemType;
    item.aggregateGroup = aggregateGroup;
    item.totalNeededWhole = normalizePositiveWhole(body.totalNeededWhole);
    item.position = normalizePosition(body.position);
    item.updatedAt = new Date().toISOString();
    if (item.itemType === 'aggregate') {
      item.qtyInVanWhole = 0;
      store.contributions = store.contributions.filter((entry) => entry.itemId !== item.id);
    }
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  if (action === 'add_qty_in_van') {
    const itemId = normalizeText(body.itemId, 120);
    const amountWhole = normalizeWhole(body.amountWhole);
    const item = store.items.find((candidate) => candidate.id === itemId);
    if (!item) return res.status(404).json({error: 'Item not found'});
    if (item.itemType !== 'standard') return res.status(400).json({error: 'Only standard items support Added amounts'});
    if (!Number.isFinite(amountWhole) || amountWhole === 0) return res.status(400).json({error: 'Amount must be a non-zero whole number'});
    item.qtyInVanWhole = Number(item.qtyInVanWhole || 0) + amountWhole;
    item.updatedAt = new Date().toISOString();
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  if (action === 'set_qty_in_van') {
    const itemId = normalizeText(body.itemId, 120);
    const qtyWhole = normalizeWhole(body.qtyWhole);
    const item = store.items.find((candidate) => candidate.id === itemId);
    if (!item) return res.status(404).json({error: 'Item not found'});
    if (item.itemType !== 'standard') return res.status(400).json({error: 'Only standard items support Qty In Van values'});
    item.qtyInVanWhole = qtyWhole;
    item.updatedAt = new Date().toISOString();
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  if (action === 'set_person_amount') {
    const itemId = normalizeText(body.itemId, 120);
    const personId = normalizeText(body.personId, 120);
    const qtyWhole = normalizeWhole(body.qtyWhole);
    const item = store.items.find((candidate) => candidate.id === itemId);
    if (!item) return res.status(404).json({error: 'Item not found'});
    if (item.itemType !== 'standard') return res.status(400).json({error: 'Only standard items support person amounts'});
    if (!store.people.some((person) => person.id === personId)) return res.status(404).json({error: 'Person not found'});
    const existing = store.contributions.find((entry) => entry.itemId === itemId && entry.personId === personId);
    const nowIso = new Date().toISOString();
    if (qtyWhole === 0) {
      store.contributions = store.contributions.filter((entry) => !(entry.itemId === itemId && entry.personId === personId));
    } else if (existing) {
      existing.qtyWhole = qtyWhole;
      existing.updatedAt = nowIso;
    } else {
      store.contributions.push({
        id: makeId(),
        itemId,
        personId,
        qtyWhole,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  if (action === 'clear_tracker') {
    if (!canManage) return res.status(403).json({error: 'Owner or co-owner only'});
    const nowIso = new Date().toISOString();
    for (const item of store.items) {
      item.totalNeededWhole = 0;
      item.qtyInVanWhole = 0;
      item.updatedAt = nowIso;
    }
    store.contributions = [];
    writeStore(store);
    return res.status(200).json({ok: true, ...buildResponse(store)});
  }

  return res.status(400).json({error: 'Unknown action'});
}
