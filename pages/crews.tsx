import type {NextPage} from 'next';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Avatar, Button, Card, Spacer, Text} from '@nextui-org/react';
import {useRouter} from 'next/router';
import {useSession} from 'next-auth/react';
import {useGuildSettings} from '../lib/guild-settings';
import {fetchJsonCached, invalidateJsonCache} from '../lib/client/request-cache';
import {resolveOrderPermissions} from '../lib/order-permissions';
import {useOwnerPreviewMode} from '../lib/client/owner-preview';
import {buildOwnerPreviewHeaders} from '../lib/owner-preview';

type CrewMember = {
  id: string;
  displayName?: string;
  nick?: string;
  globalName?: string;
  username?: string;
  avatarUrl?: string;
};

type CrewOverview = {
  id: string;
  kind: 'main' | 'subcrew';
  name: string;
  guildId: string;
  outlineColor: string;
  members: CrewMember[];
  memberCount: number;
  washLog: Array<{
    id: string;
    label?: string;
    date?: string;
    description?: string;
    dirtyCents: number;
    washRatePct?: number;
    cleanCents?: number;
    status?: 'collected' | 'pending' | 'paid';
    entryCount?: number;
    createdAt: string;
  }>;
  washTotalDirtyCents: number;
  washCollectedDirtyCents: number;
  washCleanReturnedCents: number;
  orderUsedCents: number;
  ordersCount: number;
};

type Payload = {
  crews: CrewOverview[];
};

type ItemRecord = {
  id: string;
  name: string;
  description: string;
  category?: 'mats' | 'orders';
  imageUrl?: string;
  dirtyWashRequirementCents: number;
  cleanCashCents: number;
  dirtyCashCents: number;
  materials: Array<{matId: string; quantity: number}>;
  active: boolean;
};

type CrewOrderLine = {
  itemId: string;
  itemName: string;
  itemImageUrl?: string;
  unitDirtyWashRequirementCents: number;
  unitCleanCashCents: number;
  unitDirtyCashCents: number;
  materials: Array<{matId: string; matName: string; quantity: number}>;
  quantity: number;
  totalDirtyWashRequirementCents: number;
  totalCleanCashCents: number;
  totalDirtyCashCents: number;
};

type CrewOrder = {
  id: string;
  crewId: string;
  itemId: string;
  itemName: string;
  itemImageUrl?: string;
  unitDirtyWashRequirementCents: number;
  unitCleanCashCents: number;
  unitDirtyCashCents: number;
  materials: Array<{matId: string; matName: string; quantity: number}>;
  quantity: number;
  totalDirtyWashRequirementCents: number;
  totalCleanCashCents: number;
  totalDirtyCashCents: number;
  lines: CrewOrderLine[];
  note: string;
  status: 'placed' | 'pending' | 'completed' | 'cancelled';
  cancelReason: string;
  cancelledAt: string;
  cancelledBy: string;
  createdAt: string;
  createdBy: string;
};

type OrderCartLine = {
  itemId: string;
  quantity: number;
};

type CrewOrdersPayload = {
  crewId: string;
  items: ItemRecord[];
  orders: CrewOrder[];
  embedSent?: boolean;
  embedError?: string;
  totals: {
    orderCount: number;
    openCount: number;
    totalDirtyWashRequirementCents: number;
    totalCleanCashCents: number;
    totalDirtyCashCents: number;
  };
};

type CrewWashEntry = {
  id: string;
  date: string;
  dirtyCents: number;
  washRatePct: number;
  cleanCents: number;
  status: 'collected' | 'pending' | 'paid';
  createdAt: string;
};

type CrewWashPayload = {
  crewId: string;
  crewName: string;
  transactions: CrewWashEntry[];
  totals: {
    dirtyCollectedCents: number;
    cleanReturnedCents: number;
    orderUsedCents: number;
    availableDirtyCents: number;
    entryCount: number;
    collectedCount: number;
    pendingCount: number;
    paidCount: number;
  };
};

const CREWS_OVERVIEW_URL = '/api/crews/overview';

function crewOrdersUrl(crewId: string) {
  return `/api/crews/orders?crewId=${encodeURIComponent(crewId)}`;
}

function crewWashUrl(crewId: string) {
  return `/api/subcrews/wash?crewId=${encodeURIComponent(crewId)}`;
}

