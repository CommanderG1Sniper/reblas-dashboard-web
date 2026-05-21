import type {NextPage} from 'next';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Avatar, Button, Card, Spacer, Text} from '@nextui-org/react';
import {useRouter} from 'next/router';
import {useSession} from 'next-auth/react';
import {useGuildSettings} from '../lib/guild-settings';
import {invalidateJsonCache} from '../lib/client/request-cache';
import {useOwnerPreviewMode} from '../lib/client/owner-preview';

type CrewOverview = {
  id: string;
  kind: 'main' | 'subcrew';
  name: string;
  guildId: string;
  outlineColor: string;
  washTotalDirtyCents: number;
  orderUsedCents: number;
};

type CrewsOverviewPayload = {
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

type ManagedOrder = CrewOrder & {
  crewName: string;
  crewKind: 'main' | 'subcrew';
  crewOutlineColor: string;
};

type OrderCartLine = {
  itemId: string;
  quantity: number;
};

const CREWS_OVERVIEW_URL = '/api/crews/overview';
const ALL_ORDERS_URL = '/api/crews/orders?crewId=all';

function crewOrdersUrl(crewId: string) {
  return `/api/crews/orders?crewId=${encodeURIComponent(crewId)}`;
}

const glassCardCss = {
  p: '$10',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

function formatCentsWhole(cents: number) {
  return Math.round(Number(cents || 0) / 100).toLocaleString();
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

async function fetchFreshJson<T>(url: string): Promise<T> {
  const separator = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${separator}_ts=${Date.now()}`, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as any)?.error || `Request failed (${res.status})`);
  }
  return payload as T;
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

function availableDirtyForCrew(crew?: CrewOverview | null) {
  if (!crew) return 0;
  if (crew.kind === 'main') return Math.max(0, Number(crew.washTotalDirtyCents || 0) - Number(crew.orderUsedCents || 0));
  return Math.max(0, Number(crew.washTotalDirtyCents || 0));
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

const OrderManagementPage: NextPage = () => {
  const router = useRouter();
  const {data: session, status} = useSession();
  const {settings, loading: settingsLoading} = useGuildSettings();
  const myId = String((session as any)?.discordId || '').trim();
  const {isPrimaryOwner} = useOwnerPreviewMode(settings, myId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [crews, setCrews] = useState<CrewOverview[]>([]);
  const [allOrdersPayload, setAllOrdersPayload] = useState<CrewOrdersPayload | null>(null);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<ManagedOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [orderDraft, setOrderDraft] = useState<{
    selectedCrewId: string;
    selectedItemId: string;
    selectedQuantity: string;
    note: string;
    cart: OrderCartLine[];
  }>({
    selectedCrewId: '',
    selectedItemId: '',
    selectedQuantity: '1',
    note: '',
    cart: [],
  });
  const [ordersErr, setOrdersErr] = useState('');
  const loadVersionRef = useRef(0);

  const loadAll = useCallback(async () => {
    const requestVersion = ++loadVersionRef.current;
    setLoading(true);
    setError('');
    try {
      const overview = await fetchFreshJson<CrewsOverviewPayload>(CREWS_OVERVIEW_URL);
      const nextCrews = Array.isArray(overview?.crews) ? overview.crews : [];
      const orderPayload = await fetchFreshJson<CrewOrdersPayload>(ALL_ORDERS_URL);
      const crewMap = new Map(nextCrews.map((crew) => [crew.id, crew]));

      const flattened: ManagedOrder[] = [];
      const firstItems = Array.isArray(orderPayload?.items) ? orderPayload.items : [];
      for (const order of orderPayload?.orders || []) {
        const crew = crewMap.get(order.crewId);
        flattened.push({
          ...order,
          crewName: crew?.name || (order.crewId === 'main' ? 'Main Crew' : order.crewId),
          crewKind: crew?.kind || (order.crewId === 'main' ? 'main' : 'subcrew'),
          crewOutlineColor: crew?.outlineColor || 'var(--reblas-outline)',
        });
      }
      if (requestVersion !== loadVersionRef.current) return;

      setCrews(nextCrews);
      setAllOrdersPayload(orderPayload || {crewId: 'all', items: firstItems, orders: [], totals: {orderCount: 0, openCount: 0, totalDirtyWashRequirementCents: 0, totalCleanCashCents: 0, totalDirtyCashCents: 0}});
      setOrderDraft((current) => ({
        ...current,
        selectedCrewId:
          nextCrews.some((crew) => crew.id === current.selectedCrewId)
            ? current.selectedCrewId
            : String(nextCrews[0]?.id || ''),
        selectedItemId:
          firstItems.some((item) => item.id === current.selectedItemId && item.active)
            ? current.selectedItemId
            : String(firstItems.find((item) => item.active)?.id || ''),
      }));
    } catch (e: any) {
      setError(e?.message || 'Failed to load order management');
      setCrews([]);
      setAllOrdersPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsLoading || status === 'loading') return;
    if (!isPrimaryOwner) {
      router.replace('/members');
      return;
    }
    void loadAll();
  }, [isPrimaryOwner, loadAll, router, settingsLoading, status]);

  const items = useMemo(
    () => ((allOrdersPayload?.items || []) as ItemRecord[]).filter((item) => item.active),
    [allOrdersPayload]
  );
  const orders = useMemo(() => {
    const crewMap = new Map(crews.map((crew) => [crew.id, crew]));
    return ((allOrdersPayload?.orders || []) as CrewOrder[])
      .map((order) => {
        const crew = crewMap.get(order.crewId);
        return {
          ...order,
          crewName: crew?.name || (order.crewId === 'main' ? 'Main Crew' : order.crewId),
          crewKind: crew?.kind || (order.crewId === 'main' ? 'main' : 'subcrew'),
          crewOutlineColor: crew?.outlineColor || 'var(--reblas-outline)',
        } as ManagedOrder;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [allOrdersPayload, crews]);
  const selectedCrew = useMemo(
    () => crews.find((crew) => crew.id === orderDraft.selectedCrewId) || crews[0] || null,
    [crews, orderDraft.selectedCrewId]
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === orderDraft.selectedItemId) || items[0] || null,
    [items, orderDraft.selectedItemId]
  );
  const cartItems = useMemo(
    () =>
      orderDraft.cart
        .map((entry) => {
          const item = items.find((candidate) => candidate.id === entry.itemId);
          if (!item) return null;
          return {item, quantity: entry.quantity};
        })
        .filter(Boolean) as Array<{item: ItemRecord; quantity: number}>,
    [items, orderDraft.cart]
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
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) =>
        tab === 'active'
          ? order.status === 'placed' || order.status === 'pending'
          : order.status === 'completed' || order.status === 'cancelled'
      ),
    [orders, tab]
  );

  const activeCount = useMemo(
    () => orders.filter((order) => order.status === 'placed' || order.status === 'pending').length,
    [orders]
  );
  const completedCount = useMemo(() => orders.filter((order) => order.status === 'completed').length, [orders]);

  const applyCrewOrdersPayload = useCallback(
    (payload: CrewOrdersPayload) => {
      const crewId = String(payload?.crewId || '').trim();
      if (!crewId) return;
      setAllOrdersPayload((current) => {
        const currentOrders = Array.isArray(current?.orders) ? current!.orders : [];
        const otherOrders = currentOrders.filter((order) => String(order?.crewId || '').trim() !== crewId);
        const nextOrders = [...otherOrders, ...((payload?.orders || []) as CrewOrder[])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const nextItems = Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(current?.items)
            ? current!.items
            : [];
        return {
          crewId: 'all',
          items: nextItems,
          orders: nextOrders,
          totals: {
            orderCount: nextOrders.length,
            openCount: nextOrders.filter((order) => order.status === 'placed' || order.status === 'pending').length,
            totalDirtyWashRequirementCents: nextOrders.reduce((sum, order) => sum + Number(order.totalDirtyWashRequirementCents || 0), 0),
            totalCleanCashCents: nextOrders.reduce((sum, order) => sum + Number(order.totalCleanCashCents || 0), 0),
            totalDirtyCashCents: nextOrders.reduce((sum, order) => sum + Number(order.totalDirtyCashCents || 0), 0),
          },
        };
      });
    },
    []
  );

  const invalidateOrdersCaches = useCallback(() => {
    invalidateJsonCache(CREWS_OVERVIEW_URL);
    invalidateJsonCache(ALL_ORDERS_URL);
    for (const crew of crews) invalidateJsonCache(crewOrdersUrl(crew.id));
  }, [crews]);

  const addToCart = () => {
    if (!selectedItem) return;
    const quantity = Math.max(1, Math.floor(Number(orderDraft.selectedQuantity || 1)));
    setOrderDraft((current) => {
      const existing = current.cart.find((entry) => entry.itemId === selectedItem.id);
      return {
        ...current,
        cart: existing
          ? current.cart.map((entry) =>
              entry.itemId === selectedItem.id ? {...entry, quantity: entry.quantity + quantity} : entry
            )
          : [...current.cart, {itemId: selectedItem.id, quantity}],
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

  const openNewOrderModal = () => {
    setOrdersErr('');
    setOrderDraft({
      selectedCrewId: crews[0]?.id || '',
      selectedItemId: items[0]?.id || '',
      selectedQuantity: '1',
      note: '',
      cart: [],
    });
    setOrderModalOpen(true);
  };

  const resumeOrderModal = () => {
    setOrdersErr('');
    setOrderDraft((current) => ({
      ...current,
      selectedCrewId: current.selectedCrewId || crews[0]?.id || '',
      selectedItemId: current.selectedItemId || current.cart[0]?.itemId || items[0]?.id || '',
      selectedQuantity: current.selectedQuantity || '1',
    }));
    setOrderModalOpen(true);
  };

  const createOrder = async () => {
    if (!selectedCrew?.id) return;
    if (!orderDraft.cart.length) {
      setOrdersErr('Add at least one item to the cart before placing the order.');
      return;
    }
    try {
      const res = await fetch('/api/crews/orders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'create',
          crewId: selectedCrew.id,
          items: orderDraft.cart,
          note: orderDraft.note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to create order (${res.status})`);
      invalidateOrdersCaches();
      loadVersionRef.current += 1;
      applyCrewOrdersPayload(json as CrewOrdersPayload);
      setOrderModalOpen(false);
      setOrderDraft({
        selectedCrewId: crews[0]?.id || '',
        selectedItemId: items[0]?.id || '',
        selectedQuantity: '1',
        note: '',
        cart: [],
      });
      if ((json as CrewOrdersPayload).embedSent === false && (json as CrewOrdersPayload).embedError) {
        setOrdersErr(`Order placed, but the order update embed was not sent: ${(json as CrewOrdersPayload).embedError}`);
      } else {
        setOrdersErr('');
      }
    } catch (e: any) {
      setOrdersErr(e?.message || 'Failed to create order');
    }
  };

  const mutateOrder = async (
    action: 'set_status' | 'cancel',
    order: ManagedOrder,
    status?: 'pending' | 'completed',
    reason?: string
  ) => {
    try {
      const res = await fetch('/api/crews/orders', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action,
          crewId: order.crewId,
          id: order.id,
          status,
          cancelReason: reason,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to update order (${res.status})`);
      invalidateOrdersCaches();
      loadVersionRef.current += 1;
      applyCrewOrdersPayload(json as CrewOrdersPayload);
      if ((json as CrewOrdersPayload).embedSent === false && (json as CrewOrdersPayload).embedError) {
        setOrdersErr(`Order updated, but the order embed was not updated: ${(json as CrewOrdersPayload).embedError}`);
      } else {
        setOrdersErr('');
      }
    } catch (e: any) {
      setOrdersErr(e?.message || 'Failed to update order');
    }
  };

  const openCancelModal = (order: ManagedOrder) => {
    setCancelOrder(order);
    setCancelReason('');
    setOrdersErr('');
    setCancelModalOpen(true);
  };

  const submitCancelOrder = async () => {
    const reason = String(cancelReason || '').trim();
    if (!cancelOrder) return;
    if (!reason) {
      setOrdersErr('Please provide a cancel reason.');
      return;
    }
    await mutateOrder('cancel', cancelOrder, undefined, reason);
    setCancelModalOpen(false);
    setCancelOrder(null);
    setCancelReason('');
  };

  if (settingsLoading || status === 'loading' || !isPrimaryOwner) return null;

  return (
    <div style={{padding: 22}}>
      <Card css={glassCardCss}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap'}}>
          <div>
            <Text h3 css={{mb: 0}}>Order Management</Text>
            <Text size="$sm" css={{opacity: 0.72}}>
              Primary-owner only view for placing and managing every crew order.
            </Text>
          </div>
          <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
            {hasPendingCart ? (
              <Button className="reblas-btn-1" onPress={resumeOrderModal}>
                Resume Cart
              </Button>
            ) : null}
            <Button className="reblas-btn-2" onPress={openNewOrderModal} disabled={!crews.length || !items.length}>
              Place Order
            </Button>
          </div>
        </div>

        <Spacer y={0.8} />

        {error ? (
          <Card css={{p: '$6', mb: '$6', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
            <Text size="$sm">{error}</Text>
          </Card>
        ) : null}
        {ordersErr ? (
          <Card css={{p: '$6', mb: '$6', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
            <Text size="$sm">{ordersErr}</Text>
          </Card>
        ) : null}

        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14}}>
          <MetricCard title="Active Orders" value={String(activeCount)} accent="var(--reblas-btn4-color)" />
          <MetricCard title="Completed Orders" value={String(completedCount)} accent="var(--reblas-btn2-color)" />
          <MetricCard
            title="Dirty Wash"
            value={formatCentsWhole(orders.reduce((sum, order) => sum + order.totalDirtyWashRequirementCents, 0))}
            accent="var(--reblas-btn4-color)"
          />
          <MetricCard
            title="Clean Cash"
            value={formatCentsWhole(orders.reduce((sum, order) => sum + order.totalCleanCashCents, 0))}
            accent="var(--reblas-btn2-color)"
          />
        </div>

        <Spacer y={0.8} />

        <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
          <Button auto className={tab === 'active' ? 'reblas-btn-2' : 'reblas-btn-1'} onPress={() => setTab('active')}>
            Active Orders
          </Button>
          <Button auto className={tab === 'completed' ? 'reblas-btn-2' : 'reblas-btn-1'} onPress={() => setTab('completed')}>
            Completed Orders
          </Button>
        </div>

        <Spacer y={0.8} />

        {loading ? (
          <Text size="$sm" css={{opacity: 0.72}}>Loading orders…</Text>
        ) : filteredOrders.length === 0 ? (
          <Text size="$sm" css={{opacity: 0.72}}>
            {tab === 'active' ? 'No active orders right now.' : 'No completed or cancelled orders yet.'}
          </Text>
        ) : (
          <div style={{overflowX: 'auto'}}>
            <table style={{width: '100%', borderCollapse: 'collapse', minWidth: 1280}}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>Crew</th>
                  <th style={tableHeaderStyle}>Items</th>
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
                {filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td style={tableCellStyle}>
                      <span style={{color: order.crewOutlineColor || 'white', fontWeight: 800}}>{order.crewName}</span>
                    </td>
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
                      {order.status === 'placed' ? (
                        <Button auto light className="reblas-btn-4" onPress={() => void mutateOrder('set_status', order, 'pending')}>
                          Mark Pending
                        </Button>
                      ) : null}
                      {order.status !== 'completed' && order.status !== 'cancelled' ? (
                        <Button auto light className="reblas-btn-2" onPress={() => void mutateOrder('set_status', order, 'completed')}>
                          Mark Completed
                        </Button>
                      ) : null}
                      {order.status !== 'completed' && order.status !== 'cancelled' ? (
                        <Button auto light className="reblas-btn-3" onPress={() => openCancelModal(order)}>
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

      {orderModalOpen ? (
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
            <Text h3 css={{mb: '$6'}}>Place Order</Text>
            <div style={{display: 'grid', gap: 12}}>
              {ordersErr ? (
                <Card css={{p: '$5', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
                  <Text size="$sm">{ordersErr}</Text>
                </Card>
              ) : null}
              <label style={{display: 'grid', gap: 6}}>
                <Text size="$sm" css={{opacity: 0.82}}>Select Crew</Text>
                <select
                  value={orderDraft.selectedCrewId}
                  onChange={(e) => setOrderDraft({...orderDraft, selectedCrewId: e.target.value})}
                  style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                >
                  {crews.map((crew) => (
                    <option key={crew.id} value={crew.id}>
                      {crew.name} - Available Dirty Wash {formatCentsWhole(availableDirtyForCrew(crew))}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{display: 'grid', gap: 8}}>
                <Text size="$sm" css={{opacity: 0.82}}>Select Item</Text>
                <div style={{display: 'grid', gap: 12}}>
                  <select
                    value={orderDraft.selectedItemId}
                    onChange={(e) => {
                      setOrderDraft({...orderDraft, selectedItemId: e.target.value});
                      setOrdersErr('');
                    }}
                    style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                  >
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} - Dirty Wash {formatCentsWhole(item.dirtyWashRequirementCents)}
                      </option>
                    ))}
                  </select>
                  {selectedItem ? (
                    <Card css={{p: '$5', background: 'rgba(255,255,255,0.04)', border: '2px solid var(--reblas-outline)'}}>
                      <div style={{display: 'grid', gap: 10}}>
                        <div style={{display: 'flex', gap: 12, alignItems: 'flex-start'}}>
                          {selectedItem.imageUrl ? (
                            <img
                              src={selectedItem.imageUrl}
                              alt={selectedItem.name}
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
                            <Text b css={{mb: 0}}>{selectedItem.name}</Text>
                            <Text size="$sm" css={{mb: 0, opacity: 0.78}}>
                              Dirty Wash: {formatCentsWhole(selectedItem.dirtyWashRequirementCents)} | Clean Cash: {formatCentsWhole(selectedItem.cleanCashCents)} | Dirty Cash: {formatCentsWhole(selectedItem.dirtyCashCents)}
                            </Text>
                            <Text size="$sm" css={{mb: 0, opacity: 0.72}}>
                              Mats: {formatMaterials((selectedItem.materials || []).map((entry) => ({...entry, matName: entry.matId})))}
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
                  ) : null}
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
                        <Text size="$sm" css={{mb: 0, opacity: 0.78}}>
                          Selected Crew Dirty Wash Available: <b>{formatCentsWhole(availableDirtyForCrew(selectedCrew))}</b>
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
              <Button className="reblas-btn-1" onPress={() => setOrderModalOpen(false)}>
                Cancel
              </Button>
              <Button className="reblas-btn-2" onPress={() => void createOrder()} disabled={!items.length || !orderDraft.cart.length}>
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
                  setCancelOrder(null);
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
    </div>
  );
};

function MetricCard({title, value, accent}: {title: string; value: string; accent: string}) {
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

export default OrderManagementPage;
