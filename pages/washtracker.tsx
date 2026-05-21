import type {NextPage} from 'next';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import {useRouter} from 'next/router';
import {Avatar, Button, Card, Dropdown, Input, Modal, Spacer, Text} from '@nextui-org/react';

import {MdPaid, MdOutlinePendingActions, MdDelete} from 'react-icons/md';
import {FaEdit, FaEquals} from 'react-icons/fa';
import {FaCircleMinus, FaCirclePlus} from 'react-icons/fa6';
import {GiReceiveMoney, GiPayMoney} from 'react-icons/gi';
import {useGuildSettings} from '../lib/guild-settings';
import {useSession} from 'next-auth/react';
import {addDaysYMD, dueWeekEndingSundayMelbourne, weekEndingSundayMelbourne} from '../lib/time/melbourne';
import {SubCrewWashTracker} from '../components/subcrew/wash-tracker';
import {fetchJsonCached} from '../lib/client/request-cache';
import {useOwnerPreviewMode} from '../lib/client/owner-preview';
import {buildOwnerPreviewHeaders} from '../lib/owner-preview';

const MemberHistoryModal = dynamic(
  () => import('../components/washtracker/member-history-modal').then((m) => m.MemberHistoryModal),
  {ssr: false}
);
const AddWashModal = dynamic(
  () => import('../components/washtracker/add-wash-modal').then((m) => m.AddWashModal),
  {ssr: false}
);
type Member = {
  id: string;
  displayName?: string;
  nick?: string;
  globalName?: string;
  username?: string;
  avatarUrl?: string;
  rolesSorted?: string[];
  roles?: string[];
  isPrevMonthTopDirty?: boolean;
  isCustom?: boolean;
};

type MembersPayload = {
  members?: Member[];
  roleMap?: Record<string, {name: string; position: number; color?: number}>;
};

type WashEntry = {
  id: string;
  memberId: string;
  washRatePct: number;
  dirtyCents: number;
  cleanCents: number;
  paidDirtyCents?: number;
  paidCleanCents?: number;
  status: 'collected' | 'pending' | 'paid';
  createdAt: string;
};

type WeekPayload = {
  weekEnding: string; // YYYY-MM-DD
  label: string; // "Current Week" or YYYY-MM-DD
  suggestedWashRatePct: number;
  entries: WashEntry[];
  totals: {dirtyCents: number; cleanCents: number};
};

type TotalsRow = {
  memberId: string;
  dirtyCents: number;
  cleanCents: number;
  expectedDirtyCents?: number;
  expectedCleanCents?: number;
  paidDirtyCents?: number;
  paidCleanCents?: number;
  cleanOutstandingCents?: number;
  dirtyOutstandingCents?: number;
  entryCount: number;
  lastWeekEnding: string;
};

type WashTotalsPayload = {
  upto: string | null;
  members: TotalsRow[];
  totals: {
    dirtyCents: number;
    cleanCents: number;
    totalDirtyExpectedCents?: number;
    totalCleanExpectedCents?: number;
    totalDirtyPaidCents?: number;
    totalCleanPaidCents?: number;
    dirtyOutstandingCents?: number;
    cleanOutstandingCents?: number;
    entryCount: number;
  };
};

type MemberHistoryPayload = {
  memberId: string;
  totals: {dirtyCents: number; cleanCents: number; entryCount: number};
  entries: Array<{
    weekEnding: string;
    id: string;
    dirtyCents: number;
    cleanCents: number;
    createdAt: string;
  }>;
};

type WeeklysMembersPayload = {
  weekEnding?: string;
  activeMemberIds: string[];
  customMembers?: Member[];
};

type GovPayment = {
  id: string;
  paymentType: 'clean' | 'dirty';
  amountCents: number;
  description: string;
  createdAt: string;
};

type GovPaymentsPayload = {
  entries: GovPayment[];
  totals: {
    cleanCents: number;
    dirtyCents: number;
    entryCount: number;
  };
};

const CLUBFUND_VIRTUAL_MEMBER_ID = '999999999999999991';

