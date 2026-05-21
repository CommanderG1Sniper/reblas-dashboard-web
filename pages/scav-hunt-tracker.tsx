import React, {useCallback, useMemo, useState} from 'react';
import {Avatar, Button, Card, Input, Modal, Spacer, Text} from '@nextui-org/react';
import {useSession} from 'next-auth/react';
import {useGuildSettings} from '../lib/guild-settings';
import {fetchJsonCached, invalidateJsonCache} from '../lib/client/request-cache';
import {useOwnerPreviewMode} from '../lib/client/owner-preview';
import {buildOwnerPreviewHeaders} from '../lib/owner-preview';
import {EditIcon} from '../components/icons/table/edit-icon';

type ScavSection = 'main' | 'garbage';
type ScavItemType = 'standard' | 'aggregate';
type ScavAggregateGroup = '' | 'garbage';

type ScavPerson = {
  id: string;
  name: string;
  position: number;
};

type ScavRow = {
  id: string;
  name: string;
  section: ScavSection;
  itemType: ScavItemType;
  aggregateGroup: ScavAggregateGroup;
  totalNeededWhole: number;
  qtyInVanWhole: number;
  position: number;
  totalCollectedWhole: number;
  qtyNeededWhole: number;
  peopleTotals: Record<string, number>;
  canEditAdded: boolean;
  canEditPeople: boolean;
  isComplete: boolean;
};

type ScavHuntPayload = {
  people: ScavPerson[];
  mainItems: ScavRow[];
  garbageItems: ScavRow[];
  totals: {
    itemCount: number;
    peopleCount: number;
  };
};

type GuildMemberOption = {
  id: string;
  displayName?: string;
  nick?: string;
  globalName?: string;
  username?: string;
};

type MembersPayload = {
  members?: GuildMemberOption[];
};

type ItemOption = {
  id: string;
  name: string;
  active: boolean;
};

type ItemsPayload = {
  items?: ItemOption[];
};

const SCAV_HUNT_URL = '/api/scav-hunt-tracker';
const MEMBERS_URL = '/api/members/list';
const ITEMS_URL = '/api/items';
const EMPTY_PEOPLE: ScavPerson[] = [];
const EMPTY_ROWS: ScavRow[] = [];
const EMPTY_MEMBER_OPTIONS: GuildMemberOption[] = [];
const EMPTY_ITEM_OPTIONS: ItemOption[] = [];

