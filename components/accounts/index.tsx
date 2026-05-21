import React, {useEffect, useMemo, useState} from 'react';
import {Avatar, Card, Input, Pagination, Spacer, Text} from '@nextui-org/react';
import {useGuildSettings} from '../../lib/guild-settings';
import {fetchJsonCached, invalidateJsonCache} from '../../lib/client/request-cache';

type RoleInfo = {id: string; name: string; position: number; color?: number};

type Member = {
  id: string;
  username?: string;
  globalName?: string;
  nick?: string;
  displayName?: string;
  avatarUrl?: string;

  roles?: string[];
  rolesSorted?: string[];

  // placeholders (future)
  mobileNumber?: string | null;
  ibanAccount?: string | null;
  isPrevMonthTopDirty?: boolean;
};

type MembersPayload = {
  importedAt?: string | null;
  count?: number;
  members?: Member[];
  roleOrder?: RoleInfo[];
  roleMap?: Record<string, {name: string; position: number; color?: number}>;
};

const glassCardCss = {
  p: '$10',
  background: 'rgba(0,0,0,0.14)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
};

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return '';
  }
}

function discordColorHex(color?: number) {
  const n = Number(color || 0);
  if (!n) return '#9ca3af';
  return '#' + n.toString(16).padStart(6, '0');
}

function roleName(id: string, roleMap: Record<string, any>) {
  const name = String(roleMap?.[id]?.name || '').trim();
  return name || '';
}