const glassCardCss = {
  p: '$10',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

function formatCentsWhole(cents: number) {
  const n = Number(cents || 0) / 100;
  try {
    return n.toLocaleString(undefined, {style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0});
  } catch {
    return `$${n.toFixed(0)}`;
  }
}

function formatCents(cents: number) {
  const n = Math.round(Number(cents || 0) / 100);
  try {
    return n.toLocaleString(undefined, {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
  } catch {
    return `$${n.toLocaleString()}`;
  }
}

function parseMoneyToCents(raw: string) {
  const cleaned = String(raw || '').trim().replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function calcCleanCents(dirtyCents: number, washRatePct: number) {
  const keepPct = 100 - washRatePct;
  return Math.round((dirtyCents * keepPct) / 100);
}

function formatYmdToDmy(ymd: string) {
  const [y, m, d] = String(ymd || '').split('-');
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function formatDateToDmy(raw: string) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function displayNameOf(m?: Member) {
  if (!m) return '';
  return String(m.displayName || m.nick || m.globalName || m.username || m.id);
}

function renderMemberName(m?: Member, fallback?: string) {
  const label = m ? displayNameOf(m) : String(fallback || '');
  return (
    <>
      {label}
      {m?.isPrevMonthTopDirty ? (
        <span style={{color: '#fbbf24', marginLeft: 6, fontSize: 12, verticalAlign: 'middle'}}>★</span>
      ) : null}
    </>
  );
}

function renderOutstandingCents(cents: number, formatCentsWhole: (cents: number) => string) {
  const n = Number(cents || 0);
  if (n === 0) {
    return (
      <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--reblas-btn1-color)'}}>
        <FaEquals size={14} />
        Up To Date
      </span>
    );
  }
  if (n < 0) {
    return (
      <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--reblas-btn2-color)'}}>
        <FaCirclePlus size={14} />
        {formatCentsWhole(Math.abs(n))}
      </span>
    );
  }
  return (
    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--reblas-btn3-color)'}}>
      <FaCircleMinus size={14} />
      {formatCentsWhole(Math.abs(n))}
    </span>
  );
}

function govDescriptionColor(description: string) {
  const d = String(description || '').trim().toLowerCase();
  if (d === 'rent') return 'var(--reblas-btn2-color)';
  if (d === 'blueprint tax') return 'var(--reblas-btn1-color)';
  return 'var(--reblas-btn4-color)';
}

const MainWashTracker = () => {
  const router = useRouter();
  const isWeeklysTracker = router.pathname === '/weeklys-tracker';
  const {data: session} = useSession();
  const {settings} = useGuildSettings();
  const defaultWashRatePct = Math.max(0, Math.min(100, Math.floor(Number(settings.defaultWashRatePct ?? 25))));
  const myId = String((session as any)?.discordId || '').trim();
  const isOwner = settings.viewerRole === 'owner';
  const {previewMemberMode, previewMemberId, effectiveDiscordId} = useOwnerPreviewMode(settings, myId);

  const actualCanAddWash = useMemo(() => {
    if (isOwner) return true;
    const allowed = Array.isArray((settings as any).washPermissionAddMemberIds) ? (settings as any).washPermissionAddMemberIds : [];
    return allowed.map((x: any) => String(x || '').trim()).includes(effectiveDiscordId);
  }, [effectiveDiscordId, isOwner, settings]);

  const actualCanEditWash = useMemo(() => {
    if (isOwner) return true;
    const allowed = Array.isArray((settings as any).washPermissionEditMemberIds)
      ? (settings as any).washPermissionEditMemberIds
      : [];
    return allowed.map((x: any) => String(x || '').trim()).includes(effectiveDiscordId);
  }, [effectiveDiscordId, isOwner, settings]);

  const actualCanDeleteWash = useMemo(() => {
    if (isOwner) return true;
    const allowed = Array.isArray((settings as any).washPermissionDeleteMemberIds)
      ? (settings as any).washPermissionDeleteMemberIds
      : [];
    return allowed.map((x: any) => String(x || '').trim()).includes(effectiveDiscordId);
  }, [effectiveDiscordId, isOwner, settings]);

  const actualCanMarkPending = useMemo(() => {
    if (isOwner) return true;
    const allowed = Array.isArray((settings as any).washPermissionMarkPendingMemberIds)
      ? (settings as any).washPermissionMarkPendingMemberIds
      : [];
    return allowed.map((x: any) => String(x || '').trim()).includes(effectiveDiscordId);
  }, [effectiveDiscordId, isOwner, settings]);

  const actualCanMarkPaid = useMemo(() => {
    if (isOwner) return true;
    const allowed = Array.isArray((settings as any).washPermissionMarkPaidMemberIds)
      ? (settings as any).washPermissionMarkPaidMemberIds
      : [];
    return allowed.map((x: any) => String(x || '').trim()).includes(effectiveDiscordId);
  }, [effectiveDiscordId, isOwner, settings]);
  const canAddWash = actualCanAddWash;
  const canEditWash = actualCanEditWash;
  const canDeleteWash = actualCanDeleteWash;
  const canMarkPending = actualCanMarkPending;
  const canMarkPaid = actualCanMarkPaid;
  const canManageWeeklysMembers = actualCanAddWash || actualCanEditWash;
  const canSetWeeklys = actualCanAddWash || actualCanEditWash;
  const canPayWeeklys = actualCanAddWash || actualCanEditWash || actualCanMarkPaid;
  const canManageGovPayments = actualCanAddWash || actualCanEditWash;
  const ownerPreviewHeaders = useMemo(
    () => buildOwnerPreviewHeaders(previewMemberMode, previewMemberId),
    [previewMemberId, previewMemberMode]
  );
  const previewFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      for (const [key, value] of Object.entries(ownerPreviewHeaders)) headers.set(key, value);
      return fetch(input, {...init, headers});
    },
    [ownerPreviewHeaders]
  );

  // Default view: totals
  const [view, setView] = useState<'totals' | 'week' | 'payments'>('week');

  const [membersPayload, setMembersPayload] = useState<MembersPayload>({});
  const [membersExcludeRoleIds, setMembersExcludeRoleIds] = useState<string[]>([]);

  const [membersErr, setMembersErr] = useState('');

  const washVirtualMembers = useMemo<Member[]>(() => {
    if (isWeeklysTracker) return [];
    return [
      {
        id: CLUBFUND_VIRTUAL_MEMBER_ID,
        displayName: 'Clubfund',
        avatarUrl: String(settings.guildAvatar || '').trim(),
      },
    ];
  }, [isWeeklysTracker, settings.guildAvatar]);

  const washRosterMembers = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of washVirtualMembers) map.set(String(m.id), m);
    for (const m of membersPayload.members || []) {
      const id = String(m.id || '').trim();
      if (!id || map.has(id)) continue;
      map.set(id, m);
    }
    return Array.from(map.values());
  }, [membersPayload.members, washVirtualMembers]);

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of washRosterMembers) map.set(String(m.id), m);
    return map;
  }, [washRosterMembers]);
  const excludedRoleSet = useMemo(() => new Set((membersExcludeRoleIds || []).map((x) => String(x || '').trim())), [membersExcludeRoleIds]);

  const filteredMembersForWash = useMemo(() => {
    const list = washRosterMembers;
    if (!excludedRoleSet.size) return list;

    return list.filter((m) => {
      const roles = (m.rolesSorted || m.roles || []) as string[];
      for (const rid of roles) {
        if (excludedRoleSet.has(String(rid))) return false;
      }
      return true;
    });
  }, [excludedRoleSet, washRosterMembers]);

  const [weekEnding, setWeekEnding] = useState<string>(''); // '' = current week
  const [weekData, setWeekData] = useState<WeekPayload | null>(null);
  const [weekErr, setWeekErr] = useState('');
  const [weekLoading, setWeekLoading] = useState(false);
  const [weeklyMembersOpen, setWeeklyMembersOpen] = useState(false);
  const [weeklyMembersLoading, setWeeklyMembersLoading] = useState(false);
  const [weeklyMembersSaving, setWeeklyMembersSaving] = useState(false);
  const [weeklyMembersErr, setWeeklyMembersErr] = useState('');
  const [weeklyActiveMemberIds, setWeeklyActiveMemberIds] = useState<string[]>([]);
  const [weeklyCustomMembers, setWeeklyCustomMembers] = useState<Member[]>([]);
  const allMemberMap = useMemo(() => {
    const map = new Map<string, Member>(memberMap);
    for (const m of weeklyCustomMembers) map.set(String(m.id), {...m, isCustom: true});
    return map;
  }, [memberMap, weeklyCustomMembers]);
  const weeklyActiveSet = useMemo(() => new Set((weeklyActiveMemberIds || []).map((x) => String(x))), [weeklyActiveMemberIds]);
  const weeklyRosterMembers = useMemo(() => {
    const out = new Map<string, Member>();
    for (const m of filteredMembersForWash) out.set(String(m.id), m);
    for (const m of weeklyCustomMembers) out.set(String(m.id), {...m, isCustom: true});
    return Array.from(out.values());
  }, [filteredMembersForWash, weeklyCustomMembers]);
  const weeklyAvailableMembers = useMemo(
    () => weeklyRosterMembers.filter((m) => !weeklyActiveSet.has(String(m.id))),
    [weeklyActiveSet, weeklyRosterMembers]
  );
  const membersForAddModal = useMemo(
    () => (isWeeklysTracker ? weeklyRosterMembers.filter((m) => weeklyActiveSet.has(String(m.id))) : filteredMembersForWash),
    [filteredMembersForWash, isWeeklysTracker, weeklyActiveSet, weeklyRosterMembers]
  );
  const weeklyActiveMembers = useMemo(
    () => weeklyRosterMembers.filter((m) => weeklyActiveSet.has(String(m.id))),
    [weeklyActiveSet, weeklyRosterMembers]
  );

  const [allTotals, setAllTotals] = useState<WashTotalsPayload | null>(null);
  const [totalsErr, setTotalsErr] = useState('');
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [govPayments, setGovPayments] = useState<GovPaymentsPayload | null>(null);
  const [govPaymentsErr, setGovPaymentsErr] = useState('');
  const [govPaymentsLoading, setGovPaymentsLoading] = useState(false);

  // Member history modal
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberErr, setMemberErr] = useState('');
  const [memberHistory, setMemberHistory] = useState<MemberHistoryPayload | null>(null);
  const [memberSelectedId, setMemberSelectedId] = useState('');

  // Add Wash modal
  const [addOpen, setAddOpen] = useState(false);
  const [setWeeklysOpen, setSetWeeklysOpen] = useState(false);
  const [setWeeklysDirty, setSetWeeklysDirty] = useState('');
  const [setWeeklysClean, setSetWeeklysClean] = useState('');
  const [setWeeklysMemberIds, setSetWeeklysMemberIds] = useState<string[]>([]);
  const [setWeeklysErr, setSetWeeklysErr] = useState('');
  const [payWeeklyOpen, setPayWeeklyOpen] = useState(false);
  const [payWeeklyMemberId, setPayWeeklyMemberId] = useState('');
  const [payWeeklyDirty, setPayWeeklyDirty] = useState('');
  const [payWeeklyClean, setPayWeeklyClean] = useState('');
  const [payWeeklyIsEdit, setPayWeeklyIsEdit] = useState(false);
  const [payWeeklyErr, setPayWeeklyErr] = useState('');
  const [govOpen, setGovOpen] = useState(false);
  const [govType, setGovType] = useState<'clean' | 'dirty'>('clean');
  const [govAmount, setGovAmount] = useState('');
  const [govDescription, setGovDescription] = useState('');
  const [govDate, setGovDate] = useState('');
  const [govErr, setGovErr] = useState('');
  const [formMemberId, setFormMemberId] = useState('');
  const [formWashRate, setFormWashRate] = useState<number>(defaultWashRatePct);
  const [formDirty, setFormDirty] = useState('');
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  // Edit mode (re-uses Add Wash modal)
  const [isEditing, setIsEditing] = useState(false);
  const [editEntryId, setEditEntryId] = useState('');

  

  // Confirm "Mark Pending" modal
  const [confirmPendingOpen, setConfirmPendingOpen] = useState(false);
  const [confirmPendingEntryId, setConfirmPendingEntryId] = useState('');

  // Confirm "Delete" modal
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteEntryId, setConfirmDeleteEntryId] = useState('');
  const [weeklyMembersToAdd, setWeeklyMembersToAdd] = useState<string[]>([]);
  const [customDiscordId, setCustomDiscordId] = useState('');
  const [customDisplayName, setCustomDisplayName] = useState('');

  const currentWeekEnding = useMemo(() => weekEndingSundayMelbourne(new Date()), []);
  const dueWeekEnding = useMemo(() => dueWeekEndingSundayMelbourne(new Date()), []);
  const effectiveWeekEnding = weekData?.weekEnding || (weekEnding ? weekEnding : currentWeekEnding);
  const selectedWeekEnding = weekEnding || currentWeekEnding;

  
  const fetchMembers = useCallback(async () => {
    setMembersErr('');
    try {
      const j = await fetchJsonCached<MembersPayload>('/api/members/list', 15_000);
      setMembersPayload(j as MembersPayload);
    } catch (e: any) {
      setMembersErr(e?.message || 'Failed to load members');
      setMembersPayload({});
    }
  }, []);

  const fetchWeek = useCallback(async (targetWeekEnding: string) => {
    setWeekErr('');
    setWeekLoading(true);
    try {
      const qs = targetWeekEnding ? `?weekEnding=${encodeURIComponent(targetWeekEnding)}` : '';
      const weekApiBase = isWeeklysTracker ? '/api/weeklys/week' : '/api/wash/week';
      const res = await previewFetch(`${weekApiBase}${qs}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to load week (${res.status})`);
      setWeekData(j as WeekPayload);
    } catch (e: any) {
      setWeekErr(e?.message || 'Failed to load wash week');
      setWeekData(null);
    } finally {
      setWeekLoading(false);
    }
  }, [isWeeklysTracker, previewFetch]);

  const fetchWeeklysMembers = useCallback(async (targetWeekEnding: string) => {
    if (!isWeeklysTracker) return;
    setWeeklyMembersErr('');
    setWeeklyMembersLoading(true);
    try {
      const qs = targetWeekEnding ? `?weekEnding=${encodeURIComponent(targetWeekEnding)}` : '';
      const res = await previewFetch(`/api/weeklys/members${qs}`);
      const j = (await res.json().catch(() => ({}))) as WeeklysMembersPayload & {error?: string};
      if (!res.ok) throw new Error(j?.error || `Failed to load weekly members (${res.status})`);
      const next = Array.isArray(j?.activeMemberIds) ? j.activeMemberIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
      setWeeklyActiveMemberIds(Array.from(new Set(next)));
      const customs = Array.isArray(j?.customMembers)
        ? j.customMembers
            .map((m: any) => ({
              id: String(m?.id || '').trim(),
              displayName: String(m?.displayName || '').trim(),
              avatarUrl: String(m?.avatarUrl || '').trim(),
              isCustom: true,
            }))
            .filter((m: any) => /^\d{6,25}$/.test(String(m.id)))
        : [];
      setWeeklyCustomMembers(customs);
    } catch (e: any) {
      setWeeklyMembersErr(e?.message || 'Failed to load weekly members');
      setWeeklyActiveMemberIds([]);
      setWeeklyCustomMembers([]);
    } finally {
      setWeeklyMembersLoading(false);
    }
  }, [isWeeklysTracker, previewFetch]);

  const saveWeeklysMembers = async (nextIds: string[]) => {
    if (!canManageWeeklysMembers) {
      setWeeklyMembersErr('You do not have permission to edit weekly members.');
      return;
    }
    setWeeklyMembersErr('');
    setWeeklyMembersSaving(true);
    try {
      const qs = effectiveWeekEnding ? `?weekEnding=${encodeURIComponent(effectiveWeekEnding)}` : '';
      const res = await previewFetch(`/api/weeklys/members${qs}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({activeMemberIds: nextIds}),
      });
      const j = (await res.json().catch(() => ({}))) as WeeklysMembersPayload & {error?: string};
      if (!res.ok) throw new Error(j?.error || `Failed to save weekly members (${res.status})`);
      const saved = Array.isArray(j?.activeMemberIds) ? j.activeMemberIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
      setWeeklyActiveMemberIds(Array.from(new Set(saved)));
      const customs = Array.isArray(j?.customMembers)
        ? j.customMembers
            .map((m: any) => ({
              id: String(m?.id || '').trim(),
              displayName: String(m?.displayName || '').trim(),
              avatarUrl: String(m?.avatarUrl || '').trim(),
              isCustom: true,
            }))
            .filter((m: any) => /^\d{6,25}$/.test(String(m.id)))
        : [];
      setWeeklyCustomMembers(customs);
    } catch (e: any) {
      setWeeklyMembersErr(e?.message || 'Failed to save weekly members');
    } finally {
      setWeeklyMembersSaving(false);
    }
  };

  const fetchAllTotals = useCallback(async () => {
    setTotalsErr('');
    setTotalsLoading(true);
    try {
      const totalsApi = isWeeklysTracker ? '/api/weeklys/totals' : '/api/wash/totals';
      const res = await previewFetch(totalsApi);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to load totals (${res.status})`);
      setAllTotals(j as WashTotalsPayload);
    } catch (e: any) {
      setTotalsErr(e?.message || 'Failed to load totals');
      setAllTotals(null);
    } finally {
      setTotalsLoading(false);
    }
  }, [isWeeklysTracker, previewFetch]);

  const fetchGovPayments = useCallback(async () => {
    if (!isWeeklysTracker) return;
    setGovPaymentsErr('');
    setGovPaymentsLoading(true);
    try {
      const res = await previewFetch('/api/weeklys/payments');
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as any)?.error || `Failed to load GOV payments (${res.status})`);
      setGovPayments(j as GovPaymentsPayload);
    } catch (e: any) {
      setGovPaymentsErr(e?.message || 'Failed to load GOV payments');
      setGovPayments(null);
    } finally {
      setGovPaymentsLoading(false);
    }
  }, [isWeeklysTracker, previewFetch]);

  const reloadMemberHistory = async (memberId: string) => {
    if (!memberId) return;
    setMemberErr('');
    setMemberLoading(true);
    try {
      const memberApiBase = isWeeklysTracker ? '/api/weeklys/member' : '/api/wash/member';
      const res = await previewFetch(`${memberApiBase}?memberId=${encodeURIComponent(memberId)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to load member history (${res.status})`);
      setMemberHistory(j as MemberHistoryPayload);
    } catch (e: any) {
      setMemberErr(e?.message || 'Failed to load member history');
      setMemberHistory(null);
    } finally {
      setMemberLoading(false);
    }
  };

  const openMember = async (memberId: string) => {
    if (memberOpen && memberSelectedId === memberId && memberHistory) return;
    setMemberHistory(null);
    setMemberOpen(true);
    setMemberSelectedId(memberId);
    await reloadMemberHistory(memberId);
  };

  const openGovPayment = () => {
    if (!isWeeklysTracker || !canManageGovPayments) return;
    setGovErr('');
    setGovType('clean');
    setGovAmount('');
    setGovDescription('');
    setGovDate(new Date().toISOString().slice(0, 10));
    setGovOpen(true);
  };

  const saveGovPayment = async () => {
    setGovErr('');
    if (!canManageGovPayments) return setGovErr('You do not have permission to add GOV payments.');
    const amountRaw = String(govAmount || '').replace(/[^0-9]/g, '');
    const description = String(govDescription || '').trim();
    const paymentDate = String(govDate || '').trim();
    if (!amountRaw || Number(amountRaw) <= 0) return setGovErr('Amount must be greater than 0.');
    if (!description) return setGovErr('Description is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return setGovErr('Valid payment date is required.');
    setSaving(true);
    try {
      const res = await previewFetch('/api/weeklys/payments', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          paymentType: govType,
          amount: amountRaw,
          description,
          paymentDate,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to add payment (${res.status})`);
      setGovOpen(false);
      await fetchGovPayments();
    } catch (e: any) {
      setGovErr(e?.message || 'Failed to add payment');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    if (!isWeeklysTracker) return;
    void fetchWeeklysMembers(effectiveWeekEnding);
  }, [effectiveWeekEnding, fetchWeeklysMembers, isWeeklysTracker]);

  useEffect(() => {
    const list = Array.isArray(settings.membersExcludeRoleIds)
      ? settings.membersExcludeRoleIds.map((x: any) => String(x || '').trim()).filter(Boolean)
      : [];
    setMembersExcludeRoleIds(list);
  }, [settings.membersExcludeRoleIds]);

  useEffect(() => {
    // keep week data fresh (used when user switches to week view)
    void fetchWeek(weekEnding);
  }, [fetchWeek, weekEnding]);

  useEffect(() => {
    if (view === 'totals' && !allTotals) void fetchAllTotals();
  }, [allTotals, fetchAllTotals, view]);

  useEffect(() => {
    if (!isWeeklysTracker) return;
    if (view !== 'payments') return;
    if (!govPayments) void fetchGovPayments();
  }, [fetchGovPayments, govPayments, isWeeklysTracker, view]);

  useEffect(() => {
    if (!isWeeklysTracker) return;
    if (view !== 'totals') return;
    if (!govPayments) void fetchGovPayments();
  }, [fetchGovPayments, govPayments, isWeeklysTracker, view]);

  useEffect(() => {
    if (!isWeeklysTracker) return;
    if (!allTotals) void fetchAllTotals();
  }, [allTotals, fetchAllTotals, isWeeklysTracker]);

  useEffect(() => {
    setAllTotals(null);
    void fetchAllTotals();
  }, [fetchAllTotals, isWeeklysTracker]);

  useEffect(() => {
    if (!isWeeklysTracker && view === 'payments') setView('week');
  }, [isWeeklysTracker, view]);

  const onPrevWeek = () => {
    if (view !== 'week') return;
    const next = addDaysYMD(effectiveWeekEnding, -7);
    setWeekEnding(next === currentWeekEnding ? '' : next);
  };

  const onNextWeek = () => {
    if (view !== 'week') return;
    const next = addDaysYMD(effectiveWeekEnding, 7);
    setWeekEnding(next === currentWeekEnding ? '' : next);
  };

  const openAdd = () => {
    if (isWeeklysTracker) {
      if (!canSetWeeklys) return;
      if (weeklyActiveMemberIds.length === 0) return;
      setSetWeeklysErr('');
      setSetWeeklysDirty('0');
      setSetWeeklysClean('0');
      setSetWeeklysMemberIds([...weeklyActiveMemberIds]);
      setSetWeeklysOpen(true);
      void prefillSetWeeklysFromPreviousWeek(selectedWeekEnding, weeklyActiveMemberIds);
      return;
    }
    if (!canAddWash) return;
    setFormErr('');
      setIsEditing(false);
      setEditEntryId('');
    setFormDirty('');
    setFormMemberId(isWeeklysTracker ? String(membersForAddModal[0]?.id || '') : '');
    setFormWashRate(defaultWashRatePct);
    setAddOpen(true);
  };

const openEdit = (entry: any) => {
      if (!entry) return;
      if (!canEditWash) return;
      if (String(entry?.status || '') !== 'collected') return; // UI already disables, extra guard
      setFormErr('');
      setIsEditing(true);
      setEditEntryId(String(entry?.id || '').trim());
      setFormMemberId(String(entry?.memberId || '').trim());
      setFormWashRate(Number(entry?.washRatePct ?? defaultWashRatePct));
      // dirty is stored as cents; convert to dollars string for the input
      const dirtyCents = Number(entry?.dirtyCents || 0) || 0;
      setFormDirty(String(Math.round(dirtyCents / 100)));
      setAddOpen(true);
    };

  const dirtyCents = Math.round((parseMoneyToCents(formDirty) || 0) / 100) * 100;
  const cleanCents = Math.round((calcCleanCents(dirtyCents, Number(formWashRate || 0)) || 0) / 100) * 100;
  const selectedHistoryMember = useMemo(
    () => (memberHistory ? allMemberMap.get(String(memberHistory.memberId)) : undefined),
    [allMemberMap, memberHistory]
  );

  const saveUpsert = async () => {
      setFormErr('');
      if (!formMemberId) return setFormErr('Pick a member.');
      if (dirtyCents <= 0) return setFormErr('Dirty amount must be > 0.');
      const rate = Math.max(0, Math.min(100, Math.floor(Number(formWashRate || 0))));

      setSaving(true);
      try {
        const qs = `?weekEnding=${encodeURIComponent(effectiveWeekEnding)}`;

        if (isEditing) {
          const id = String(editEntryId || '').trim();
          if (!id) throw new Error('Missing entryId for edit');

          const res = await previewFetch(`/api/wash/week${qs}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              entryId: id,
              action: 'edit',
              washRatePct: rate,
              dirtyAmount: formDirty,
            }),
          });

          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || `Failed to edit wash (${res.status})`);
        } else {
          const res = await previewFetch(`/api/wash/week${qs}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              memberId: formMemberId,
              washRatePct: rate,
              dirtyAmount: formDirty,
            }),
          });

          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || `Failed to add wash (${res.status})`);
        }

        setAddOpen(false);
        setIsEditing(false);
        setEditEntryId('');
        const tasks: Promise<any>[] = [fetchWeek(weekEnding)];
        if (view === 'totals' || allTotals) tasks.push(fetchAllTotals());
        if (memberOpen && memberSelectedId) tasks.push(reloadMemberHistory(memberSelectedId));
        await Promise.all(tasks);
      } catch (e: any) {
        setFormErr(e?.message || (isEditing ? 'Failed to edit wash' : 'Failed to add wash'));
      } finally {
        setSaving(false);
      }
    };

  const saveSetWeeklys = async () => {
    setSetWeeklysErr('');
    if (!canSetWeeklys) return setSetWeeklysErr('You do not have permission to set weeklys.');
    const targetIds = Array.from(new Set((setWeeklysMemberIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (!targetIds.length) return setSetWeeklysErr('Select at least one active member.');
    const dirtyRaw = String(setWeeklysDirty || '').replace(/[^0-9]/g, '');
    const cleanRaw = String(setWeeklysClean || '').replace(/[^0-9]/g, '');
    const dirty = dirtyRaw === '' ? '0' : dirtyRaw;
    const clean = cleanRaw === '' ? '0' : cleanRaw;

    setSaving(true);
    try {
      const qs = `?weekEnding=${encodeURIComponent(selectedWeekEnding)}`;
      const res = await previewFetch(`/api/weeklys/week${qs}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'set_weeklys',
          memberIds: targetIds,
          dirtyAmount: dirty,
          cleanAmount: clean,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to set weeklys (${res.status})`);
      setSetWeeklysOpen(false);
      const tasks: Promise<any>[] = [fetchWeek(weekEnding)];
      if (view === 'totals' || allTotals) tasks.push(fetchAllTotals());
      await Promise.all(tasks);
    } catch (e: any) {
      setSetWeeklysErr(e?.message || 'Failed to set weeklys');
    } finally {
      setSaving(false);
    }
  };

  const prefillSetWeeklysFromPreviousWeek = useCallback(async (targetWeekEnding: string, memberIds: string[]) => {
    const ids = Array.from(new Set((memberIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (!targetWeekEnding || ids.length === 0) return;

    const previousWeekEnding = addDaysYMD(targetWeekEnding, -7);
    try {
      const qs = `?weekEnding=${encodeURIComponent(previousWeekEnding)}`;
      const res = await previewFetch(`/api/weeklys/week${qs}`);
      const j = (await res.json().catch(() => ({}))) as WeekPayload & {error?: string};
      if (!res.ok) return;

      const idSet = new Set(ids);
      const previousEntries = Array.isArray(j?.entries)
        ? j.entries.filter((e) => idSet.has(String(e.memberId || '').trim()))
        : [];
      if (previousEntries.length === 0) return;

      const pairCounts = new Map<string, {count: number; dirtyCents: number; cleanCents: number}>();
      for (const e of previousEntries) {
        const dirtyCents = Math.max(0, Math.round(Number(e.dirtyCents || 0)));
        const cleanCents = Math.max(0, Math.round(Number(e.cleanCents || 0)));
        const key = `${dirtyCents}:${cleanCents}`;
        const cur = pairCounts.get(key);
        if (cur) cur.count += 1;
        else pairCounts.set(key, {count: 1, dirtyCents, cleanCents});
      }

      const best = Array.from(pairCounts.values()).sort((a, b) => b.count - a.count || b.dirtyCents - a.dirtyCents)[0];
      if (!best) return;
      setSetWeeklysDirty(String(Math.round(Number(best.dirtyCents || 0) / 100)));
      setSetWeeklysClean(String(Math.round(Number(best.cleanCents || 0) / 100)));
    } catch {
      // no-op prefill fallback
    }
  }, [previewFetch]);

  const openWeeklyPayment = (
    memberId: string,
    _paidDirtyCents = 0,
    _paidCleanCents = 0,
    _expectedDirtyCents = 0,
    _expectedCleanCents = 0
  ) => {
    if (!isWeeklysTracker || !canPayWeeklys) return;
    setPayWeeklyErr('');
    setPayWeeklyMemberId(String(memberId || '').trim());
    setPayWeeklyIsEdit(false);
    setPayWeeklyDirty('');
    setPayWeeklyClean('');
    setPayWeeklyOpen(true);
  };

  const saveWeeklyPayment = async () => {
    setPayWeeklyErr('');
    if (!canPayWeeklys) return setPayWeeklyErr('You do not have permission to manage weekly payments.');
    const memberId = String(payWeeklyMemberId || '').trim();
    if (!memberId) return setPayWeeklyErr('Member is required.');
    const dirty = String(payWeeklyDirty || '').replace(/[^0-9]/g, '');
    const clean = String(payWeeklyClean || '').replace(/[^0-9]/g, '');
    if (!payWeeklyIsEdit && !dirty && !clean) return setPayWeeklyErr('Enter a clean and/or dirty payment amount.');

    setSaving(true);
    try {
      const qs = `?weekEnding=${encodeURIComponent(effectiveWeekEnding)}`;
      const res = await previewFetch(`/api/weeklys/week${qs}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'pay_weeklys',
          memberId,
          dirtyPayment: dirty || '0',
          cleanPayment: clean || '0',
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to save payment (${res.status})`);
      setPayWeeklyOpen(false);
      const tasks: Promise<any>[] = [fetchWeek(weekEnding)];
      if (view === 'totals' || allTotals) tasks.push(fetchAllTotals());
      if (memberOpen && memberSelectedId) tasks.push(reloadMemberHistory(memberSelectedId));
      await Promise.all(tasks);
    } catch (e: any) {
      setPayWeeklyErr(e?.message || 'Failed to save payment');
    } finally {
      setSaving(false);
    }
  };

  
  const setEntryStatus = async (entryId: string, status: 'pending' | 'paid') => {
    try {
      const qs = `?weekEnding=${encodeURIComponent(effectiveWeekEnding)}`;
      const res = await previewFetch(`/api/wash/week${qs}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({entryId, status}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to update status (${res.status})`);

      const tasks: Promise<any>[] = [fetchWeek(weekEnding)];
      if (view === 'totals' || allTotals) tasks.push(fetchAllTotals());
      if (memberOpen && memberSelectedId) tasks.push(reloadMemberHistory(memberSelectedId));
      await Promise.all(tasks);
    } catch (e: any) {
      setWeekErr(e?.message || 'Failed to update status');
    }
  };

  const markAllCollectedPending = async () => {
    if (isWeeklysTracker || !canMarkPending || collectedWeekEntryIds.length === 0) return;
    setWeekErr('');
    setSaving(true);
    try {
      const qs = `?weekEnding=${encodeURIComponent(effectiveWeekEnding)}`;
      await Promise.all(
        collectedWeekEntryIds.map(async (entryId) => {
          const res = await previewFetch(`/api/wash/week${qs}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({entryId, status: 'pending'}),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || `Failed to update status (${res.status})`);
        })
      );

      const tasks: Promise<any>[] = [fetchWeek(weekEnding)];
      if (view === 'totals' || allTotals) tasks.push(fetchAllTotals());
      if (memberOpen && memberSelectedId) tasks.push(reloadMemberHistory(memberSelectedId));
      await Promise.all(tasks);
    } catch (e: any) {
      setWeekErr(e?.message || 'Failed to update all collected entries');
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entryId: string) => {
    if (!entryId) return;
    try {
      const qs = `?weekEnding=${encodeURIComponent(effectiveWeekEnding)}`;
      const res = await previewFetch(`/api/wash/week${qs}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({entryId, action: 'delete'}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to delete (${res.status})`);

      const tasks: Promise<any>[] = [fetchWeek(weekEnding)];
      if (view === 'totals' || allTotals) tasks.push(fetchAllTotals());
      if (memberOpen && memberSelectedId) tasks.push(reloadMemberHistory(memberSelectedId));
      await Promise.all(tasks);
    } catch (e: any) {
      setWeekErr(e?.message || 'Failed to delete');
    }
  };


  const openConfirmPending = (entry: any) => {
    if (!entry) return;
    setConfirmPendingEntryId(String(entry.id || ''));
    setConfirmPendingOpen(true);
  };

  const confirmMarkPending = async () => {
    const id = String(confirmPendingEntryId || '').trim();
    setConfirmPendingOpen(false);
    if (!id) return;
    await setEntryStatus(id, 'pending');
  };

  const openConfirmDelete = (entry: any) => {
    if (!entry) return;
    setConfirmDeleteEntryId(String(entry.id || ''));
    setConfirmDeleteOpen(true);
  };

  const confirmDelete = async () => {
    const id = String(confirmDeleteEntryId || '').trim();
    setConfirmDeleteOpen(false);
    if (!id) return;
    await deleteEntry(id);
  };

  const addWeeklyMember = async () => {
    if (!canManageWeeklysMembers) return;
    const ids = Array.from(new Set((weeklyMembersToAdd || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (ids.length === 0) return;
    const next = Array.from(new Set([...weeklyActiveMemberIds, ...ids]));
    await saveWeeklysMembers(next);
    setWeeklyMembersToAdd([]);
  };

  const removeWeeklyMember = async (memberId: string) => {
    if (!canManageWeeklysMembers) return;
    const id = String(memberId || '').trim();
    if (!id) return;
    const next = weeklyActiveMemberIds.filter((x) => String(x) !== id);
    await saveWeeklysMembers(next);
  };

  const createCustomWeeklyMember = async () => {
    if (!canManageWeeklysMembers) {
      setWeeklyMembersErr('You do not have permission to edit weekly members.');
      return;
    }
    const discordId = String(customDiscordId || '').trim();
    const displayName = String(customDisplayName || '').trim();
    if (!/^\d{6,25}$/.test(discordId)) {
      setWeeklyMembersErr('Enter a valid Discord ID for the custom member.');
      return;
    }
    if (!displayName) {
      setWeeklyMembersErr('Enter a name for the custom member.');
      return;
    }

    setWeeklyMembersErr('');
    setWeeklyMembersSaving(true);
    try {
      const qs = effectiveWeekEnding ? `?weekEnding=${encodeURIComponent(effectiveWeekEnding)}` : '';
      const res = await previewFetch(`/api/weeklys/members${qs}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({discordId, displayName}),
      });
      const j = (await res.json().catch(() => ({}))) as WeeklysMembersPayload & {error?: string};
      if (!res.ok) throw new Error(j?.error || `Failed to create custom member (${res.status})`);
      const customs = Array.isArray(j?.customMembers)
        ? j.customMembers
            .map((m: any) => ({
              id: String(m?.id || '').trim(),
              displayName: String(m?.displayName || '').trim(),
              avatarUrl: String(m?.avatarUrl || '').trim(),
              isCustom: true,
            }))
            .filter((m: any) => /^\d{6,25}$/.test(String(m.id)))
        : [];
      setWeeklyCustomMembers(customs);
      setCustomDiscordId('');
      setCustomDisplayName('');
    } catch (e: any) {
      setWeeklyMembersErr(e?.message || 'Failed to create custom member');
    } finally {
      setWeeklyMembersSaving(false);
    }
  };



  const colCard: React.CSSProperties = {
    border: '2px solid var(--reblas-outline)',
    borderRadius: 14,
    overflow: 'hidden',
    background: 'rgba(0,0,0,0.10)',
  };

  const headerCell: React.CSSProperties = {
    padding: '12px 14px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.03)',
  };

  const rowH = 62;
  const rowBase: React.CSSProperties = {
    height: rowH,
    padding: '6px 12px',
    display: 'flex',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  };

  const stripeBg = 'rgba(255,255,255,0.03)';
  const clearBg = 'transparent';

  const entries = useMemo(() => weekData?.entries || [], [weekData?.entries]);
  const weekTotals = weekData?.totals || {dirtyCents: 0, cleanCents: 0};
  const pageTitle = isWeeklysTracker ? 'Weeklys Tracker' : 'Wash Tracker';
  const weekDisplayRows = useMemo(() => {
    const isSelectedWeekDue = !isWeeklysTracker || effectiveWeekEnding <= dueWeekEnding;
    if (!isWeeklysTracker) {
      return entries.map((e) => ({
        key: String(e.id),
        memberId: String(e.memberId),
        entry: e as WashEntry | null,
        expectedCleanCents: Number(e.cleanCents || 0),
        paidCleanCents:
          Number.isFinite(Number((e as any)?.paidCleanCents))
            ? Number((e as any)?.paidCleanCents || 0)
            : String(e.status || '') === 'paid'
            ? Number(e.cleanCents || 0)
            : 0,
        cleanOutstandingCents:
          (isSelectedWeekDue ? Number(e.cleanCents || 0) : 0) -
          (Number.isFinite(Number((e as any)?.paidCleanCents))
            ? Number((e as any)?.paidCleanCents || 0)
            : String(e.status || '') === 'paid'
            ? Number(e.cleanCents || 0)
            : 0),
        expectedDirtyCents: Number(e.dirtyCents || 0),
        paidDirtyCents:
          Number.isFinite(Number((e as any)?.paidDirtyCents))
            ? Number((e as any)?.paidDirtyCents || 0)
            : String(e.status || '') === 'paid'
            ? Number(e.dirtyCents || 0)
            : 0,
        dirtyOutstandingCents:
          (isSelectedWeekDue ? Number(e.dirtyCents || 0) : 0) -
          (Number.isFinite(Number((e as any)?.paidDirtyCents))
            ? Number((e as any)?.paidDirtyCents || 0)
            : String(e.status || '') === 'paid'
            ? Number(e.dirtyCents || 0)
            : 0),
      }));
    }
    const totalsByMember = new Map<
      string,
      {expectedCleanCents: number; paidCleanCents: number; expectedDirtyCents: number; paidDirtyCents: number}
    >();
    for (const e of entries) {
      const id = String(e.memberId || '').trim();
      if (!id) continue;
      const cur = totalsByMember.get(id) || {
        expectedCleanCents: 0,
        paidCleanCents: 0,
        expectedDirtyCents: 0,
        paidDirtyCents: 0,
      };
      const clean = Number(e.cleanCents || 0);
      const dirty = Number(e.dirtyCents || 0);
      const paidClean = Number.isFinite(Number((e as any)?.paidCleanCents))
        ? Number((e as any)?.paidCleanCents || 0)
        : String(e.status || '') === 'paid'
        ? clean
        : 0;
      const paidDirty = Number.isFinite(Number((e as any)?.paidDirtyCents))
        ? Number((e as any)?.paidDirtyCents || 0)
        : String(e.status || '') === 'paid'
        ? dirty
        : 0;
      cur.expectedCleanCents += clean;
      cur.expectedDirtyCents += dirty;
      cur.paidCleanCents += paidClean;
      cur.paidDirtyCents += paidDirty;
      totalsByMember.set(id, cur);
    }
    return weeklyActiveMemberIds.map((memberId) => ({
      key: String(memberId),
      memberId: String(memberId),
      entry: null,
      expectedCleanCents: totalsByMember.get(String(memberId))?.expectedCleanCents || 0,
      paidCleanCents: totalsByMember.get(String(memberId))?.paidCleanCents || 0,
      cleanOutstandingCents:
        (isSelectedWeekDue ? totalsByMember.get(String(memberId))?.expectedCleanCents || 0 : 0) -
        (totalsByMember.get(String(memberId))?.paidCleanCents || 0),
      expectedDirtyCents: totalsByMember.get(String(memberId))?.expectedDirtyCents || 0,
      paidDirtyCents: totalsByMember.get(String(memberId))?.paidDirtyCents || 0,
      dirtyOutstandingCents:
        (isSelectedWeekDue ? totalsByMember.get(String(memberId))?.expectedDirtyCents || 0 : 0) -
        (totalsByMember.get(String(memberId))?.paidDirtyCents || 0),
    }));
  }, [dueWeekEnding, effectiveWeekEnding, entries, isWeeklysTracker, weeklyActiveMemberIds]);
  const weeklyWeekPaidTotals = useMemo(() => {
    if (!isWeeklysTracker) return {dirtyCents: 0, cleanCents: 0};
    let dirty = 0;
    let clean = 0;
    for (const row of weekDisplayRows as any[]) {
      dirty += Number(row?.paidDirtyCents || 0);
      clean += Number(row?.paidCleanCents || 0);
    }
    return {dirtyCents: dirty, cleanCents: clean};
  }, [isWeeklysTracker, weekDisplayRows]);
  const weekCollectedOrPendingDirtyCents = useMemo(() => {
    if (isWeeklysTracker) return 0;
    let dirty = 0;
    for (const entry of entries) {
      const status = String(entry?.status || '');
      if (status !== 'collected' && status !== 'pending') continue;
      dirty += Number(entry?.dirtyCents || 0);
    }
    return dirty;
  }, [entries, isWeeklysTracker]);
  const collectedWeekEntryIds = useMemo(() => {
    if (isWeeklysTracker) return [] as string[];
    return entries
      .map((entry) => ({
        id: String(entry?.id || '').trim(),
        status: String(entry?.status || ''),
      }))
      .filter((entry) => entry.id && entry.status === 'collected')
      .map((entry) => entry.id);
  }, [entries, isWeeklysTracker]);
  const sortedGovPayments = useMemo(() => {
    const source = govPayments?.entries;
    const list = Array.isArray(source) ? [...source] : [];
    list.sort((a, b) => {
      const ta = Date.parse(String(a.createdAt || ''));
      const tb = Date.parse(String(b.createdAt || ''));
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
    return list;
  }, [govPayments?.entries]);
  const totalsDisplayRows = useMemo<TotalsRow[]>(() => {
    const members = allTotals?.members;
    const source: TotalsRow[] = Array.isArray(members) ? members : [];
    if (!isWeeklysTracker) return source;

    const rowsById = new Map(source.map((row) => [String(row.memberId || ''), row]));
    const ordered: typeof source = [];
    const seen = new Set<string>();

    for (const memberId of weeklyActiveMemberIds) {
      const id = String(memberId || '').trim();
      const row = rowsById.get(id);
      if (!id || !row) continue;
      ordered.push(row);
      seen.add(id);
    }

    for (const row of source) {
      const id = String(row.memberId || '').trim();
      if (seen.has(id)) continue;
      ordered.push(row);
    }

    return ordered;
  }, [allTotals?.members, isWeeklysTracker, weeklyActiveMemberIds]);
  const activeTotalsDisplayRows = useMemo<TotalsRow[]>(() => {
    if (!isWeeklysTracker) return totalsDisplayRows;
    return totalsDisplayRows.filter((row) => weeklyActiveSet.has(String(row.memberId || '').trim()));
  }, [isWeeklysTracker, totalsDisplayRows, weeklyActiveSet]);
  const inactiveTotalsDisplayRows = useMemo<TotalsRow[]>(() => {
    if (!isWeeklysTracker) return [];
    return totalsDisplayRows.filter((row) => !weeklyActiveSet.has(String(row.memberId || '').trim()));
  }, [isWeeklysTracker, totalsDisplayRows, weeklyActiveSet]);

  const renderTotalsCard = (rows: TotalsRow[], sectionTitle?: string, emptyLabel?: string) => (
    <div style={colCard}>
      {sectionTitle ? (
        <div style={{padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)'}}>
          <Text b css={{mb: 0}}>{sectionTitle}</Text>
        </div>
      ) : null}

      <div style={{...headerCell, padding: '10px 0'}}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isWeeklysTracker ? '320px 1fr 1fr 1fr 1fr 1fr 1fr' : '320px 1fr 1fr',
            gap: 0,
            alignItems: 'stretch',
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', height: '100%', padding: '0 14px', gap: 12}}>
            <div style={{width: 28, height: 28}} />
            <Text b css={{mb: 0}}>Members</Text>
          </div>

          {isWeeklysTracker ? (
            <>
              {['Total clean Expected', 'Total Clean Paid', 'Total Dirty Expected', 'Total Dirty Paid', 'Clean Outstanding', 'Dirty Outstanding'].map((label) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    padding: '0 12px',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                    {label}
                  </Text>
                </div>
              ))}
            </>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  padding: '0 12px',
                  borderLeft: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                  Total Dirty
                </Text>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  padding: '0 12px',
                  borderLeft: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                  Total Clean
                </Text>
              </div>
            </>
          )}
        </div>
      </div>

      {totalsLoading ? (
        <div style={{padding: 14}}>
          <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
        </div>
      ) : rows.length === 0 ? (
        <div style={{padding: 14}}>
          <Text size="$sm" css={{opacity: 0.7}}>{emptyLabel || 'No paid wash entries yet.'}</Text>
        </div>
      ) : (
        rows.map((r, idx) => {
          const m = allMemberMap.get(String(r.memberId));
          const bg = idx % 2 === 1 ? stripeBg : clearBg;
          const expectedClean = Number(r.expectedCleanCents || 0);
          const paidClean = Number(r.paidCleanCents || 0);
          const cleanOutstanding = Number(r.cleanOutstandingCents || 0);
          const expectedDirty = Number(r.expectedDirtyCents || 0);
          const paidDirty = Number(r.paidDirtyCents || 0);
          const dirtyOutstanding = Number(r.dirtyOutstandingCents || 0);

          return (
            <div
              key={r.memberId}
              onClick={() => openMember(String(r.memberId))}
              style={{...rowBase, padding: 0, background: bg, cursor: 'pointer'}}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isWeeklysTracker ? '320px 1fr 1fr 1fr 1fr 1fr 1fr' : '320px 1fr 1fr',
                  gap: 0,
                  width: '100%',
                  alignItems: 'stretch',
                }}
              >
                <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', minWidth: 0}}>
                  <Avatar
                    src={m?.avatarUrl || undefined}
                    size="xs"
                    css={{boxShadow: '0 0 0 1px var(--reblas-outline)'}}
                  />
                  <Text b css={{mb: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    {renderMemberName(m, r.memberId)}
                  </Text>
                </div>

                {isWeeklysTracker ? (
                  <>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>{formatCentsWhole(expectedClean)}</Text>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>{formatCentsWhole(paidClean)}</Text>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)'}}>{formatCentsWhole(expectedDirty)}</Text>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)'}}>{formatCentsWhole(paidDirty)}</Text>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0}}>{renderOutstandingCents(cleanOutstanding, formatCentsWhole)}</Text>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0}}>{renderOutstandingCents(dirtyOutstanding, formatCentsWhole)}</Text>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)'}}>{formatCentsWhole(r.dirtyCents)}</Text>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>{formatCentsWhole(r.cleanCents)}</Text>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div style={{padding: 22}}>
      <Card css={glassCardCss}>
        {/* Title ABOVE everything */}
        <Text h3 css={{mb: 0}}>{pageTitle}</Text>
        <Spacer y={0.5} />
        {previewMemberMode ? (
          <>
            <Card css={{p: '$5', mb: '$6', background: 'rgba(120, 70, 0, 0.24)', border: '2px solid var(--reblas-outline)'}}>
              <Text b css={{mb: '$1'}}>Member View Active</Text>
              <Text size="$sm" css={{opacity: 0.86, mb: 0}}>
                Viewing as member {previewMemberId}. Wash and weekly changes made here stay in preview data and are deleted when you exit Member View.
              </Text>
            </Card>
          </>
        ) : null}

        {/* Controls row (swapped): arrows + date text, then Totals/Week */}
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap'}}>
            {/* Left: view buttons ALWAYS at far-left, then either week nav or totals label */}
            <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
              <Button
                auto
                className={view === 'week' ? 'reblas-btn-2' : 'reblas-btn-1'}
                onPress={() => setView('week')}
              >
                Week
              </Button>

              <Button
                auto
                className={view === 'totals' ? 'reblas-btn-2' : 'reblas-btn-1'}
                onPress={() => setView('totals')}
              >
                Totals
              </Button>

              {isWeeklysTracker ? (
                <Button
                  auto
                  className={view === 'payments' ? 'reblas-btn-3' : 'reblas-btn-1'}
                  onPress={() => setView('payments')}
                >
                  Payments
                </Button>
              ) : null}

              {view === 'week' ? (
                <>
                  <Button auto className="reblas-btn-1" onPress={onPrevWeek} aria-label="Previous week">
                    ◀
                  </Button>

                  <div style={{width: 220, display: 'flex', justifyContent: 'center'}}>
                    <Text size="$xl" css={{mb: 0, fontWeight: 900, color: '#3b82f6', textAlign: 'center'}}>
                      {effectiveWeekEnding === currentWeekEnding ? 'Current Week' : formatYmdToDmy(effectiveWeekEnding)}
                    </Text>
                  </div>

                  <Button auto className="reblas-btn-1" onPress={onNextWeek} aria-label="Next week">
                    ▶
                  </Button>
                </>
              ) : view === 'totals' ? (
                <Text size="$sm" css={{opacity: 0.85, mb: 0}}>
                  All-time totals (members who have ever been added)
                </Text>
              ) : (
                <Text size="$sm" css={{opacity: 0.85, mb: 0}}>
                  GOV payment log
                </Text>
              )}
            </div>

            {/* Right: Week totals (week view) OR All-time totals (totals view) */}
              {view === 'week' ? (
                <div style={{display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap'}}>
                  <div style={{display: 'flex', gap: 12, alignItems: 'baseline'}}>
                    {!isWeeklysTracker ? (
                      <div
                        style={{
                          textAlign: 'right',
                          paddingRight: 12,
                          marginRight: 12,
                          borderRight: '1px solid rgba(255,255,255,0.10)',
                        }}
                      >
                        <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                          Pending/Collected Dirty
                        </Text>
                        <Text b css={{mb: 0, color: 'var(--reblas-btn3-color)', whiteSpace: 'nowrap'}}>
                          {formatCentsWhole(weekCollectedOrPendingDirtyCents)}
                        </Text>
                      </div>
                    ) : null}
                    <div
                      style={{
                        textAlign: 'right',
                        paddingRight: 12,
                        marginRight: 12,
                        borderRight: '1px solid rgba(255,255,255,0.10)',
                      }}
                    >
                      <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                        {isWeeklysTracker ? 'Dirty Paid' : 'Week total dirty'}
                      </Text>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)', whiteSpace: 'nowrap'}}>
                        {formatCentsWhole(isWeeklysTracker ? weeklyWeekPaidTotals.dirtyCents : weekTotals.dirtyCents)}
                      </Text>
                    </div>
                    <div style={{textAlign: 'right'}}>
                      <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                        {isWeeklysTracker ? 'Clean Paid' : 'Week total clean'}
                      </Text>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)', whiteSpace: 'nowrap'}}>
                        {formatCentsWhole(isWeeklysTracker ? weeklyWeekPaidTotals.cleanCents : weekTotals.cleanCents)}
                      </Text>
                    </div>
                  </div>

                  {isWeeklysTracker ? (
                    <Button
                      className="reblas-btn-1"
                      auto
                      onPress={() => setWeeklyMembersOpen(true)}
                      disabled={!canManageWeeklysMembers}
                    >
                      Edit Members
                    </Button>
                  ) : null}

                  <Button
                    className="reblas-btn-4"
                    auto
                    onPress={openAdd}
                    disabled={isWeeklysTracker ? !canSetWeeklys || weeklyActiveMemberIds.length === 0 : !canAddWash}
                  >
                    {isWeeklysTracker ? 'Set Weeklys' : 'Add wash'}
                  </Button>
                </div>
              ) : view === 'totals' ? (
                <div style={{display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap'}}>
                  {isWeeklysTracker ? (
                    <div style={{display: 'flex', gap: 12, alignItems: 'baseline'}}>
                      <div
                        style={{
                          textAlign: 'right',
                          paddingRight: 12,
                          marginRight: 12,
                          borderRight: '1px solid rgba(255,255,255,0.10)',
                        }}
                      >
                        <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                          Total Clean Paid
                        </Text>
                        <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)', whiteSpace: 'nowrap'}}>
                          {formatCentsWhole(allTotals?.totals?.totalCleanPaidCents || 0)}
                        </Text>
                      </div>
                      <div style={{textAlign: 'right'}}>
                        <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                          Total Dirty Paid
                        </Text>
                        <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)', whiteSpace: 'nowrap'}}>
                          {formatCentsWhole(allTotals?.totals?.totalDirtyPaidCents || 0)}
                        </Text>
                      </div>
                      <div
                        style={{
                          textAlign: 'right',
                          paddingLeft: 12,
                          marginLeft: 12,
                          borderLeft: '1px solid rgba(255,255,255,0.10)',
                        }}
                      >
                        <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                          Expected Clean Balance
                        </Text>
                        <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)', whiteSpace: 'nowrap'}}>
                          {formatCentsWhole(
                            (Number(allTotals?.totals?.totalCleanPaidCents || 0) || 0) - (Number(govPayments?.totals?.cleanCents || 0) || 0)
                          )}
                        </Text>
                      </div>
                      <div style={{textAlign: 'right'}}>
                        <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                          Expected Dirty Balance
                        </Text>
                        <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)', whiteSpace: 'nowrap'}}>
                          {formatCentsWhole(
                            (Number(allTotals?.totals?.totalDirtyPaidCents || 0) || 0) - (Number(govPayments?.totals?.dirtyCents || 0) || 0)
                          )}
                        </Text>
                      </div>
                    </div>
                  ) : (
                    <div style={{display: 'flex', gap: 12, alignItems: 'baseline'}}>
                      <div
                        style={{
                          textAlign: 'right',
                          paddingRight: 12,
                          marginRight: 12,
                          borderRight: '1px solid rgba(255,255,255,0.10)',
                        }}
                      >
                        <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                          Total dirty
                        </Text>
                        <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)', whiteSpace: 'nowrap'}}>
                          {formatCentsWhole(allTotals?.totals?.dirtyCents || 0)}
                        </Text>
                      </div>
                      <div style={{textAlign: 'right'}}>
                        <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                          Total clean
                        </Text>
                        <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)', whiteSpace: 'nowrap'}}>
                          {formatCentsWhole(allTotals?.totals?.cleanCents || 0)}
                        </Text>
                      </div>
                    </div>
                  )}
                </div>
              ) : view === 'payments' ? (
                <div style={{display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap'}}>
                  <div style={{display: 'flex', gap: 12, alignItems: 'baseline'}}>
                    <div
                      style={{
                        textAlign: 'right',
                        paddingRight: 12,
                        marginRight: 12,
                        borderRight: '1px solid rgba(255,255,255,0.10)',
                      }}
                    >
                      <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                        Total GOV Clean
                      </Text>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)', whiteSpace: 'nowrap'}}>
                        {formatCentsWhole(govPayments?.totals?.cleanCents || 0)}
                      </Text>
                    </div>
                    <div style={{textAlign: 'right'}}>
                      <Text size="$xs" css={{opacity: 0.7, mb: 0, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                        Total GOV Dirty
                      </Text>
                      <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)', whiteSpace: 'nowrap'}}>
                        {formatCentsWhole(govPayments?.totals?.dirtyCents || 0)}
                      </Text>
                    </div>
                  </div>
                  <Button auto className="reblas-btn-3" onPress={openGovPayment} disabled={!canManageGovPayments}>
                    Add Payment
                  </Button>
                </div>
              ) : null}
          </div>



        <Spacer y={0.8} />

        {membersErr ? <Text size="$sm" css={{opacity: 0.8}}>Members load error: {membersErr}</Text> : null}

        {/* TOTALS VIEW (default) */}
          {view === 'totals' ? (
            <>
              {totalsErr ? (
                <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
                  <Text b>Error</Text>
                  <Text size="$sm" css={{opacity: 0.9}}>{totalsErr}</Text>
                </Card>
              ) : null}

              <div style={{overflowX: 'auto'}}>
                <div style={{minWidth: isWeeklysTracker ? 1480 : 980}}>
                  {isWeeklysTracker ? (
                    <div style={{display: 'grid', gap: 16}}>
                      {renderTotalsCard(
                        activeTotalsDisplayRows,
                        `Current Active Members (${activeTotalsDisplayRows.length})`,
                        'No current active members.'
                      )}
                      {renderTotalsCard(inactiveTotalsDisplayRows, 'No Longer Active Members', 'No inactive members with paid weeklys history.')}
                    </div>
                  ) : (
                    renderTotalsCard(totalsDisplayRows)
                  )}
                </div>
              </div>
            </>
          ) : null}

        {/* PAYMENTS VIEW */}
        {view === 'payments' && isWeeklysTracker ? (
          <>
            {govPaymentsErr ? (
              <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
                <Text b>Error</Text>
                <Text size="$sm" css={{opacity: 0.9}}>{govPaymentsErr}</Text>
              </Card>
            ) : null}

            <div style={{overflowX: 'auto'}}>
              <div style={{minWidth: 980}}>
                <div style={colCard}>
                  <div style={{...headerCell, padding: '10px 0'}}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '200px 1fr 200px 200px',
                        gap: 0,
                        alignItems: 'stretch',
                      }}
                    >
                      {['Date', 'Description', 'Clean', 'Dirty'].map((label) => (
                        <div
                          key={label}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: label === 'Description' ? 'flex-start' : 'center',
                            height: '100%',
                            padding: label === 'Description' ? '0 14px' : '0 12px',
                            borderLeft: label === 'Date' ? 'none' : '1px solid rgba(255,255,255,0.08)',
                          }}
                        >
                          <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                            {label}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </div>

                  {govPaymentsLoading ? (
                    <div style={{padding: 14}}>
                      <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
                    </div>
                  ) : !govPayments || sortedGovPayments.length === 0 ? (
                    <div style={{padding: 14}}>
                      <Text size="$sm" css={{opacity: 0.7}}>No GOV payments recorded yet.</Text>
                    </div>
                  ) : (
                    sortedGovPayments.map((p, idx) => {
                      const bg = idx % 2 === 1 ? stripeBg : clearBg;
                      const clean = p.paymentType === 'clean' ? Number(p.amountCents || 0) : 0;
                      const dirty = p.paymentType === 'dirty' ? Number(p.amountCents || 0) : 0;
                      const date = formatDateToDmy(p.createdAt);
                      return (
                        <div key={p.id} style={{...rowBase, padding: 0, background: bg}}>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '200px 1fr 200px 200px',
                              gap: 0,
                              width: '100%',
                              alignItems: 'stretch',
                            }}
                          >
                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px'}}>
                              <Text b css={{mb: 0}}>{date}</Text>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 14px',
                                borderLeft: '1px solid rgba(255,255,255,0.08)',
                                minWidth: 0,
                              }}
                            >
                              <Text
                                b
                                css={{
                                  mb: 0,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  color: govDescriptionColor(p.description),
                                }}
                              >
                                {p.description}
                              </Text>
                            </div>
                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                              <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>{clean > 0 ? formatCentsWhole(clean) : '-'}</Text>
                            </div>
                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                              <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)'}}>{dirty > 0 ? formatCentsWhole(dirty) : '-'}</Text>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {/* WEEK VIEW */}
        {view === 'week' ? (
          <>
            {weekErr ? (
              <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
                <Text b>Error</Text>
                <Text size="$sm" css={{opacity: 0.9}}>{weekErr}</Text>
              </Card>
            ) : null}

            <div style={{overflowX: 'auto'}}>
              <div style={{minWidth: 980}}>
                <div style={colCard}>
                  {/* ONE combined header */}
                  <div style={{...headerCell, padding: '10px 0'}}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isWeeklysTracker ? '320px 1fr 1fr 1fr 1fr 1fr 1fr' : '320px 1fr 1fr 1fr 1fr 190px',
                        gap: 0,
                        alignItems: 'stretch',
                      }}
                    >
                      <div style={{display: 'flex', alignItems: 'center', height: '100%', padding: '0 14px', gap: 12}}>
  <div style={{width: 28, height: 28}} />
  <Text b css={{mb: 0}}>Members</Text>
</div>

                      {isWeeklysTracker ? (
                        <>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Expected Clean
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Clean Paid
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Expected Dirty
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Dirty Paid
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Clean Outstanding
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Dirty Outstanding
                            </Text>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Dirty Collected
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Clean Returned
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Rate
                            </Text>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                            <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                              Status
                            </Text>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              height: '100%',
                              padding: '0 12px',
                              borderLeft: '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            <Button
                              auto
                              flat
                              className="reblas-btn-4"
                              aria-label="Mark all collected as pending"
                              title="Mark all collected as pending"
                              disabled={!canMarkPending || collectedWeekEntryIds.length === 0 || saving}
                              onPress={markAllCollectedPending}
                              css={{minWidth: 0, px: '$8'}}
                            >
                              Mark All Pending
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ONE combined body */}
                  {weekLoading ? (
                    <div style={{padding: 14}}>
                      <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
                    </div>
                  ) : weekDisplayRows.length === 0 ? (
                    <div style={{padding: 14}}>
                      <Text size="$sm" css={{opacity: 0.7}}>
                        {isWeeklysTracker ? 'No members added yet. Use Edit Members to create expectations.' : 'No entries for this week.'}
                      </Text>
                    </div>
                  ) : (
                    weekDisplayRows.map((row, idx) => {
                      const e = row.entry;
                      const m = allMemberMap.get(String(row.memberId));
                      const bg = idx % 2 === 1 ? stripeBg : clearBg;
                      const cleanOutstanding = Number(row.cleanOutstandingCents || 0);
                      const dirtyOutstanding = Number(row.dirtyOutstandingCents || 0);

                      return (
                        <div
                          key={row.key}
                          style={{...rowBase, padding: 0, background: bg, cursor: isWeeklysTracker && canPayWeeklys ? 'pointer' : 'default'}}
                          onClick={
                            isWeeklysTracker && canPayWeeklys
                              ? () =>
                                  openWeeklyPayment(
                                    String(row.memberId),
                                    Number(row.paidDirtyCents || 0),
                                    Number(row.paidCleanCents || 0),
                                    Number(row.expectedDirtyCents || 0),
                                    Number(row.expectedCleanCents || 0)
                                  )
                              : undefined
                          }
                        >
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: isWeeklysTracker ? '320px 1fr 1fr 1fr 1fr 1fr 1fr' : '320px 1fr 1fr 1fr 1fr 190px',
                              gap: 0,
                              width: '100%',
                              alignItems: 'stretch',
                            }}
                          >
                            {/* Member cell */}
                            <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', minWidth: 0}}>
                              <Avatar
                                src={m?.avatarUrl || undefined}
                                size="xs"
                                css={{boxShadow: '0 0 0 1px var(--reblas-outline)'}}
                              />
                              <Text b css={{mb: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                {renderMemberName(m, row.memberId)}
                              </Text>
                            </div>

                            {isWeeklysTracker ? (
                              <>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>{formatCentsWhole(row.expectedCleanCents || 0)}</Text>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>
                                    {formatCentsWhole(row.paidCleanCents || 0)}
                                  </Text>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)'}}>{formatCentsWhole(row.expectedDirtyCents || 0)}</Text>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)'}}>
                                    {formatCentsWhole(row.paidDirtyCents || 0)}
                                  </Text>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0}}>{renderOutstandingCents(cleanOutstanding, formatCentsWhole)}</Text>
                                </div>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0}}>{renderOutstandingCents(dirtyOutstanding, formatCentsWhole)}</Text>
                                </div>
                              </>
                            ) : (
                              <>
                                {!e ? null : (
                                  <>
                                {/* Dirty */}
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)'}}>{formatCentsWhole(e.dirtyCents)}</Text>
                                </div>

                                {/* Clean */}
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>{formatCentsWhole(e.cleanCents)}</Text>
                                </div>

                                {/* Rate */}
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text b css={{mb: 0, color: 'var(--reblas-btn1-color)'}}>{e.washRatePct}%</Text>
                                </div>

                                {/* Status */}
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                                  <Text
                                    b
                                    css={{
                                      mb: 0,
                                      color:
                                        e.status === 'paid'
                                          ? 'var(--reblas-btn2-color)'
                                          : e.status === 'pending'
                                          ? 'var(--reblas-btn4-color)'
                                          : 'var(--reblas-btn3-color)',
                                    }}
                                  >
                                    {e.status === 'paid' ? (<span style={{display:'inline-flex', alignItems:'center', gap:8}}><GiPayMoney size={18} /> PAID</span>) : e.status === 'pending' ? (<span style={{display:'inline-flex', alignItems:'center', gap:8}}><MdOutlinePendingActions size={18} /> PENDING</span>) : (<span style={{display:'inline-flex', alignItems:'center', gap:8}}><GiReceiveMoney size={18} /> COLLECTED</span>)}
                                  </Text>
                                </div>

                                {/* Buttons */}
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    gap: 8,
                                    alignItems: 'center',
                                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                                    padding: '0 12px',
                                  }}
                                >
                                  <Button
                                    auto
                                    className="reblas-btn-1"
                                    aria-label="Edit"
                                    title="Edit"
                                    css={{minWidth: 36, width: 36, padding: 0}}
                                    disabled={e.status !== 'collected' || !canEditWash}
                                    onPress={() => openEdit(e)}
                                  >
                                    <FaEdit size={20} />
                                  </Button>

                                  <Button
                                    auto
                                    className="reblas-btn-3"
                                    aria-label="Delete"
                                    title="Delete"
                                    css={{minWidth: 36, width: 36, padding: 0}}
                                    disabled={e.status !== 'collected' || !canDeleteWash}
                                    onPress={() => openConfirmDelete(e)}
                                  >
                                    <MdDelete size={20} />
                                  </Button>

                                  <Button
                                    auto
                                    className="reblas-btn-4"
                                    aria-label="Mark Pending"
                                    title="Mark Pending"
                                    css={{minWidth: 36, width: 36, padding: 0}}
                                    disabled={e.status !== 'collected' || !canMarkPending}
                                    onPress={() => openConfirmPending(e)}
                                  >
                                    <MdOutlinePendingActions size={20} />
                                  </Button>

                                  <Button
                                    auto
                                    className="reblas-btn-2"
                                    aria-label="Mark Paid"
                                    title="Mark Paid"
                                    css={{minWidth: 36, width: 36, padding: 0}}
                                    disabled={e.status !== 'pending' || !canMarkPaid}
                                    onPress={() => { const id = String(e?.id || '').trim(); if (!id) return; setEntryStatus(id, 'paid'); }}
                                  >
                                    <MdPaid size={20} />
                                  </Button>
                                </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}


      </Card>

      <MemberHistoryModal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        memberErr={memberErr}
        memberLoading={memberLoading}
        memberHistory={memberHistory}
        memberName={renderMemberName(selectedHistoryMember, memberHistory?.memberId || '')}
        memberAvatarUrl={selectedHistoryMember?.avatarUrl}
        formatCentsWhole={formatCentsWhole}
        isWeeklysTracker={isWeeklysTracker}
      />
            
      {/* Confirm pending modal */}
      <Modal
        closeButton
        blur
        aria-label="Confirm pending"
        open={confirmPendingOpen}
        onClose={() => setConfirmPendingOpen(false)}
        width="560px"
        css={{
          background: 'rgba(0,0,0,0.22)',
          border: '2px solid var(--reblas-outline)',
          backdropFilter: 'blur(14px)',
          borderRadius: 14,
        }}
      >
        <Modal.Header>
          <Text b css={{mb: 0}}>Mark Pending</Text>
        </Modal.Header>

        <Modal.Body>
          <Text size="$sm" css={{opacity: 0.9, mb: 0}}>
            Marking this as pending means the dirty has been handed over, This will lock the transaction from edits.
          </Text>
        </Modal.Body>

        <Modal.Footer>
          <Button className="reblas-btn-1" auto onPress={() => setConfirmPendingOpen(false)}>
            Cancel
          </Button>
          <Button className="reblas-btn-4" auto onPress={confirmMarkPending}>
            Confirm
          </Button>
        </Modal.Footer>
      </Modal>


      {/* Confirm delete modal */}
      <Modal
        closeButton
        blur
        aria-label="Confirm delete"
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        width="560px"
        css={{
          background: 'rgba(0,0,0,0.22)',
          border: '2px solid var(--reblas-outline)',
          backdropFilter: 'blur(14px)',
          borderRadius: 14,
        }}
      >
        <Modal.Header>
          <Text b css={{mb: 0}}>Delete transaction</Text>
        </Modal.Header>

        <Modal.Body>
          <Text size="$sm" css={{opacity: 0.9, mb: 0}}>
            This will permanently delete this wash transaction from all pages.
          </Text>
        </Modal.Body>

        <Modal.Footer>
          <Button className="reblas-btn-1" auto onPress={() => setConfirmDeleteOpen(false)}>
            Cancel
          </Button>
          <Button className="reblas-btn-3" auto onPress={confirmDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>

      {isWeeklysTracker ? (
        <Modal
          closeButton
          blur
          aria-label="Edit weekly members"
          open={weeklyMembersOpen}
          onClose={() => setWeeklyMembersOpen(false)}
          width="760px"
          css={{
            background: 'rgba(0,0,0,0.22)',
            border: '2px solid var(--reblas-outline)',
            backdropFilter: 'blur(14px)',
            borderRadius: 14,
          }}
        >
          <Modal.Header>
            <Text b css={{mb: 0}}>Edit Members</Text>
          </Modal.Header>
          <Modal.Body>
            <Text size="$sm" css={{opacity: 0.85, mb: 0}}>
              Added members stay in expectations until removed. Removing a member does not delete historical totals.
            </Text>
            {weeklyMembersErr ? <Text size="$sm" css={{opacity: 0.9}}>{weeklyMembersErr}</Text> : null}
            <div style={{display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap'}}>
                <Dropdown>
                <Dropdown.Trigger>
                  <Button auto className="reblas-btn-1" disabled={weeklyMembersSaving || weeklyAvailableMembers.length === 0}>
                    {weeklyMembersSaving
                      ? 'Saving…'
                      : weeklyMembersToAdd.length > 0
                      ? `${weeklyMembersToAdd.length} selected`
                      : 'Select members'}
                  </Button>
                </Dropdown.Trigger>
                <Dropdown.Menu
                  aria-label="Available members"
                  selectionMode="multiple"
                  selectedKeys={new Set(weeklyMembersToAdd)}
                  onSelectionChange={(keys: any) => {
                    const selected = Array.from(keys as Set<string>).map((k) => String(k || '').trim()).filter(Boolean);
                    setWeeklyMembersToAdd(selected);
                  }}
                >
                  {weeklyAvailableMembers.map((m) => (
                    <Dropdown.Item key={m.id} textValue={displayNameOf(m)}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                        <Avatar
                          src={m.avatarUrl || undefined}
                          size="sm"
                          css={{boxShadow: '0 0 0 1px var(--reblas-outline)', minWidth: 24, width: 24, height: 24}}
                        />
                        <span>{renderMemberName(m, m.id)}</span>
                      </div>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
              <Button
                auto
                className="reblas-btn-4"
                onPress={addWeeklyMember}
                disabled={weeklyMembersSaving || weeklyMembersToAdd.length === 0}
              >
                Add Members
              </Button>
            </div>
            <Card css={{p: '$6', background: 'rgba(0,0,0,0.2)', border: '2px solid var(--reblas-outline)'}}>
              <Text size="$xs" css={{opacity: 0.75, mb: '$4', letterSpacing: '0.08em', textTransform: 'uppercase'}}>
                Add Custom Member (No Longer In Discord)
              </Text>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end'}}>
                <Input
                  bordered
                  fullWidth
                  label="Discord ID"
                  aria-label="Custom member Discord ID"
                  placeholder="e.g. 123456789012345678"
                  value={customDiscordId}
                  onChange={(e) => setCustomDiscordId(String(e.target.value || '').replace(/[^0-9]/g, ''))}
                />
                <Input
                  bordered
                  fullWidth
                  label="Member Name"
                  aria-label="Custom member name"
                  placeholder="e.g. Old Crew Member"
                  value={customDisplayName}
                  onChange={(e) => setCustomDisplayName(String(e.target.value || '').slice(0, 64))}
                />
                <Button
                  auto
                  className="reblas-btn-2"
                  onPress={createCustomWeeklyMember}
                  disabled={weeklyMembersSaving || !customDiscordId || !customDisplayName}
                >
                  Create
                </Button>
              </div>
              <Text size="$xs" css={{opacity: 0.65, mt: '$4', mb: 0}}>
                Avatar is fetched from Discord using your bot token when possible.
              </Text>
            </Card>
            <Card css={{p: '$7', background: 'rgba(0,0,0,0.2)', border: '2px solid var(--reblas-outline)'}}>
              {weeklyMembersLoading ? (
                <Text size="$sm" css={{opacity: 0.75, mb: 0}}>Loading members…</Text>
              ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                  {weeklyRosterMembers.map((member) => {
                    const id = String(member.id);
                    const active = weeklyActiveSet.has(id);
                    const m = allMemberMap.get(String(id));
                    return (
                      <div
                        key={id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '6px 10px',
                          borderRadius: 12,
                          border: '1px solid rgba(255,255,255,0.2)',
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <div style={{display: 'flex', alignItems: 'center', gap: 8, minWidth: 0}}>
                          <Avatar
                            src={m?.avatarUrl || undefined}
                            size="xs"
                            css={{boxShadow: '0 0 0 1px var(--reblas-outline)', minWidth: 20, width: 20, height: 20}}
                          />
                          <Text size="$sm" css={{mb: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {renderMemberName(m, id)}
                          </Text>
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              color: active ? 'var(--reblas-btn2-color)' : 'var(--reblas-btn3-color)',
                              border: `1px solid ${active ? 'var(--reblas-btn2-color)' : 'var(--reblas-btn3-color)'}`,
                              borderRadius: 999,
                              padding: '2px 8px',
                              lineHeight: 1.2,
                            }}
                          >
                            {active ? 'Active' : 'Removed'}
                          </span>
                          {active ? (
                            <button
                              type="button"
                              onClick={() => void removeWeeklyMember(id)}
                              disabled={weeklyMembersSaving}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--reblas-btn3-color)',
                                cursor: 'pointer',
                                fontWeight: 700,
                                padding: 0,
                              }}
                              aria-label={`Remove ${displayNameOf(m) || id}`}
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {weeklyRosterMembers.length === 0 ? (
                    <Text size="$sm" css={{opacity: 0.75, mb: 0}}>No members available.</Text>
                  ) : null}
                </div>
              )}
            </Card>
          </Modal.Body>
          <Modal.Footer>
            <Button className="reblas-btn-1" auto onPress={() => setWeeklyMembersOpen(false)}>
              Close
            </Button>
          </Modal.Footer>
        </Modal>
      ) : null}

      {isWeeklysTracker ? (
        <Modal
          closeButton
          blur
          aria-label="Set weeklys"
          open={setWeeklysOpen}
          onClose={() => setSetWeeklysOpen(false)}
          width="620px"
          css={{
            background: 'rgba(0,0,0,0.22)',
            border: '2px solid var(--reblas-outline)',
            backdropFilter: 'blur(14px)',
            borderRadius: 14,
          }}
        >
          <Modal.Header>
            <Text b css={{mb: 0}}>Set Weeklys</Text>
          </Modal.Header>
          <Modal.Body>
            <Text size="$sm" css={{opacity: 0.85, mb: 0}}>
              Select active members, then set clean and dirty amounts for this selected week only.
            </Text>
            {setWeeklysErr ? (
              <Text size="$sm" css={{opacity: 0.9, color: 'var(--reblas-btn3-color)', mb: 0}}>
                {setWeeklysErr}
              </Text>
            ) : null}
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
              <Dropdown>
                <Dropdown.Trigger>
                  <Button auto className="reblas-btn-1" disabled={saving || weeklyActiveMembers.length === 0}>
                    {setWeeklysMemberIds.length > 0 ? `${setWeeklysMemberIds.length} members selected` : 'Select active members'}
                  </Button>
                </Dropdown.Trigger>
                <Dropdown.Menu
                  aria-label="Set weeklys members"
                  selectionMode="multiple"
                  selectedKeys={new Set(setWeeklysMemberIds)}
                  onSelectionChange={(keys: any) => {
                    const selected = Array.from(keys as Set<string>).map((k) => String(k || '').trim()).filter(Boolean);
                    setSetWeeklysMemberIds(selected);
                  }}
                >
                  {weeklyActiveMembers.map((m) => (
                    <Dropdown.Item key={m.id} textValue={displayNameOf(m)}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                        <Avatar
                          src={m.avatarUrl || undefined}
                          size="sm"
                          css={{boxShadow: '0 0 0 1px var(--reblas-outline)', minWidth: 24, width: 24, height: 24}}
                        />
                        <span>{renderMemberName(m, m.id)}</span>
                      </div>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
              <div />
              <Input
                bordered
                fullWidth
                label="Clean amount"
                aria-label="Weekly clean amount"
                placeholder="e.g. 750"
                value={setWeeklysClean}
                onChange={(e) => setSetWeeklysClean(String(e.target.value || '').replace(/[^0-9]/g, ''))}
              />
              <Input
                bordered
                fullWidth
                label="Dirty amount"
                aria-label="Weekly dirty amount"
                placeholder="e.g. 1000"
                value={setWeeklysDirty}
                onChange={(e) => setSetWeeklysDirty(String(e.target.value || '').replace(/[^0-9]/g, ''))}
              />
            </div>
            <Text size="$xs" css={{opacity: 0.7, mb: 0}}>
              Active members targeted: <b>{setWeeklysMemberIds.length}</b>
            </Text>
          </Modal.Body>
          <Modal.Footer>
            <Button className="reblas-btn-1" auto onPress={() => setSetWeeklysOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="reblas-btn-2" auto onPress={saveSetWeeklys} disabled={saving || setWeeklysMemberIds.length === 0}>
              {saving ? 'Saving…' : 'Apply'}
            </Button>
          </Modal.Footer>
        </Modal>
      ) : null}

      {isWeeklysTracker ? (
        <Modal
          closeButton
          blur
          aria-label="Add member payment"
          open={payWeeklyOpen}
          onClose={() => setPayWeeklyOpen(false)}
          width="620px"
          css={{
            background: 'rgba(0,0,0,0.22)',
            border: '2px solid var(--reblas-outline)',
            backdropFilter: 'blur(14px)',
            borderRadius: 14,
          }}
        >
          <Modal.Header>
            <Text b css={{mb: 0}}>Member Payment</Text>
          </Modal.Header>
          <Modal.Body>
            <Text size="$sm" css={{opacity: 0.85, mb: 0}}>
              Member: <b>{displayNameOf(allMemberMap.get(payWeeklyMemberId)) || payWeeklyMemberId}</b>
            </Text>
            <Text size="$xs" css={{opacity: 0.7, mb: 0}}>
              Payments apply to the oldest outstanding weeks first, then this week, then future weeks. Future weeks inherit the previous weekly amount unless manually changed.
            </Text>
            {payWeeklyErr ? (
              <Text size="$sm" css={{opacity: 0.9, color: 'var(--reblas-btn3-color)', mb: 0}}>
                {payWeeklyErr}
              </Text>
            ) : null}
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
              <Input
                bordered
                fullWidth
                label="Clean Payment"
                aria-label="Clean payment"
                placeholder="e.g. 500"
                value={payWeeklyClean}
                onChange={(e) => setPayWeeklyClean(String(e.target.value || '').replace(/[^0-9]/g, ''))}
              />
              <Input
                bordered
                fullWidth
                label="Dirty Payment"
                aria-label="Dirty payment"
                placeholder="e.g. 500"
                value={payWeeklyDirty}
                onChange={(e) => setPayWeeklyDirty(String(e.target.value || '').replace(/[^0-9]/g, ''))}
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button className="reblas-btn-1" auto onPress={() => setPayWeeklyOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="reblas-btn-2" auto onPress={saveWeeklyPayment} disabled={saving}>
              {saving ? 'Saving…' : 'Apply Payment'}
            </Button>
          </Modal.Footer>
        </Modal>
      ) : null}

      {isWeeklysTracker ? (
        <Modal
          closeButton
          blur
          aria-label="Add GOV payment"
          open={govOpen}
          onClose={() => setGovOpen(false)}
          width="620px"
          css={{
            background: 'rgba(0,0,0,0.22)',
            border: '2px solid var(--reblas-outline)',
            backdropFilter: 'blur(14px)',
            borderRadius: 14,
          }}
        >
          <Modal.Header>
            <Text b css={{mb: 0}}>Add GOV Payment</Text>
          </Modal.Header>
          <Modal.Body>
            {govErr ? (
              <Text size="$sm" css={{opacity: 0.9, color: 'var(--reblas-btn3-color)', mb: 0}}>
                {govErr}
              </Text>
            ) : null}
            <div style={{display: 'flex', gap: 10}}>
              <Button auto className={govType === 'clean' ? 'reblas-btn-2' : 'reblas-btn-1'} onPress={() => setGovType('clean')}>
                Clean
              </Button>
              <Button auto className={govType === 'dirty' ? 'reblas-btn-4' : 'reblas-btn-1'} onPress={() => setGovType('dirty')}>
                Dirty
              </Button>
            </div>
            <Input
              bordered
              fullWidth
              type="date"
              label="Payment Date"
              aria-label="GOV payment date"
              value={govDate}
              onChange={(e) => setGovDate(String(e.target.value || ''))}
            />
            <Input
              bordered
              fullWidth
              label="Amount"
              aria-label="GOV payment amount"
              placeholder="e.g. 500000"
              value={govAmount}
              onChange={(e) => setGovAmount(String(e.target.value || '').replace(/[^0-9]/g, ''))}
            />
            <Input
              bordered
              fullWidth
              label="Description"
              aria-label="GOV payment description"
              placeholder="Add description"
              value={govDescription}
              onChange={(e) => setGovDescription(String(e.target.value || '').slice(0, 120))}
            />
            <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
              <Button auto className="reblas-btn-1" onPress={() => setGovDescription('Rent')}>
                Rent
              </Button>
              <Button auto className="reblas-btn-1" onPress={() => setGovDescription('Blueprint Tax')}>
                Blueprint Tax
              </Button>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button className="reblas-btn-1" auto onPress={() => setGovOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="reblas-btn-3" auto onPress={saveGovPayment} disabled={saving}>
              {saving ? 'Saving…' : 'Add Payment'}
            </Button>
          </Modal.Footer>
        </Modal>
      ) : null}

      <AddWashModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        isWeeklysTracker={isWeeklysTracker}
        isEditing={isEditing}
        formErr={formErr}
        filteredMembersForWash={membersForAddModal}
        displayNameOf={displayNameOf}
        formMemberId={formMemberId}
        setFormMemberId={setFormMemberId}
        formWashRate={formWashRate}
        setFormWashRate={setFormWashRate}
        formDirty={formDirty}
        setFormDirty={setFormDirty}
        dirtyCents={dirtyCents}
        cleanCents={cleanCents}
        formatCentsWhole={formatCentsWhole}
        saving={saving}
        saveUpsert={saveUpsert}
      />

    </div>
  );
};

const WashTracker: NextPage = () => {
  const router = useRouter();
  const {settings, loading} = useGuildSettings();
  const isWeeklysTracker = router.pathname === '/weeklys-tracker';

  if (loading) return null;

  if (settings.viewerRole === 'subcrew') {
    if (isWeeklysTracker) return null;
    return <SubCrewWashTracker />;
  }

  return <MainWashTracker />;
};

export default WashTracker;