const glassCardCss = {
  p: '$10',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

function displayNameOf(member?: CrewMember) {
  return String(member?.displayName || member?.nick || member?.globalName || member?.username || member?.id || '');
}

function formatCentsWhole(cents: number) {
  const n = Math.round(Number(cents || 0) / 100);
  return n.toLocaleString();
}

function formatDateToDmy(raw: string) {
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(raw || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatDateTime(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw || '');
  return d.toLocaleString();
}

function formatMaterials(materials: Array<{matName?: string; matId: string; quantity: number}>) {
  if (!Array.isArray(materials) || materials.length === 0) return 'None';
  return materials.map((entry) => `${entry.matName || entry.matId} x${entry.quantity}`).join(', ');
}

function normalizeOrderLines(order: CrewOrder) {
  if (Array.isArray(order.lines) && order.lines.length > 0) return order.lines;
  return [
    {
      itemId: order.itemId,
      itemName: order.itemName,
      itemImageUrl: order.itemImageUrl || '',
      unitDirtyWashRequirementCents: order.unitDirtyWashRequirementCents,
      unitCleanCashCents: order.unitCleanCashCents,
      unitDirtyCashCents: order.unitDirtyCashCents,
      materials: order.materials || [],
      quantity: order.quantity,
      totalDirtyWashRequirementCents: order.totalDirtyWashRequirementCents,
      totalCleanCashCents: order.totalCleanCashCents,
      totalDirtyCashCents: order.totalDirtyCashCents,
    },
  ];
}

function melbourneDateInputValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function statusColor(status: CrewWashEntry['status']) {
  if (status === 'paid') return 'var(--reblas-btn2-color)';
  if (status === 'pending') return 'var(--reblas-btn4-color)';
  return 'var(--reblas-btn1-color)';
}

function statusLabel(status: CrewWashEntry['status']) {
  if (status === 'paid') return 'Paid';
  if (status === 'pending') return 'Pending';
  return 'Collected';
}

function orderStatusColor(status: CrewOrder['status']) {
  if (status === 'completed') return 'var(--reblas-btn2-color)';
  if (status === 'pending') return 'var(--reblas-btn4-color)';
  if (status === 'cancelled') return 'var(--reblas-btn3-color)';
  return 'var(--reblas-btn1-color)';
}

function orderStatusLabel(status: CrewOrder['status']) {
  if (status === 'completed') return 'Completed';
  if (status === 'pending') return 'Pending';
  if (status === 'cancelled') return 'Cancelled';
  return 'Placed';
}

const CrewsPage: NextPage = () => {
  const router = useRouter();
  const {data: session} = useSession();
  const {settings, loading: settingsLoading} = useGuildSettings();
  const myId = String((session as any)?.discordId || '').trim();
  const {previewMemberMode, previewMemberId, effectiveDiscordId} = useOwnerPreviewMode(settings, myId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [activeCrewId, setActiveCrewId] = useState('main');
  const [activeSubTab, setActiveSubTab] = useState<'members' | 'wash' | 'orders'>('members');
  const [ordersPayload, setOrdersPayload] = useState<CrewOrdersPayload | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersErr, setOrdersErr] = useState('');
  const [washPayload, setWashPayload] = useState<CrewWashPayload | null>(null);
  const [washLoading, setWashLoading] = useState(false);
  const [washErr, setWashErr] = useState('');
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [washModalOpen, setWashModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [orderDraft, setOrderDraft] = useState<{
    selectedItemId: string;
    selectedQuantity: string;
    note: string;
    cart: OrderCartLine[];
  }>({
    selectedItemId: '',
    selectedQuantity: '1',
    note: '',
    cart: [],
  });
  const [washDraft, setWashDraft] = useState<{date: string; dirty: string; washRate: string}>({
    date: melbourneDateInputValue(),
    dirty: '',
    washRate: String(Math.max(0, Math.min(100, Math.floor(Number(settings.defaultWashRatePct ?? 25))))),
  });
  const orderPermissions = useMemo(
    () => resolveOrderPermissions(settings, effectiveDiscordId),
    [effectiveDiscordId, settings]
  );
  const previewHeaders = useMemo(
    () => buildOwnerPreviewHeaders(previewMemberMode, previewMemberId),
    [previewMemberId, previewMemberMode]
  );
  const previewFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      for (const [key, value] of Object.entries(previewHeaders)) headers.set(key, value);
      return fetch(input, {...init, headers});
    },
    [previewHeaders]
  );
  const canViewOrders = orderPermissions.canViewOrders;
  const canPlaceOrders = orderPermissions.canPlaceOrders;
  const canManageOrders = orderPermissions.canManageOrders;
  const canCancelOrders = orderPermissions.canCancelOrders;

  useEffect(() => {
    if (settingsLoading) return;
    const accessMode = settings.dashboardAccessMode || 'none';
    if (accessMode !== 'owner' && accessMode !== 'subcrew' && accessMode !== 'main') {
      router.replace('/job-tracking');
    }
  }, [router, settings.dashboardAccessMode, settingsLoading]);

  useEffect(() => {
    if (settingsLoading) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const next = await fetchJsonCached<Payload>(CREWS_OVERVIEW_URL, 10_000);
        setPayload(next);
        if (Array.isArray(next.crews) && next.crews.length > 0) {
          setActiveCrewId((current) =>
            next.crews.some((crew) => crew.id === current) ? current : String(next.crews[0].id || 'main')
          );
        }
      } catch (e: any) {
        setPayload(null);
        setError(e?.message || 'Failed to load crews');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [settings.viewerRole, settingsLoading]);

  const crews = useMemo(
    () =>
      (payload?.crews || []).filter((crew) => {
        if (crew.kind !== 'subcrew') return false;
        if (settings.viewerRole === 'subcrew') return crew.id === settings.viewerSubCrewId;
        return true;
      }),
    [payload, settings.viewerRole, settings.viewerSubCrewId]
  );
  const activeCrew = useMemo(
    () => crews.find((crew) => crew.id === activeCrewId) || crews[0] || null,
    [activeCrewId, crews]
  );
  const activeItems = useMemo(
    () => (ordersPayload?.items || []).filter((item) => item.active),
    [ordersPayload]
  );
  const selectedOrderItem = useMemo(
    () => activeItems.find((item) => item.id === orderDraft.selectedItemId) || null,
    [activeItems, orderDraft.selectedItemId]
  );
  const cartItems = useMemo(
    () =>
      orderDraft.cart
        .map((entry) => {
          const item = activeItems.find((candidate) => candidate.id === entry.itemId);
          if (!item) return null;
          return {item, quantity: entry.quantity};
        })
        .filter(Boolean) as Array<{item: ItemRecord; quantity: number}>,
    [activeItems, orderDraft.cart]
  );
  const cartTotals = useMemo(
    () =>
      cartItems.reduce(
        (sum, entry) => ({
          quantity: sum.quantity + entry.quantity,
          dirtyWashRequirementCents: sum.dirtyWashRequirementCents + entry.item.dirtyWashRequirementCents * entry.quantity,
          cleanCashCents: sum.cleanCashCents + entry.item.cleanCashCents * entry.quantity,
          dirtyCashCents: sum.dirtyCashCents + entry.item.dirtyCashCents * entry.quantity,
        }),
        {quantity: 0, dirtyWashRequirementCents: 0, cleanCashCents: 0, dirtyCashCents: 0}
      ),
    [cartItems]
  );
  const hasPendingCart = orderDraft.cart.length > 0 || !!orderDraft.note.trim();
  const syncCrewOrderCount = (crewId: string, orderCount: number) => {
    setPayload((current) => {
      if (!current) return current;
      return {
        ...current,
        crews: current.crews.map((crew) => (crew.id === crewId ? {...crew, ordersCount: orderCount} : crew)),
      };
    });
  };
  const applyWashPayload = useCallback((next: CrewWashPayload) => {
    setWashPayload(next);
    setPayload((current) => {
      if (!current) return current;
      return {
        ...current,
        crews: current.crews.map((crew) =>
          crew.id === next.crewId
            ? {
                ...crew,
                washLog: next.transactions,
                washTotalDirtyCents: next.totals.availableDirtyCents,
                washCollectedDirtyCents: next.totals.dirtyCollectedCents,
                washCleanReturnedCents: next.totals.cleanReturnedCents,
                orderUsedCents: next.totals.orderUsedCents,
              }
            : crew
        ),
      };
    });
  }, []);
  const loadCrewWash = useCallback(async (crewId: string, withLoading = true) => {
    if (!crewId) return;
    if (withLoading) setWashLoading(true);
    setWashErr('');
    try {
      const next = await fetchJsonCached<CrewWashPayload>(crewWashUrl(crewId), 5_000);
      applyWashPayload(next);
    } catch (e: any) {
      setWashPayload(null);
      setWashErr(e?.message || 'Failed to load wash log');
    } finally {
      if (withLoading) setWashLoading(false);
    }
  }, [applyWashPayload]);

  const addToCart = () => {
    if (!selectedOrderItem) {
      setOrdersErr('Select an item first.');
      return;
    }
    const quantity = Math.max(1, Math.floor(Number(orderDraft.selectedQuantity || 1)));
    setOrderDraft((current) => {
      const existing = current.cart.find((entry) => entry.itemId === selectedOrderItem.id);
      return {
        ...current,
        cart: existing
          ? current.cart.map((entry) =>
              entry.itemId === selectedOrderItem.id ? {...entry, quantity: entry.quantity + quantity} : entry
            )
          : [...current.cart, {itemId: selectedOrderItem.id, quantity}],
        selectedQuantity: '1',
      };
    });
    setOrdersErr('');
  };

  const removeFromCart = (itemId: string) => {
    setOrderDraft((current) => ({
      ...current,
      cart: current.cart.filter((entry) => entry.itemId !== itemId),
    }));
  };

  const createOrder = async () => {
    if (!activeCrew?.id) return;
    if (!orderDraft.cart.length) {
      setOrdersErr('Add at least one item to the cart before placing the order.');
      return;
    }
    try {
      const res = await previewFetch('/api/crews/orders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'create',
          crewId: activeCrew.id,
          items: orderDraft.cart,
          note: orderDraft.note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to create order (${res.status})`);
      invalidateJsonCache(CREWS_OVERVIEW_URL);
      invalidateJsonCache(crewOrdersUrl(activeCrew.id));
      invalidateJsonCache(crewWashUrl(activeCrew.id));
      setOrdersPayload(json as CrewOrdersPayload);
      syncCrewOrderCount(String((json as CrewOrdersPayload).crewId || activeCrew.id), Number((json as CrewOrdersPayload).totals?.orderCount || 0));
      setOrderModalOpen(false);
      setOrderDraft({selectedItemId: '', selectedQuantity: '1', note: '', cart: []});
      if ((json as CrewOrdersPayload).embedSent === false && (json as CrewOrdersPayload).embedError) {
        setOrdersErr(`Order placed, but the order update embed was not sent: ${(json as CrewOrdersPayload).embedError}`);
      } else {
        setOrdersErr('');
      }
      void loadCrewWash(activeCrew.id, false);
    } catch (e: any) {
      setOrdersErr(e?.message || 'Failed to create order');
    }
  };

  const openNewOrderModal = () => {
    if (!canPlaceOrders) return;
    const first = activeItems[0]?.id || '';
    setOrdersErr('');
    setOrderDraft({selectedItemId: first, selectedQuantity: '1', note: '', cart: []});
    setOrderModalOpen(true);
  };

  const resumeOrderModal = () => {
    if (!canPlaceOrders) return;
    setOrdersErr('');
    setOrderDraft((current) => ({
      ...current,
      selectedItemId: current.selectedItemId || current.cart[0]?.itemId || activeItems[0]?.id || '',
      selectedQuantity: current.selectedQuantity || '1',
    }));
    setOrderModalOpen(true);
  };

  const mutateOrder = async (action: 'set_status' | 'cancel', id: string, status?: 'pending' | 'completed', reason?: string) => {
    if (!activeCrew?.id) return;
    try {
      const res = await previewFetch('/api/crews/orders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action,
          crewId: activeCrew.id,
          id,
          status,
          cancelReason: reason,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to update order (${res.status})`);
      invalidateJsonCache(CREWS_OVERVIEW_URL);
      invalidateJsonCache(crewOrdersUrl(activeCrew.id));
      invalidateJsonCache(crewWashUrl(activeCrew.id));
      setOrdersPayload(json as CrewOrdersPayload);
      syncCrewOrderCount(String((json as CrewOrdersPayload).crewId || activeCrew.id), Number((json as CrewOrdersPayload).totals?.orderCount || 0));
      if ((json as CrewOrdersPayload).embedSent === false && (json as CrewOrdersPayload).embedError) {
        setOrdersErr(`Order updated, but the order embed was not updated: ${(json as CrewOrdersPayload).embedError}`);
      } else {
        setOrdersErr('');
      }
      if (action === 'cancel') void loadCrewWash(activeCrew.id, false);
    } catch (e: any) {
      setOrdersErr(e?.message || 'Failed to update order');
    }
  };

  const openCancelModal = (id: string) => {
    if (!canCancelOrders) return;
    setCancelOrderId(id);
    setCancelReason('');
    setOrdersErr('');
    setCancelModalOpen(true);
  };

  const submitCancelOrder = async () => {
    const reason = String(cancelReason || '').trim();
    if (!reason) {
      setOrdersErr('Please provide a cancel reason.');
      return;
    }
    await mutateOrder('cancel', cancelOrderId, undefined, reason);
    setCancelModalOpen(false);
    setCancelOrderId('');
    setCancelReason('');
  };

  const createWash = async () => {
    if (!activeCrew?.id) return;
    try {
      const dirtyWhole = Math.max(0, Math.floor(Number(washDraft.dirty || 0)));
      const washRatePct = Math.max(0, Math.min(100, Math.floor(Number(washDraft.washRate || 0))));
      const res = await previewFetch('/api/subcrews/wash', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'create',
          crewId: activeCrew.id,
          date: washDraft.date,
          dirtyCents: dirtyWhole * 100,
          washRatePct,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to add wash (${res.status})`);
      invalidateJsonCache(CREWS_OVERVIEW_URL);
      invalidateJsonCache(crewWashUrl(activeCrew.id));
      applyWashPayload(json as CrewWashPayload);
      setWashModalOpen(false);
      setWashDraft({
        date: melbourneDateInputValue(),
        dirty: '',
        washRate: String(Math.max(0, Math.min(100, Math.floor(Number(settings.defaultWashRatePct ?? 25))))),
      });
      setWashErr('');
    } catch (e: any) {
      setWashErr(e?.message || 'Failed to add wash');
    }
  };

  const setWashStatus = async (entryId: string, status: CrewWashEntry['status']) => {
    if (!activeCrew?.id || !entryId) return;
    try {
      const res = await previewFetch('/api/subcrews/wash', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'set_status',
          crewId: activeCrew.id,
          entryId,
          status,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to update wash (${res.status})`);
      invalidateJsonCache(CREWS_OVERVIEW_URL);
      invalidateJsonCache(crewWashUrl(activeCrew.id));
      applyWashPayload(json as CrewWashPayload);
      setWashErr('');
    } catch (e: any) {
      setWashErr(e?.message || 'Failed to update wash');
    }
  };

  useEffect(() => {
    if (settingsLoading) return;
    if (activeSubTab !== 'orders' || !activeCrew?.id) return;
    if (!canViewOrders) return;
    const load = async () => {
      setOrdersLoading(true);
      setOrdersErr('');
      try {
        const next = await fetchJsonCached<CrewOrdersPayload>(crewOrdersUrl(activeCrew.id), 5_000);
        setOrdersPayload(next);
        syncCrewOrderCount(String(next.crewId || activeCrew.id), Number(next.totals?.orderCount || 0));
      } catch (e: any) {
        setOrdersPayload(null);
        setOrdersErr(e?.message || 'Failed to load orders');
      } finally {
        setOrdersLoading(false);
      }
    };
    void load();
  }, [activeCrew?.id, activeSubTab, canViewOrders, settings.viewerRole, settingsLoading]);

  useEffect(() => {
    if (!canViewOrders && activeSubTab === 'orders') {
      setActiveSubTab('members');
      setOrderModalOpen(false);
    }
  }, [activeSubTab, canViewOrders]);

  useEffect(() => {
    if (settingsLoading) return;
    if (activeSubTab !== 'wash' || !activeCrew?.id) return;
    void loadCrewWash(activeCrew.id);
  }, [activeCrew?.id, activeSubTab, loadCrewWash, settings.viewerRole, settingsLoading]);

  if (settingsLoading) return null;

  return (
    <div style={{padding: 22}}>
      <Card
        css={{
          ...glassCardCss,
          border: `2px solid ${settings.outlineColor || 'var(--reblas-outline)'}`,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap'}}>
          <div>
            <Text h3 css={{mb: 0}}>Crews</Text>
            <Text size="$sm" css={{opacity: 0.72}}>
              Crew overview with auto-generated tabs for each sub crew.
            </Text>
          </div>
        </div>

        <Spacer y={0.8} />

        {error ? (
          <Card css={{p: '$6', mb: '$6', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
            <Text b>Error</Text>
            <Text size="$sm">{error}</Text>
          </Card>
        ) : null}

        <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
          {crews.map((crew) => {
            const active = activeCrew?.id === crew.id;
            return (
              <button
                key={crew.id}
                type="button"
                onClick={() => {
                  setActiveCrewId(crew.id);
                  setActiveSubTab('members');
                }}
                style={{
                  borderRadius: 14,
                  border: `2px solid ${crew.outlineColor || settings.outlineColor || 'var(--reblas-outline)'}`,
                  background: active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
                  boxShadow: active ? `0 0 0 1px ${crew.outlineColor || settings.outlineColor || 'transparent'}` : 'none',
                  color: 'inherit',
                  padding: '10px 14px',
                  minWidth: 160,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{fontWeight: 800}}>{crew.name}</div>
                <div style={{opacity: 0.62, fontSize: 12}}>{crew.kind === 'main' ? 'Main Crew' : 'Sub Crew'}</div>
              </button>
            );
          })}
        </div>

        <Spacer y={0.8} />

        <div style={{['--reblas-outline' as any]: activeCrew?.outlineColor || settings.outlineColor || '#ffffff14'}}>
          {loading ? (
            <Text size="$sm" css={{opacity: 0.72}}>Loading crews…</Text>
          ) : activeCrew ? (
            <>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16}}>
                <CrewMetricCard title="Guild ID" value={activeCrew.guildId || 'Not set'} accent={activeCrew.outlineColor} />
                <CrewMetricCard title="Members" value={String(activeCrew.memberCount)} accent="var(--reblas-btn1-color)" />
                <CrewMetricCard title="Dirty Wash" value={formatCentsWhole(activeCrew.washTotalDirtyCents)} accent="var(--reblas-btn4-color)" />
                <CrewMetricCard title="Orders" value={String(activeCrew.ordersCount)} accent="var(--reblas-btn2-color)" />
              </div>

              <Spacer y={0.8} />

              <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
                <SubTabButton
                  label="Members"
                  active={activeSubTab === 'members'}
                  onClick={() => setActiveSubTab('members')}
                />
                <SubTabButton
                  label="Wash Log"
                  active={activeSubTab === 'wash'}
                  onClick={() => setActiveSubTab('wash')}
                />
                <SubTabButton
                  label="Orders"
                  active={activeSubTab === 'orders'}
                  onClick={() => setActiveSubTab('orders')}
                  hidden={!canViewOrders}
                />
              </div>

              <Spacer y={0.8} />

              {activeSubTab === 'members' ? <CrewMembersPanel crew={activeCrew} /> : null}
              {activeSubTab === 'wash' ? (
                <CrewWashLogPanel
                  crew={activeCrew}
                  payload={washPayload}
                  loading={washLoading}
                  error={washErr}
                  onCreate={() => {
                    setWashDraft({
                      date: melbourneDateInputValue(),
                      dirty: '',
                      washRate: String(Math.max(0, Math.min(100, Math.floor(Number(settings.defaultWashRatePct ?? 25))))),
                    });
                    setWashModalOpen(true);
                  }}
                  onMarkPending={(id) => void setWashStatus(id, 'pending')}
                  onMarkPaid={(id) => void setWashStatus(id, 'paid')}
                />
              ) : null}
              {activeSubTab === 'orders' ? (
                <CrewOrdersPanel
                  crew={activeCrew}
                  payload={ordersPayload}
                  loading={ordersLoading}
                  error={ordersErr}
                  hasActiveItems={activeItems.length > 0}
                  hasPendingCart={hasPendingCart}
                  canPlaceOrders={canPlaceOrders}
                  canManageOrders={canManageOrders}
                  canCancelOrders={canCancelOrders}
                  onCreate={openNewOrderModal}
                  onResumeCart={resumeOrderModal}
                  onMarkPending={(id) => void mutateOrder('set_status', id, 'pending')}
                  onMarkCompleted={(id) => void mutateOrder('set_status', id, 'completed')}
                  onCancel={openCancelModal}
                />
              ) : null}
            </>
          ) : (
            <Text size="$sm" css={{opacity: 0.72}}>No crews configured yet.</Text>
          )}
        </div>
      </Card>

      {orderModalOpen && canPlaceOrders ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.62)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 500,
            padding: 20,
          }}
        >
          <Card
            css={{
              ...glassCardCss,
              maxWidth: 860,
              width: '100%',
              p: '$10',
              background: 'rgba(3,7,18,0.94)',
              boxShadow: '0 28px 80px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(22px)',
              maxHeight: 'calc(100vh - 48px)',
              overflowY: 'auto',
            }}
            onClick={(e: any) => e.stopPropagation()}
          >
            <Text h3 css={{mb: '$6'}}>Add Order</Text>
            <div style={{display: 'grid', gap: 12}}>
              {ordersErr ? (
                <Card css={{p: '$5', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
                  <Text size="$sm">{ordersErr}</Text>
                </Card>
              ) : null}
              <div style={{display: 'grid', gap: 8}}>
                <Text size="$sm" css={{opacity: 0.82}}>Select Item</Text>
                <div style={{display: 'grid', gap: 12}}>
                  <select
                    value={orderDraft.selectedItemId}
                    onChange={(e) => {
                      setOrderDraft({...orderDraft, selectedItemId: e.target.value});
                      setOrdersErr('');
                    }}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: '2px solid var(--reblas-outline)',
                      background: 'rgba(0,0,0,0.2)',
                      color: 'white',
                    }}
                  >
                    {activeItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} - Dirty Wash {formatCentsWhole(item.dirtyWashRequirementCents)}
                      </option>
                    ))}
                  </select>
                  {selectedOrderItem ? (
                    <Card css={{p: '$5', background: 'rgba(255,255,255,0.04)', border: '2px solid var(--reblas-outline)'}}>
                      <div style={{display: 'grid', gap: 10}}>
                        <div style={{display: 'flex', gap: 12, alignItems: 'flex-start'}}>
                          {selectedOrderItem.imageUrl ? (
                            <img
                              src={selectedOrderItem.imageUrl}
                              alt={selectedOrderItem.name}
                              style={{
                                width: 108,
                                height: 108,
                                objectFit: 'cover',
                                borderRadius: 12,
                                border: '2px solid var(--reblas-outline)',
                                display: 'block',
                                background: 'rgba(0,0,0,0.16)',
                                flexShrink: 0,
                              }}
                            />
                          ) : null}
                          <div style={{display: 'grid', gap: 6, minWidth: 0}}>
                            <Text b css={{mb: 0}}>{selectedOrderItem.name}</Text>
                            <Text size="$sm" css={{mb: 0, opacity: 0.78}}>
                              Dirty Wash: {formatCentsWhole(selectedOrderItem.dirtyWashRequirementCents)} | Clean Cash: {formatCentsWhole(selectedOrderItem.cleanCashCents)} | Dirty Cash: {formatCentsWhole(selectedOrderItem.dirtyCashCents)}
                            </Text>
                            <Text size="$sm" css={{mb: 0, opacity: 0.72}}>
                              Mats: {formatMaterials((selectedOrderItem.materials || []).map((entry) => ({...entry, matName: entry.matId})))}
                            </Text>
                          </div>
                        </div>
                        <div style={{display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12, alignItems: 'end'}}>
                          <label style={{display: 'grid', gap: 6}}>
                            <Text size="$sm" css={{opacity: 0.78}}>Quantity</Text>
                            <input
                              value={orderDraft.selectedQuantity}
                              onChange={(e) =>
                                setOrderDraft({
                                  ...orderDraft,
                                  selectedQuantity: String(e.target.value || '').replace(/[^0-9]/g, '') || '1',
                                })
                              }
                              style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                            />
                          </label>
                          <div style={{display: 'flex', justifyContent: 'flex-end'}}>
                            <Button auto className="reblas-btn-2" css={{minWidth: 'auto', px: '$8'}} onPress={addToCart}>
                              Add To Cart
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ) : (
                    <Card css={{p: '$5', background: 'rgba(255,255,255,0.04)', border: '2px solid var(--reblas-outline)'}}>
                      <Text size="$sm" css={{mb: 0, opacity: 0.72}}>Select an item from the list to view its details.</Text>
                    </Card>
                  )}
                </div>
              </div>
              <Card css={{p: '$5', background: 'rgba(255,255,255,0.04)', border: '2px solid var(--reblas-outline)'}}>
                <div style={{display: 'grid', gap: 10}}>
                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12}}>
                    <Text b css={{mb: 0}}>Cart</Text>
                    <Text size="$sm" css={{mb: 0, opacity: 0.78}}>
                      {cartTotals.quantity} item{cartTotals.quantity === 1 ? '' : 's'}
                    </Text>
                  </div>
                  {!cartItems.length ? (
                    <Text size="$sm" css={{mb: 0, opacity: 0.72}}>No items added yet.</Text>
                  ) : (
                    <div style={{display: 'grid', gap: 8}}>
                      {cartItems.map(({item, quantity}) => (
                        <div
                          key={`cart_${item.id}`}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto',
                            gap: 10,
                            alignItems: 'center',
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '2px solid var(--reblas-outline)',
                            background: 'rgba(0,0,0,0.16)',
                          }}
                        >
                          <div style={{display: 'grid', gap: 2}}>
                            <Text b css={{mb: 0}}>{item.name}</Text>
                            <Text size="$sm" css={{mb: 0, opacity: 0.76}}>
                              Qty {quantity} | Dirty {formatCentsWhole(item.dirtyWashRequirementCents * quantity)} | Clean {formatCentsWhole(item.cleanCashCents * quantity)} | Dirty Cash {formatCentsWhole(item.dirtyCashCents * quantity)}
                            </Text>
                          </div>
                          <Button auto light className="reblas-btn-3" onPress={() => removeFromCart(item.id)}>
                            Remove
                          </Button>
                        </div>
                      ))}
                      <div style={{display: 'grid', gap: 4, paddingTop: 4}}>
                        <Text size="$sm" css={{mb: 0, opacity: 0.78}}>
                          Dirty Wash Total: <b>{formatCentsWhole(cartTotals.dirtyWashRequirementCents)}</b>
                        </Text>
                        <Text size="$sm" css={{mb: 0, opacity: 0.78}}>
                          Clean Cash Total: <b>{formatCentsWhole(cartTotals.cleanCashCents)}</b>
                        </Text>
                        <Text size="$sm" css={{mb: 0, opacity: 0.78}}>
                          Dirty Cash Total: <b>{formatCentsWhole(cartTotals.dirtyCashCents)}</b>
                        </Text>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
              <label style={{display: 'grid', gap: 6}}>
                <Text size="$sm" css={{opacity: 0.78}}>Note</Text>
                <textarea
                  value={orderDraft.note}
                  onChange={(e) => setOrderDraft({...orderDraft, note: e.target.value})}
                  style={{minHeight: 110, resize: 'vertical', padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                />
              </label>
            </div>
            <Spacer y={0.8} />
            <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
              <Button
                className="reblas-btn-1"
                onPress={() => {
                  setOrderModalOpen(false);
                  setOrdersErr('');
                }}
              >
                Cancel
              </Button>
              <Button className="reblas-btn-2" onPress={() => void createOrder()} disabled={!activeItems.length || !orderDraft.cart.length || !canPlaceOrders}>
                Place Order
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {cancelModalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.52)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 520,
            padding: 20,
          }}
        >
          <Card
            css={{...glassCardCss, maxWidth: 560, width: '100%', p: '$10', background: 'rgba(3,7,18,0.94)'}}
            onClick={(e: any) => e.stopPropagation()}
          >
            <Text h3 css={{mb: '$6'}}>Cancel Order</Text>
            <div style={{display: 'grid', gap: 8}}>
              <Text size="$sm" css={{opacity: 0.76}}>
                Provide a reason for cancelling this order.
              </Text>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                style={{minHeight: 120, resize: 'vertical', padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
              />
            </div>
            <Spacer y={0.8} />
            <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
              <Button
                className="reblas-btn-1"
                onPress={() => {
                  setCancelModalOpen(false);
                  setCancelOrderId('');
                  setCancelReason('');
                }}
              >
                Close
              </Button>
              <Button className="reblas-btn-3" onPress={() => void submitCancelOrder()}>
                Confirm Cancel
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {washModalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 500,
            padding: 20,
          }}
        >
          <Card
            css={{...glassCardCss, maxWidth: 560, width: '100%', p: '$10'}}
            onClick={(e: any) => e.stopPropagation()}
          >
            <Text h3 css={{mb: '$6'}}>Add Wash</Text>
            <div style={{display: 'grid', gap: 12}}>
              <label style={{display: 'grid', gap: 6}}>
                <Text size="$sm" css={{opacity: 0.78}}>Date</Text>
                <input
                  type="date"
                  value={washDraft.date}
                  onChange={(e) => setWashDraft({...washDraft, date: e.target.value})}
                  style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                />
              </label>
              <label style={{display: 'grid', gap: 6}}>
                <Text size="$sm" css={{opacity: 0.78}}>Dirty Collected</Text>
                <input
                  inputMode="numeric"
                  value={washDraft.dirty}
                  onChange={(e) => setWashDraft({...washDraft, dirty: String(e.target.value || '').replace(/[^0-9]/g, '')})}
                  style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                />
              </label>
              <label style={{display: 'grid', gap: 6}}>
                <Text size="$sm" css={{opacity: 0.78}}>Wash Rate %</Text>
                <input
                  inputMode="numeric"
                  value={washDraft.washRate}
                  onChange={(e) =>
                    setWashDraft({
                      ...washDraft,
                      washRate: String(e.target.value || '').replace(/[^0-9]/g, '').slice(0, 3),
                    })
                  }
                  style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                />
              </label>
            </div>
            <Spacer y={0.8} />
            <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
              <Button className="reblas-btn-1" onPress={() => setWashModalOpen(false)}>
                Cancel
              </Button>
              <Button className="reblas-btn-2" onPress={() => void createWash()} disabled={!washDraft.date || !washDraft.dirty}>
                Save Wash
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
};