export const Accounts = () => {
  const {settings} = useGuildSettings();
  const isSubCrew = settings.viewerRole === 'subcrew';
  const title = isSubCrew ? `${settings.viewerSubCrewName || 'Sub Crew'} Members` : 'Members';
  const subtitle = isSubCrew ? 'Sub crew roster' : 'members';

  const displayRoleSet = useMemo(
    () => new Set((settings.membersDisplayRoleIds || []).map(String)),
    [settings.membersDisplayRoleIds]
  );
  const excludeRoleSet = useMemo(
    () => new Set((settings.membersExcludeRoleIds || []).map(String)),
    [settings.membersExcludeRoleIds]
  );

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [meta, setMeta] = useState<{importedAt: string | null; count: number}>({
    importedAt: null,
    count: 0,
  });

  const [members, setMembers] = useState<Member[]>([]);
  const [roleMap, setRoleMap] = useState<Record<string, any>>({});
  const [query, setQuery] = useState('');

  const [page, setPage] = useState(1);
  const pageSize = 12;
  const MEMBERS_LIST_URL = '/api/members/list';

  const fetchMembers = async (force = false) => {
    setErr('');
    setLoading(true);
    try {
      if (force) invalidateJsonCache(MEMBERS_LIST_URL);
      const payload = (await fetchJsonCached<any>(MEMBERS_LIST_URL, 15000)) as MembersPayload;
      const list = Array.isArray(payload.members) ? payload.members : [];

      setMembers(list);
      setRoleMap((payload.roleMap || {}) as any);

      setMeta({
        importedAt: payload.importedAt || null,
        count: typeof payload.count === 'number' ? payload.count : list.length,
      });
    } catch (e: any) {
      setErr(e?.message || 'Failed to load members');
      setMembers([]);
      setRoleMap({});
      setMeta({importedAt: null, count: 0});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => {
      void fetchMembers(true);
    };
    window.addEventListener('reblas-profile-updated', handler as any);
    return () => window.removeEventListener('reblas-profile-updated', handler as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const filtered = useMemo(() => {
    if (isSubCrew) {
      const q = query.trim().toLowerCase();
      if (!q) return members;

      return members.filter((m) => {
        const name = String(m.displayName || m.nick || m.globalName || m.username || '').toLowerCase();
        const id = String(m.id || '').toLowerCase();
        const user = String(m.username || '').toLowerCase();
        const roleIds = (m.rolesSorted || m.roles || []) as string[];
        const roleNames = roleIds
          .map((rid) => roleName(String(rid), roleMap))
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return name.includes(q) || id.includes(q) || user.includes(q) || roleNames.includes(q);
      });
    }

    const excludeFiltered = members.filter((m) => {
      if (excludeRoleSet.size === 0) return true;
      const roleIds = (m.rolesSorted || m.roles || []) as string[];
      return !roleIds.some((rid) => excludeRoleSet.has(String(rid)));
    });

    const q = query.trim().toLowerCase();
    if (!q) return excludeFiltered;

    return excludeFiltered.filter((m) => {
      const name = String(m.displayName || m.nick || m.globalName || m.username || '').toLowerCase();
      const id = String(m.id || '').toLowerCase();
      const user = String(m.username || '').toLowerCase();

      const roleIds = (m.rolesSorted || m.roles || []) as string[];
      const roleNames = roleIds
        .map((rid) => roleName(String(rid), roleMap))
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return name.includes(q) || id.includes(q) || user.includes(q) || roleNames.includes(q);
    });
  }, [excludeRoleSet, isSubCrew, members, query, roleMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  // column sizes
  const colMember = 310;
  const colMobile = 190;
  const colIban = 190; // same width
  const gap = 12;

  // keep row heights aligned across columns
  const rowH = 96;

  const minWidth = colMember + colMobile + colIban + 560 + (gap * 3);

  const colCard: React.CSSProperties = {
    border: '2px solid var(--reblas-outline)',
    borderRadius: 14,
    overflow: 'hidden',
    background: 'rgba(0,0,0,0.10)',
  };

  const headerCell: React.CSSProperties = {
    padding: '14px 14px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.03)',
  };

  const rowBase: React.CSSProperties = {
    height: rowH,
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  };

  const stripeBg = 'rgba(255,255,255,0.03)'; // only on every second row
  const clearBg = 'transparent';

  return (
    <div style={{padding: 22}}>
      <Card css={glassCardCss}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap'}}>
          <div>
            <Text h3 css={{mb: 0}}>{title}</Text>
            <Text size="$sm" css={{opacity: 0.7}}>
              {meta.importedAt ? `Last import: ${fmtDate(meta.importedAt)} • ` : ''}
              {meta.count} {subtitle}
            </Text>
          </div>

          <Input
            aria-label="Search members"
            clearable
            placeholder="Search members…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            css={{minWidth: 260}}
          />
        </div>

        <Spacer y={0.8} />

        {err ? (
          <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
            <Text b>Error</Text>
            <Text size="$sm" css={{opacity: 0.9}}>{err}</Text>
          </Card>
        ) : null}

        <div style={{overflowX: 'auto'}}>
          <div
            style={{
              minWidth,
              display: 'grid',
              gridTemplateColumns: `${colMember}px 1fr ${colMobile}px ${colIban}px`,
              gap,
              alignItems: 'start',
            }}
          >
            {/* MEMBERS COLUMN (one card) */}
            <div style={colCard}>
              <div style={headerCell}>
                <Text b css={{mb: 0}}>Members</Text>
              </div>

              {loading ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
                </div>
              ) : pageItems.length === 0 ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>No members found.</Text>
                </div>
              ) : (
                pageItems.map((m, idx) => {
                  const allRoleIds = (m.rolesSorted || m.roles || []) as string[];
                  const showRoleIds =
                    displayRoleSet.size > 0 ? allRoleIds.filter((rid) => displayRoleSet.has(String(rid))) : allRoleIds;

                  const rankRoleId = showRoleIds[0] || allRoleIds[0] || '';
                  const rankName = rankRoleId ? roleName(rankRoleId, roleMap) : '';

                  const bg = idx % 2 === 1 ? stripeBg : clearBg;

                  return (
                    <div key={m.id} style={{...rowBase, background: bg, gap: 12}}>
                      <Avatar src={m.avatarUrl || undefined} size="md" css={{boxShadow: '0 0 0 1px var(--reblas-outline)'}} />
                      <div style={{display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0}}>
                        <Text b css={{mb: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                          {renderMemberName(m)}
                        </Text>
                        <Text size="$xs" css={{opacity: 0.75, mb: 0, textTransform: 'uppercase', letterSpacing: '0.06em'}}>
                          {rankName || '—'}
                        </Text>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* ROLES COLUMN (one card) */}
            <div style={colCard}>
              <div style={headerCell}>
                <Text b css={{mb: 0}}>Roles</Text>
              </div>

              {loading ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
                </div>
              ) : pageItems.length === 0 ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>—</Text>
                </div>
              ) : (
                pageItems.map((m, idx) => {
                  const allRoleIds = (m.rolesSorted || m.roles || []) as string[];
                  const showRoleIds =
                    displayRoleSet.size > 0 ? allRoleIds.filter((rid) => displayRoleSet.has(String(rid))) : allRoleIds;

                  const bg = idx % 2 === 1 ? stripeBg : clearBg;

                  // Keep row height consistent: no wrapping
                  const maxPills = 16;
                  const visible = showRoleIds.slice(0, maxPills);
                  const remaining = Math.max(0, showRoleIds.length - visible.length);

                  return (
                    <div key={m.id} style={{...rowBase, background: bg}}>
                      <div style={{display: 'flex', gap: 6, alignItems: 'center', width: '100%', overflow: 'hidden', flexWrap: 'wrap', maxHeight: 44, alignContent: 'flex-start'}}>
                        {visible.length === 0 ? (
                          <Text size="$sm" css={{opacity: 0.6}}>—</Text>
                        ) : (
                          <>
                            {visible.map((rid) => {
                              const name = roleName(String(rid), roleMap);
                              if (!name) return null;

                              const c = discordColorHex(roleMap?.[rid]?.color);

                              return (
                                <span
                                  key={rid}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    padding: '3px 8px',
                                    borderRadius: 999,
                                    border: `1px solid ${c}55`,
                                    background: `${c}14`,
                                    color: c,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    lineHeight: 1,
                                    letterSpacing: '0.02em',
                                    whiteSpace: 'nowrap',
                                    boxShadow: '0 0 0 1px rgba(0,0,0,0.25) inset',
                                  }}
                                >
                                  {name}
                                </span>
                              );
                            })}
                            {remaining > 0 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '3px 8px',
                                  borderRadius: 999,
                                  border: '1px solid rgba(255,255,255,0.18)',
                                  background: 'rgba(255,255,255,0.06)',
                                  color: 'rgba(255,255,255,0.75)',
                                  fontSize: 11,
                                  fontWeight: 700,
                                    lineHeight: 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                +{remaining}
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* MOBILE COLUMN (one card) */}
            <div style={colCard}>
              <div style={headerCell}>
                <Text b css={{mb: 0}}>Mobile Number</Text>
              </div>

              {loading ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
                </div>
              ) : pageItems.length === 0 ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>—</Text>
                </div>
              ) : (
                pageItems.map((m, idx) => {
                  const bg = idx % 2 === 1 ? stripeBg : clearBg;
                  return (
                    <div key={m.id} style={{...rowBase, background: bg, justifyContent: 'center'}}>
                      <Text size="$sm" css={{opacity: 0.6}}>
                        {m.mobileNumber ? String(m.mobileNumber) : '—'}
                      </Text>
                    </div>
                  );
                })
              )}
            </div>

            {/* IBAN COLUMN (one card) */}
            <div style={colCard}>
              <div style={headerCell}>
                <Text b css={{mb: 0}}>IBAN Account</Text>
              </div>

              {loading ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>Loading…</Text>
                </div>
              ) : pageItems.length === 0 ? (
                <div style={{padding: 14}}>
                  <Text size="$sm" css={{opacity: 0.7}}>—</Text>
                </div>
              ) : (
                pageItems.map((m, idx) => {
                  const bg = idx % 2 === 1 ? stripeBg : clearBg;
                  return (
                    <div key={m.id} style={{...rowBase, background: bg, justifyContent: 'center'}}>
                      <Text size="$sm" css={{opacity: 0.6}}>
                        {m.ibanAccount ? String(m.ibanAccount) : '—'}
                      </Text>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <Spacer y={0.9} />

        <div style={{display: 'flex', justifyContent: 'center'}}>
          <Pagination total={totalPages} page={page} onChange={setPage} />
        </div>
      </Card>
    </div>
  );
};
  const renderMemberName = (m: Member) => {
    const display = String(m.displayName || m.nick || m.globalName || m.username || m.id);
    return (
      <>
        {display}
        {m.isPrevMonthTopDirty ? (
          <span style={{color: '#fbbf24', marginLeft: 6, fontSize: 12, verticalAlign: 'middle'}}>★</span>
        ) : null}
      </>
    );
  };