const glassCardCss = {
  p: '$10',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

const colCard: React.CSSProperties = {
  border: '2px solid var(--reblas-outline)',
  borderRadius: 14,
  overflow: 'hidden',
  background: 'rgba(0,0,0,0.10)',
};

const headerCell: React.CSSProperties = {
  padding: '10px 0',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
};

const rowBase: React.CSSProperties = {
  height: 58,
  padding: '6px 12px',
  display: 'flex',
  alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const stripeBg = 'rgba(255,255,255,0.03)';
const clearBg = 'transparent';

function formatWhole(n: number) {
  return Math.max(0, Math.floor(Number(n || 0))).toLocaleString();
}

function itemTypeLabel(row: ScavRow) {
  if (row.itemType === 'aggregate' && row.aggregateGroup === 'garbage') return 'Aggregate: Garbage';
  if (row.itemType === 'aggregate') return 'Aggregate';
  return '';
}

function completionBg(isComplete: boolean) {
  return isComplete ? 'rgba(182,215,168,0.18)' : 'rgba(234,153,153,0.16)';
}

function memberDisplayName(member?: GuildMemberOption | null) {
  return String(member?.displayName || member?.nick || member?.globalName || member?.username || member?.id || '').trim();
}

const ScavHuntTrackerPage = () => {
  const {settings, loading: settingsLoading} = useGuildSettings();
  const {data: session} = useSession();
  const myId = String((session as any)?.discordId || '').trim();
  const {previewMemberMode, previewMemberId, actualCanManageSettings} = useOwnerPreviewMode(settings, myId);
  const canManage = actualCanManageSettings && !previewMemberMode;
  const canEditEntries = Boolean(session) && !previewMemberMode;
  const [payload, setPayload] = useState<ScavHuntPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [personMemberId, setPersonMemberId] = useState('');
  const [removePersonId, setRemovePersonId] = useState('');
  const [personPosition, setPersonPosition] = useState('');
  const [personErr, setPersonErr] = useState('');
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemSection, setItemSection] = useState<ScavSection>('main');
  const [itemType, setItemType] = useState<ScavItemType>('standard');
  const [itemAggregateGroup, setItemAggregateGroup] = useState<ScavAggregateGroup>('');
  const [itemTotalNeeded, setItemTotalNeeded] = useState('');
  const [itemPosition, setItemPosition] = useState('');
  const [itemErr, setItemErr] = useState('');
  const [availableMembers, setAvailableMembers] = useState<GuildMemberOption[]>([]);
  const [availableItems, setAvailableItems] = useState<ItemOption[]>([]);

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

  const loadTracker = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchJsonCached<ScavHuntPayload>(SCAV_HUNT_URL, 10_000);
      setPayload(next);
    } catch (e: any) {
      setPayload(null);
      setError(e?.message || 'Failed to load scav hunt tracker');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (settingsLoading) return;
    void loadTracker();
  }, [loadTracker, settingsLoading]);

  React.useEffect(() => {
    if (settingsLoading || !canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const [membersPayload, itemsPayload] = await Promise.all([
          fetchJsonCached<MembersPayload>(MEMBERS_URL, 15_000),
          fetchJsonCached<ItemsPayload>(ITEMS_URL, 15_000),
        ]);
        if (cancelled) return;
        setAvailableMembers(Array.isArray(membersPayload?.members) ? membersPayload.members : EMPTY_MEMBER_OPTIONS);
        setAvailableItems(Array.isArray(itemsPayload?.items) ? itemsPayload.items : EMPTY_ITEM_OPTIONS);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load members or items');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, settingsLoading]);

  const people = useMemo(() => payload?.people || EMPTY_PEOPLE, [payload]);
  const mainItems = useMemo(() => payload?.mainItems || EMPTY_ROWS, [payload]);
  const garbageItems = useMemo(() => payload?.garbageItems || EMPTY_ROWS, [payload]);
  const addableMembers = useMemo(() => {
    const existingIds = new Set(people.map((person) => String(person.id || '').trim()));
    return [...availableMembers]
      .filter((member) => !existingIds.has(String(member.id || '').trim()))
      .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b)));
  }, [availableMembers, people]);
  const activeItems = useMemo(
    () => [...availableItems].filter((item) => item.active).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [availableItems]
  );
  const addableItems = useMemo(() => {
    if (editingItemId || itemType === 'aggregate') return activeItems;
    const rows = itemSection === 'garbage' ? garbageItems : mainItems;
    const usedNames = new Set(
      rows
        .filter((row) => row.itemType === 'standard')
        .map((row) => String(row.name || '').trim().toLowerCase())
    );
    return activeItems.filter((item) => !usedNames.has(String(item.name || '').trim().toLowerCase()));
  }, [activeItems, editingItemId, garbageItems, itemSection, itemType, mainItems]);

  React.useEffect(() => {
    if (!itemModalOpen || editingItemId || itemType !== 'standard') return;
    if (addableItems.length === 0) {
      if (itemName) setItemName('');
      return;
    }
    if (!addableItems.some((item) => String(item.name || '') === itemName)) {
      setItemName(String(addableItems[0]?.name || ''));
    }
  }, [addableItems, editingItemId, itemModalOpen, itemName, itemType]);

  const refreshData = async () => {
    invalidateJsonCache(SCAV_HUNT_URL);
    await loadTracker();
  };

  const postAction = useCallback(
    async (body: Record<string, any>) => {
      const res = await previewFetch(SCAV_HUNT_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any)?.error || `Request failed (${res.status})`);
      return json;
    },
    [previewFetch]
  );

  const openAddPerson = () => {
    if (!canManage) return;
    setPersonMemberId(String(addableMembers[0]?.id || ''));
    setRemovePersonId(String(people[0]?.id || ''));
    setPersonPosition('');
    setPersonErr('');
    setAddPersonOpen(true);
  };

  const openAddItem = () => {
    if (!canManage) return;
    setEditingItemId('');
    setItemName('');
    setItemSection('main');
    setItemType('standard');
    setItemAggregateGroup('');
    setItemTotalNeeded('');
    setItemPosition('');
    setItemErr('');
    setItemModalOpen(true);
  };

  const openEditItem = (row: ScavRow) => {
    if (!canManage) return;
    setEditingItemId(row.id);
    setItemName(row.name);
    setItemSection(row.section);
    setItemType(row.itemType);
    setItemAggregateGroup(row.aggregateGroup || '');
    setItemTotalNeeded(String(row.totalNeededWhole || ''));
    setItemPosition(row.position > 0 ? String(row.position) : '');
    setItemErr('');
    setItemModalOpen(true);
  };

  const savePerson = async () => {
    const memberId = String(personMemberId || '').trim();
    if (!memberId) return setPersonErr('Select a member to add.');
    setSavingKey('person');
    setPersonErr('');
    try {
      await postAction({
        action: 'create_person',
        memberId,
        position: personPosition,
      });
      setAddPersonOpen(false);
      await refreshData();
    } catch (e: any) {
      setPersonErr(e?.message || 'Failed to add person');
    } finally {
      setSavingKey('');
    }
  };

  const removePerson = async () => {
    const personId = String(removePersonId || '').trim();
    if (!personId) return setPersonErr('Select a member to remove.');
    setSavingKey('removePerson');
    setPersonErr('');
    try {
      await postAction({
        action: 'remove_person',
        personId,
      });
      setAddPersonOpen(false);
      await refreshData();
    } catch (e: any) {
      setPersonErr(e?.message || 'Failed to remove member');
    } finally {
      setSavingKey('');
    }
  };

  const saveItem = async () => {
    const name = String(itemName || '').trim();
    if (!name) return setItemErr('Item name is required.');
    if (itemType === 'aggregate' && !itemAggregateGroup) return setItemErr('Select an aggregate source.');
    setSavingKey('item');
    setItemErr('');
    try {
      await postAction({
        action: editingItemId ? 'update_item' : 'create_item',
        itemId: editingItemId,
        name,
        section: itemSection,
        itemType,
        aggregateGroup: itemType === 'aggregate' ? itemAggregateGroup : '',
        totalNeededWhole: itemTotalNeeded,
        position: itemPosition,
      });
      setItemModalOpen(false);
      await refreshData();
    } catch (e: any) {
      setItemErr(e?.message || 'Failed to save item');
    } finally {
      setSavingKey('');
    }
  };

  const submitQtyInVan = async (row: ScavRow, raw: string) => {
    setSavingKey(`van:${row.id}`);
    try {
      await postAction({
        action: 'set_qty_in_van',
        itemId: row.id,
        qtyWhole: raw,
      });
      await refreshData();
    } catch (e: any) {
      setError(e?.message || 'Failed to save Qty In Van');
    } finally {
      setSavingKey('');
    }
  };

  const submitPersonAmount = async (row: ScavRow, personId: string, raw: string) => {
    setSavingKey(`cell:${row.id}:${personId}`);
    try {
      await postAction({
        action: 'set_person_amount',
        itemId: row.id,
        personId,
        qtyWhole: raw,
      });
      await refreshData();
    } catch (e: any) {
      setError(e?.message || 'Failed to save cell');
    } finally {
      setSavingKey('');
    }
  };

  const clearTracker = async () => {
    if (!canManage) return;
    setSavingKey('clear');
    setError('');
    try {
      await postAction({action: 'clear_tracker'});
      await refreshData();
    } catch (e: any) {
      setError(e?.message || 'Failed to clear tracker');
    } finally {
      setSavingKey('');
    }
  };

  const renderSection = (title: string, rows: ScavRow[], opts?: {hideNeeded?: boolean}) => {
    const hideNeeded = Boolean(opts?.hideNeeded);
    const metricColumns = hideNeeded ? ['In Van', 'Remaining', 'Collected'] : ['Needed', 'In Van', 'Remaining', 'Collected'];
    const itemColumn = hideNeeded ? 'minmax(224px, 1fr)' : '232px';
    const trailingColumnCount = metricColumns.length + people.length;
    const trailingColumns = trailingColumnCount > 0 ? Array(trailingColumnCount).fill('minmax(72px, 1fr)').join(' ') : '';
    const gridTemplateColumns = trailingColumns ? `${itemColumn} ${trailingColumns}` : itemColumn;
    const minWidth = Number.parseInt(itemColumn, 10) + trailingColumnCount * 72;

    return (
      <div style={{overflowX: 'auto'}}>
        <div style={{width: '100%', minWidth}}>
          <div style={colCard}>
            <div style={headerCell}>
              <div style={{display: 'grid', gridTemplateColumns, gap: 0, alignItems: 'stretch'}}>
                <div style={{display: 'flex', alignItems: 'center', height: '100%', padding: '0 14px'}}>
                  <Text b css={{mb: 0}}>{title}</Text>
                </div>
                {metricColumns.map((label) => (
                  <div
                    key={label}
                    style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}
                  >
                    <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.10em', textTransform: 'uppercase'}}>
                      {label}
                    </Text>
                  </div>
                ))}
                {people.map((person) => (
                  <div
                    key={person.id}
                    style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}
                  >
                    <Text size="$xs" css={{mb: 0, opacity: 0.75, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                      {person.name}
                    </Text>
                  </div>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <div style={{padding: 14}}>
                <Text size="$sm" css={{opacity: 0.7}}>No items added yet.</Text>
              </div>
            ) : (
              rows.map((row, idx) => {
                const bg = idx % 2 === 1 ? stripeBg : clearBg;
                return (
                  <div key={row.id} style={{...rowBase, padding: 0, background: bg}}>
                    <div style={{display: 'grid', gridTemplateColumns, gap: 0, width: '100%', alignItems: 'stretch'}}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', minWidth: 0}}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            minWidth: 0,
                            width: '100%',
                            height: '100%',
                            background: completionBg(row.isComplete),
                            padding: '0 10px',
                            borderRadius: 8,
                          }}
                        >
                          <Avatar size="xs" squared css={{boxShadow: '0 0 0 1px var(--reblas-outline)', minWidth: 20, width: 20, height: 20}}>
                            {row.name.slice(0, 1).toUpperCase()}
                          </Avatar>
                          <div style={{minWidth: 0}}>
                            <Text size="$sm" b css={{mb: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                              {row.name}
                            </Text>
                            <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                              {itemTypeLabel(row) ? (
                                <Text size="$xs" css={{mb: 0, opacity: 0.68, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                  {itemTypeLabel(row)}
                                </Text>
                              ) : null}
                              {canManage ? (
                                <button
                                  type="button"
                                  onClick={() => openEditItem(row)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    padding: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    color: 'rgba(255,255,255,0.78)',
                                    cursor: 'pointer',
                                  }}
                                  aria-label={`Edit ${row.name}`}
                                >
                                  <EditIcon size={13} fill="currentColor" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      {hideNeeded ? null : (
                        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: 8, background: completionBg(row.isComplete)}}>
                            <Text size="$sm" b css={{mb: 0, color: 'var(--reblas-btn1-color)', whiteSpace: 'nowrap'}}>
                              {row.totalNeededWhole > 0 ? formatWhole(row.totalNeededWhole) : '-'}
                            </Text>
                          </div>
                        </div>
                      )}
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: 8, background: completionBg(row.isComplete)}}>
                          {canEditEntries && row.canEditAdded ? (
                            <input
                              key={`${row.id}:van:${row.qtyInVanWhole}`}
                              defaultValue={row.qtyInVanWhole ? String(row.qtyInVanWhole) : ''}
                              onBlur={(e) => void submitQtyInVan(row, e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                              style={{
                                width: 64,
                                height: 28,
                                borderRadius: 8,
                                border: '1px solid rgba(255,255,255,0.18)',
                                background: 'rgba(0,0,0,0.18)',
                                color: 'white',
                                textAlign: 'center',
                                fontSize: 12,
                              }}
                            />
                          ) : (
                            <Text size="$sm" b css={{mb: 0, color: 'var(--reblas-btn2-color)', whiteSpace: 'nowrap'}}>
                              {row.qtyInVanWhole !== 0 ? formatWhole(row.qtyInVanWhole) : '-'}
                            </Text>
                          )}
                        </div>
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: 8, background: completionBg(row.isComplete)}}>
                          <Text
                            size="$sm"
                            b
                            css={{
                              mb: 0,
                              color: row.qtyNeededWhole <= 0 ? 'var(--reblas-btn2-color)' : 'var(--reblas-btn3-color)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.qtyNeededWhole > 0 ? formatWhole(row.qtyNeededWhole) : '0'}
                          </Text>
                        </div>
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}>
                        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: 8, background: completionBg(row.isComplete)}}>
                          <Text
                            size="$sm"
                            b
                            css={{
                              mb: 0,
                              color: row.isComplete ? 'var(--reblas-btn2-color)' : 'var(--reblas-btn1-color)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.totalCollectedWhole !== 0 ? formatWhole(row.totalCollectedWhole) : '0'}
                          </Text>
                        </div>
                      </div>

                      {people.map((person) => {
                        const currentValue = Number(row.peopleTotals[person.id] || 0);
                        const inputKey = `${row.id}:${person.id}:${currentValue}`;
                        return (
                          <div
                            key={person.id}
                            style={{display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 10px', borderLeft: '1px solid rgba(255,255,255,0.08)'}}
                          >
                            {row.canEditPeople && canEditEntries ? (
                              <input
                                key={inputKey}
                                defaultValue={currentValue ? String(currentValue) : ''}
                                onBlur={(e) => void submitPersonAmount(row, person.id, e.currentTarget.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                  }
                                }}
                                style={{
                                  width: 54,
                                  height: 28,
                                  borderRadius: 7,
                                  border: '1px solid rgba(255,255,255,0.18)',
                                  background: 'rgba(0,0,0,0.18)',
                                  color: 'white',
                                  textAlign: 'center',
                                  fontSize: 12,
                                }}
                              />
                            ) : (
                              <Text b size="$xs" css={{mb: 0, color: 'var(--reblas-btn1-color)', whiteSpace: 'nowrap'}}>
                                {currentValue ? formatWhole(currentValue) : '-'}
                              </Text>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  };

  if (settingsLoading) return null;

  return (
    <div style={{padding: 18}}>
      <Card css={glassCardCss}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap'}}>
          <div>
            <Text h3 css={{mb: 2, lineHeight: 1.1}}>Scav Hunt Tracker</Text>
            <Text size="$xs" css={{opacity: 0.68, mb: 0}}>
              Spreadsheet-style tracker using your dashboard members and items, with owner-only setup controls.
            </Text>
          </div>
          <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
            {canManage ? (
              <>
                <Button auto className="reblas-btn-1" onPress={openAddPerson}>
                  Add Member
                </Button>
                <Button auto className="reblas-btn-2" onPress={openAddItem}>
                  Add Item
                </Button>
                <Button auto className="reblas-btn-3" onPress={() => void clearTracker()} disabled={savingKey === 'clear'}>
                  Clear Values
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <Spacer y={0.5} />

        {previewMemberMode ? (
          <>
            <Card css={{p: '$4', mb: '$5', background: 'rgba(120, 70, 0, 0.24)', border: '2px solid var(--reblas-outline)'}}>
              <Text b css={{mb: '$1'}}>Member View Active</Text>
              <Text size="$xs" css={{opacity: 0.86, mb: 0}}>
                Viewing as member {previewMemberId}. Scav Hunt Tracker is read-only in this mode.
              </Text>
            </Card>
          </>
        ) : null}

        {error ? (
          <>
            <Card css={{p: '$4', mb: '$5', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
              <Text size="$sm" css={{mb: 0}}>
                {error}
              </Text>
            </Card>
          </>
        ) : null}

        {loading ? (
          <Text size="$sm" css={{opacity: 0.72}}>
            Loading scav hunt tracker…
          </Text>
        ) : (
          <>
            <div style={{display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12}}>
              <Text size="$sm" css={{mb: 0, opacity: 0.76}}>
                Items: <b>{payload?.totals?.itemCount || 0}</b>
              </Text>
              <Text size="$sm" css={{mb: 0, opacity: 0.76}}>
                People: <b>{payload?.totals?.peopleCount || 0}</b>
              </Text>
            </div>

            {renderSection('Items Required', mainItems)}

            <Spacer y={0.8} />

            {renderSection('Garbage Breakdown', garbageItems, {hideNeeded: true})}

            <Spacer y={0.8} />

            <Card css={{p: '$5', background: 'rgba(0,0,0,0.16)', border: '2px solid var(--reblas-outline)'}}>
              <Text b css={{mb: '$2'}}>How This Works</Text>
              <Text size="$sm" css={{mb: '$1', opacity: 0.82}}>
                `Qty In Van` is editable directly for standard items.
              </Text>
              <Text size="$sm" css={{mb: '$1', opacity: 0.82}}>
                `Total Collected` is always `Qty In Van + all person amounts`.
              </Text>
              <Text size="$sm" css={{mb: 0, opacity: 0.82}}>
                `Qty Needed` is always `max(0, Total Needed - Total Collected)`.
              </Text>
            </Card>
          </>
        )}
      </Card>

      <Modal
        closeButton
        blur
        aria-label="Manage scav hunt members"
        open={addPersonOpen}
        onClose={() => setAddPersonOpen(false)}
        width="520px"
        css={{
          background: 'rgba(0,0,0,0.22)',
          border: '2px solid var(--reblas-outline)',
          backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
          borderRadius: 14,
        }}
      >
        <Modal.Header>
          <Text b css={{mb: 0}}>Add Member</Text>
        </Modal.Header>
        <Modal.Body>
          {personErr ? <Text size="$sm" css={{mb: 0, color: 'var(--reblas-btn3-color)'}}>{personErr}</Text> : null}
          <div style={{display: 'grid', gap: 6}}>
            <Text size="$sm" css={{opacity: 0.78, mb: 0}}>Member From Main Guild</Text>
            <select
              value={personMemberId}
              onChange={(e) => setPersonMemberId(String(e.target.value || ''))}
              style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
            >
              <option value="">{addableMembers.length ? 'Select member' : 'No members available to add'}</option>
              {addableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberDisplayName(member)}
                </option>
              ))}
            </select>
          </div>
          <Input
            bordered
            fullWidth
            label="Position"
            value={personPosition}
            onChange={(e) => setPersonPosition(String(e.target.value || '').replace(/[^0-9]/g, ''))}
          />
          <div style={{display: 'grid', gap: 6}}>
            <Text size="$sm" css={{opacity: 0.78, mb: 0}}>Remove Existing Member</Text>
            <select
              value={removePersonId}
              onChange={(e) => setRemovePersonId(String(e.target.value || ''))}
              style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
            >
              <option value="">{people.length ? 'Select member to remove' : 'No members added yet'}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button className="reblas-btn-1" auto onPress={() => setAddPersonOpen(false)} disabled={savingKey === 'person' || savingKey === 'removePerson'}>
            Cancel
          </Button>
          <Button className="reblas-btn-3" auto onPress={removePerson} disabled={savingKey === 'person' || savingKey === 'removePerson' || !removePersonId}>
            {savingKey === 'removePerson' ? 'Removing…' : 'Remove Member'}
          </Button>
          <Button className="reblas-btn-2" auto onPress={savePerson} disabled={savingKey === 'person' || savingKey === 'removePerson' || !personMemberId}>
            {savingKey === 'person' ? 'Saving…' : 'Add Member'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        closeButton
        blur
        aria-label="Save scav hunt item"
        open={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        width="640px"
        css={{
          background: 'rgba(0,0,0,0.22)',
          border: '2px solid var(--reblas-outline)',
          backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
          borderRadius: 14,
        }}
      >
        <Modal.Header>
          <Text b css={{mb: 0}}>{editingItemId ? 'Edit Item' : 'Add Item'}</Text>
        </Modal.Header>
        <Modal.Body>
          {itemErr ? <Text size="$sm" css={{mb: 0, color: 'var(--reblas-btn3-color)'}}>{itemErr}</Text> : null}
          {editingItemId || itemType === 'aggregate' ? (
            <Input
              bordered
              fullWidth
              label="Item Name"
              value={itemName}
              onChange={(e) => setItemName(String(e.target.value || '').slice(0, 120))}
            />
          ) : (
            <div style={{display: 'grid', gap: 6}}>
              <Text size="$sm" css={{opacity: 0.78, mb: 0}}>Item From Items List</Text>
              <select
                value={itemName}
                onChange={(e) => setItemName(String(e.target.value || ''))}
                style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
              >
                <option value="">{addableItems.length ? 'Select item' : 'No active items available'}</option>
                {addableItems.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
            <div style={{display: 'grid', gap: 6}}>
              <Text size="$sm" css={{opacity: 0.78, mb: 0}}>Section</Text>
              <select
                value={itemSection}
                onChange={(e) => setItemSection(e.target.value === 'garbage' ? 'garbage' : 'main')}
                style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
              >
                <option value="main">Main Hunt</option>
                <option value="garbage">Garbage Breakdown</option>
              </select>
            </div>
            <div style={{display: 'grid', gap: 6}}>
              <Text size="$sm" css={{opacity: 0.78, mb: 0}}>Type</Text>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value === 'aggregate' ? 'aggregate' : 'standard')}
                style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
              >
                <option value="standard">Standard Item</option>
                <option value="aggregate">Aggregate Row</option>
              </select>
            </div>
          </div>
          {itemType === 'aggregate' ? (
            <div style={{display: 'grid', gap: 6}}>
              <Text size="$sm" css={{opacity: 0.78, mb: 0}}>Aggregate Source</Text>
              <select
                value={itemAggregateGroup}
                onChange={(e) => setItemAggregateGroup(e.target.value === 'garbage' ? 'garbage' : '')}
                style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
              >
                <option value="">Select source</option>
                <option value="garbage">Garbage Breakdown</option>
              </select>
            </div>
          ) : null}
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
            <Input
              bordered
              fullWidth
              label="Total Needed"
              value={itemTotalNeeded}
              onChange={(e) => setItemTotalNeeded(String(e.target.value || '').replace(/[^0-9]/g, ''))}
            />
            <Input
              bordered
              fullWidth
              label="Position"
              value={itemPosition}
              onChange={(e) => setItemPosition(String(e.target.value || '').replace(/[^0-9]/g, ''))}
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button className="reblas-btn-1" auto onPress={() => setItemModalOpen(false)} disabled={savingKey === 'item'}>
            Cancel
          </Button>
          <Button className="reblas-btn-2" auto onPress={saveItem} disabled={savingKey === 'item'}>
            {savingKey === 'item' ? 'Saving…' : editingItemId ? 'Save Item' : 'Add Item'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default ScavHuntTrackerPage;