function CrewMetricCard({title, value, accent}: {title: string; value: string; accent: string}) {
  return (
    <Card css={{...glassCardCss, p: '$8'}}>
      <Text size="$xs" css={{opacity: 0.72, letterSpacing: '0.08em', textTransform: 'uppercase'}}>
        {title}
      </Text>
      <Text h4 css={{mb: 0, color: accent}}>
        {value}
      </Text>
    </Card>
  );
}

function SubTabButton({
  label,
  active,
  onClick,
  hidden = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <Button auto className={active ? 'reblas-btn-2' : 'reblas-btn-1'} onPress={onClick}>
      {label}
    </Button>
  );
}

function CrewMembersPanel({crew}: {crew: CrewOverview}) {
  return (
    <Card css={{...glassCardCss, p: '$8'}}>
      {crew.members.length === 0 ? (
        <Text size="$sm" css={{opacity: 0.72}}>No members synced for this crew yet.</Text>
      ) : (
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12}}>
          {crew.members.map((member) => (
            <Card key={member.id} css={{p: '$5', background: 'rgba(255,255,255,0.04)', border: '2px solid var(--reblas-outline)'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <Avatar src={member.avatarUrl || undefined} text={(displayNameOf(member) || 'M')[0]} size="md" />
                <div style={{minWidth: 0}}>
                  <Text b css={{mb: 0}}>{displayNameOf(member)}</Text>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

function CrewWashLogPanel({
  crew,
  payload,
  loading,
  error,
  onCreate,
  onMarkPending,
  onMarkPaid,
}: {
  crew: CrewOverview;
  payload: CrewWashPayload | null;
  loading: boolean;
  error: string;
  onCreate: () => void;
  onMarkPending: (id: string) => void;
  onMarkPaid: (id: string) => void;
}) {
  return (
    <Card css={{...glassCardCss, p: '$8'}}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap'}}>
        <div>
          <Text h4 css={{mb: 0}}>Wash Log</Text>
          <Text size="$sm" css={{opacity: 0.72}}>
            Crew-specific wash transactions for {crew.name}.
          </Text>
        </div>
        <Button className="reblas-btn-2" onPress={onCreate}>
          Add Wash
        </Button>
      </div>

      <Spacer y={0.7} />

      {error ? (
        <Card css={{p: '$6', mb: '$6', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
          <Text size="$sm">{error}</Text>
        </Card>
      ) : null}

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18}}>
        <CrewMetricCard title="Dirty Wash" value={formatCentsWhole(payload?.totals?.availableDirtyCents ?? crew.washTotalDirtyCents)} accent="var(--reblas-btn4-color)" />
        <CrewMetricCard title="Dirty Collected" value={formatCentsWhole(payload?.totals?.dirtyCollectedCents ?? crew.washCollectedDirtyCents)} accent="var(--reblas-btn1-color)" />
        <CrewMetricCard title="Clean Returned" value={formatCentsWhole(payload?.totals?.cleanReturnedCents ?? crew.washCleanReturnedCents)} accent="var(--reblas-btn2-color)" />
        <CrewMetricCard title="Used By Orders" value={formatCentsWhole(payload?.totals?.orderUsedCents ?? crew.orderUsedCents)} accent="var(--reblas-btn3-color)" />
      </div>

      {loading ? (
        <Text size="$sm" css={{opacity: 0.72}}>Loading wash log…</Text>
      ) : !(payload?.transactions?.length || crew.washLog.length) ? (
        <Text size="$sm" css={{opacity: 0.72}}>No wash log entries yet.</Text>
      ) : (
        <div style={{overflowX: 'auto'}}>
          <table style={{width: '100%', borderCollapse: 'collapse', minWidth: 900}}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Date</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Dirty Collected</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Wash Rate</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Clean Returned</th>
                <th style={tableHeaderStyle}>Status</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.transactions || (crew.washLog as CrewWashEntry[])).map((entry) => (
                <tr key={entry.id}>
                  <td style={tableCellStyle}>{formatDateToDmy(entry.date || '')}</td>
                  <td style={{...tableCellStyle, textAlign: 'right', color: 'var(--reblas-btn4-color)', fontWeight: 800}}>
                    {formatCentsWhole(entry.dirtyCents)}
                  </td>
                  <td style={{...tableCellStyle, textAlign: 'right', color: 'var(--reblas-btn1-color)', fontWeight: 800}}>
                    {Math.max(0, Math.min(100, Math.floor(Number(entry.washRatePct || 0))))}%
                  </td>
                  <td style={{...tableCellStyle, textAlign: 'right', color: 'var(--reblas-btn2-color)', fontWeight: 800}}>
                    {formatCentsWhole(Number(entry.cleanCents || 0))}
                  </td>
                  <td style={tableCellStyle}>
                    <span style={{color: statusColor(entry.status || 'collected'), fontWeight: 800}}>
                      {statusLabel(entry.status || 'collected')}
                    </span>
                  </td>
                  <td style={{...tableCellStyle, textAlign: 'right'}}>
                    <div style={{display: 'inline-flex', gap: 8}}>
                      {entry.status !== 'pending' && entry.status !== 'paid' ? (
                        <Button auto light className="reblas-btn-4" onPress={() => onMarkPending(entry.id)}>
                          Mark Pending
                        </Button>
                      ) : null}
                      {entry.status !== 'paid' ? (
                        <Button auto light className="reblas-btn-2" onPress={() => onMarkPaid(entry.id)}>
                          Mark Paid
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CrewOrdersPanel({
  crew,
  payload,
  loading,
  error,
  hasActiveItems,
  hasPendingCart,
  canPlaceOrders,
  canManageOrders,
  canCancelOrders,
  onCreate,
  onResumeCart,
  onMarkPending,
  onMarkCompleted,
  onCancel,
}: {
  crew: CrewOverview;
  payload: CrewOrdersPayload | null;
  loading: boolean;
  error: string;
  hasActiveItems: boolean;
  hasPendingCart: boolean;
  canPlaceOrders: boolean;
  canManageOrders: boolean;
  canCancelOrders: boolean;
  onCreate: () => void;
  onResumeCart: () => void;
  onMarkPending: (id: string) => void;
  onMarkCompleted: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <Card css={{...glassCardCss, p: '$8'}}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap'}}>
        <div>
          <Text h4 css={{mb: 0}}>Orders</Text>
          <Text size="$sm" css={{opacity: 0.72}}>
            Crew-specific orders for {crew.name}.
          </Text>
        </div>
        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
          {hasPendingCart && canPlaceOrders ? (
            <Button className="reblas-btn-1" onPress={onResumeCart}>
              Resume Cart
            </Button>
          ) : null}
          <Button className="reblas-btn-2" onPress={onCreate} disabled={!hasActiveItems || !canPlaceOrders}>
            Add Order
          </Button>
        </div>
      </div>

      <Spacer y={0.7} />

      {error ? (
        <Card css={{p: '$6', mb: '$6', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
          <Text size="$sm">{error}</Text>
        </Card>
      ) : null}
      {!hasActiveItems && canPlaceOrders ? (
        <Card css={{p: '$6', mb: '$6', background: 'rgba(0,0,0,0.12)', border: '2px solid var(--reblas-outline)'}}>
          <Text size="$sm" css={{opacity: 0.78}}>
            No active items are available yet. Add items in Settings under the Items tab first.
          </Text>
        </Card>
      ) : null}
      {!canPlaceOrders ? (
        <Card css={{p: '$6', mb: '$6', background: 'rgba(0,0,0,0.12)', border: '2px solid var(--reblas-outline)'}}>
          <Text size="$sm" css={{opacity: 0.78}}>
            You can view orders here, but you do not have permission to place a new order.
          </Text>
        </Card>
      ) : null}

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18}}>
        <CrewMetricCard title="Orders" value={String(payload?.totals?.orderCount || 0)} accent="var(--reblas-btn1-color)" />
        <CrewMetricCard title="Active Orders" value={String(payload?.totals?.openCount || 0)} accent="var(--reblas-btn4-color)" />
        <CrewMetricCard title="Dirty Wash Req" value={formatCentsWhole(payload?.totals?.totalDirtyWashRequirementCents || 0)} accent="var(--reblas-btn4-color)" />
        <CrewMetricCard title="Clean Cash" value={formatCentsWhole(payload?.totals?.totalCleanCashCents || 0)} accent="var(--reblas-btn2-color)" />
        <CrewMetricCard title="Dirty Cash" value={formatCentsWhole(payload?.totals?.totalDirtyCashCents || 0)} accent="var(--reblas-btn1-color)" />
      </div>

      {loading ? (
        <Text size="$sm" css={{opacity: 0.72}}>Loading orders…</Text>
      ) : !payload?.orders?.length ? (
        <Text size="$sm" css={{opacity: 0.72}}>No orders recorded for this crew yet.</Text>
      ) : (
        <div style={{overflowX: 'auto'}}>
          <table style={{width: '100%', borderCollapse: 'collapse', minWidth: 1180}}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Item</th>
                <th style={tableHeaderStyle}>Qty</th>
                <th style={tableHeaderStyle}>Mats</th>
                <th style={tableHeaderStyle}>Note</th>
                <th style={tableHeaderStyle}>Created</th>
                <th style={tableHeaderStyle}>Status</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Dirty Wash</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Clean Cash</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Dirty Cash</th>
                <th style={{...tableHeaderStyle, textAlign: 'right'}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {payload.orders.map((order) => (
                <tr key={order.id}>
                  <td style={tableCellStyle}>
                    <div style={{display: 'grid', gap: 8}}>
                      {normalizeOrderLines(order).map((line, idx) => (
                        <div key={`${order.id}_${line.itemId}_${idx}`} style={{display: 'flex', alignItems: 'center', gap: 10}}>
                          {line.itemImageUrl ? <Avatar src={line.itemImageUrl} squared size="sm" /> : null}
                          <span>{line.itemName} x{line.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td style={tableCellStyle}>{order.quantity}</td>
                  <td style={tableCellStyle}>{formatMaterials(order.materials || [])}</td>
                  <td style={tableCellStyle}>
                    <div style={{display: 'grid', gap: 4}}>
                      <span>{order.note || 'No note'}</span>
                      {order.cancelReason ? (
                        <span style={{color: 'var(--reblas-btn3-color)', fontSize: 12}}>Cancel reason: {order.cancelReason}</span>
                      ) : null}
                    </div>
                  </td>
                  <td style={tableCellStyle}>{formatDateTime(order.createdAt)}</td>
                  <td style={tableCellStyle}>
                    <span style={{color: orderStatusColor(order.status), fontWeight: 800}}>
                      {orderStatusLabel(order.status)}
                    </span>
                  </td>
                  <td style={{...tableCellStyle, textAlign: 'right', color: 'var(--reblas-btn4-color)', fontWeight: 800}}>
                    {formatCentsWhole(order.totalDirtyWashRequirementCents)}
                  </td>
                  <td style={{...tableCellStyle, textAlign: 'right', color: 'var(--reblas-btn2-color)', fontWeight: 800}}>
                    {formatCentsWhole(order.totalCleanCashCents)}
                  </td>
                  <td style={{...tableCellStyle, textAlign: 'right', color: 'var(--reblas-btn1-color)', fontWeight: 800}}>
                    {formatCentsWhole(order.totalDirtyCashCents)}
                  </td>
                  <td style={{...tableCellStyle, textAlign: 'right'}}>
                    <div style={{display: 'inline-flex', gap: 8}}>
                      {canManageOrders && order.status === 'placed' ? (
                        <Button auto light className="reblas-btn-4" onPress={() => onMarkPending(order.id)}>
                          Mark Pending
                        </Button>
                      ) : null}
                      {canManageOrders && order.status !== 'completed' && order.status !== 'cancelled' ? (
                        <Button auto light className="reblas-btn-2" onPress={() => onMarkCompleted(order.id)}>
                          Mark Completed
                        </Button>
                      ) : null}
                      {canCancelOrders && order.status !== 'completed' && order.status !== 'cancelled' ? (
                        <Button auto light className="reblas-btn-3" onPress={() => onCancel(order.id)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const tableHeaderStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 10px',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  opacity: 0.72,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const tableCellStyle: React.CSSProperties = {
  padding: '14px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

export default CrewsPage;
