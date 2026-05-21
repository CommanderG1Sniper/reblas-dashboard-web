import type {NextPage} from 'next';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Avatar, Button, Card, Dropdown, Input, Popover, Spacer, Text} from '@nextui-org/react';
import {Box} from '../components/styles/box';
import {Flex} from '../components/styles/flex';
import {useGuildSettings, type ReactionRole} from '../lib/guild-settings';
import {useSession} from 'next-auth/react';
import {useRouter} from 'next/router';
import {createSubCrewId, isHexColor, type SubCrew} from '../lib/sub-crews';
import {fetchJsonCached, invalidateJsonCache} from '../lib/client/request-cache';
import {useOwnerPreviewMode} from '../lib/client/owner-preview';

const CONFIRM_PHRASE = 'Confirm Transfer My Ownership';

type RoleInfo = {id: string; name: string; position: number; color?: number};
type MemberInfo = {id: string; username?: string; globalName?: string; nick?: string; displayName?: string; avatarUrl?: string};
type WeeklyTemplateId = 'weekly_outstanding' | 'weekly_uptodate' | 'weekly_credit';
type Frequency = 'daily' | 'weekly';
type WeeklyTemplate = {
  id: WeeklyTemplateId;
  name: string;
  title: string;
  description: string;
  notice: string;
  statusLabel: string;
  statusEmoji: string;
};
type SubCrewEmbedTemplateId = 'subcrew_wash_log' | 'subcrew_order_update';
type SubCrewEmbedTemplate = {
  id: SubCrewEmbedTemplateId;
  name: string;
  title: string;
  description: string;
  color: string;
};
type AnnouncementEmbed = {
  id: string;
  name: string;
  title: string;
  description: string;
  channelId: string;
  mentionRoleIds: string[];
  frequency: Frequency;
  dayOfWeek: number;
  timeHHMM: string;
  color: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
type SubCrewDraft = SubCrew;
type ItemMaterialRequirement = {
  matId: string;
  quantity: number;
};
type ItemRecord = {
  id: string;
  name: string;
  description: string;
  category: 'mats' | 'orders';
  imageUrl: string;
  dirtyWashRequirementCents: number;
  cleanCashCents: number;
  dirtyCashCents: number;
  materials: ItemMaterialRequirement[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
type EmbedsStore = {
  schemaVersion: number;
  weeklyTemplates: Record<WeeklyTemplateId, WeeklyTemplate>;
  weeklySummaryChannelId: string;
  weeklySummaryRoleId: string;
  subCrewTemplates: Record<SubCrewEmbedTemplateId, SubCrewEmbedTemplate>;
  announcements: AnnouncementEmbed[];
};
type ItemsStore = {
  schemaVersion: number;
  items: ItemRecord[];
};

type MembersListPayload = {
  members?: MemberInfo[];
  roleOrder?: RoleInfo[];
};

type EmojiItem = {emoji: string; name: string};

const DISCORD_SAFE_EMOJIS: EmojiItem[] = [
  {emoji: '😀', name: 'grinning face'}, {emoji: '😁', name: 'beaming face'}, {emoji: '😂', name: 'tears of joy'},
  {emoji: '🤣', name: 'rolling on floor laughing'}, {emoji: '😎', name: 'smiling face with sunglasses'}, {emoji: '😍', name: 'heart eyes'},
  {emoji: '😘', name: 'blowing a kiss'}, {emoji: '🤔', name: 'thinking face'}, {emoji: '😴', name: 'sleeping face'},
  {emoji: '🤯', name: 'exploding head'}, {emoji: '🥳', name: 'partying face'}, {emoji: '😇', name: 'smiling halo'},
  {emoji: '🔥', name: 'fire'}, {emoji: '✅', name: 'check mark'}, {emoji: '❌', name: 'cross mark'},
  {emoji: '⚠️', name: 'warning'}, {emoji: '🛑', name: 'stop sign'}, {emoji: '📢', name: 'loudspeaker'},
  {emoji: '📣', name: 'megaphone'}, {emoji: '📌', name: 'pin'}, {emoji: '📍', name: 'location pin'},
  {emoji: '📅', name: 'calendar'}, {emoji: '🗓️', name: 'spiral calendar'}, {emoji: '⏰', name: 'alarm clock'},
  {emoji: '⏳', name: 'hourglass'}, {emoji: '💸', name: 'money with wings'}, {emoji: '💰', name: 'money bag'},
  {emoji: '🧾', name: 'receipt'}, {emoji: '💳', name: 'credit card'}, {emoji: '🏦', name: 'bank'},
  {emoji: '📈', name: 'chart increasing'}, {emoji: '📉', name: 'chart decreasing'}, {emoji: '📊', name: 'bar chart'},
  {emoji: '📘', name: 'blue book'}, {emoji: '📕', name: 'red book'}, {emoji: '📗', name: 'green book'},
  {emoji: '📙', name: 'orange book'}, {emoji: '📚', name: 'books'}, {emoji: '📝', name: 'memo'},
  {emoji: '✍️', name: 'writing hand'}, {emoji: '📄', name: 'page facing up'}, {emoji: '📋', name: 'clipboard'},
  {emoji: '📦', name: 'package'}, {emoji: '🛠️', name: 'tools'}, {emoji: '⚙️', name: 'gear'},
  {emoji: '🔒', name: 'locked'}, {emoji: '🔓', name: 'unlocked'}, {emoji: '🧠', name: 'brain'},
  {emoji: '👀', name: 'eyes'}, {emoji: '👑', name: 'crown'}, {emoji: '🎉', name: 'party popper'},
  {emoji: '🎊', name: 'confetti ball'}, {emoji: '🚀', name: 'rocket'}, {emoji: '🙏', name: 'folded hands'},
  {emoji: '👍', name: 'thumbs up'}, {emoji: '👏', name: 'clapping hands'}, {emoji: '💯', name: 'hundred points'},
  {emoji: '🟢', name: 'green circle'}, {emoji: '🔵', name: 'blue circle'}, {emoji: '🔴', name: 'red circle'},
  {emoji: '🟠', name: 'orange circle'}, {emoji: '🟡', name: 'yellow circle'}, {emoji: '🟣', name: 'purple circle'},
];

const MEMBERS_LIST_URL = '/api/members/list';
const MEMBERS_SETTINGS_URL = '/api/members/settings';
const EMBEDS_URL = '/api/embeds';
const ITEMS_URL = '/api/items';

async function uploadOriginalToServer(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch('/api/upload', {method: 'POST', body: fd});
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const json = (await res.json()) as {url?: string};
  if (!json.url) throw new Error('Upload failed (no url returned)');
  return json.url;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('File read failed'));
    r.onload = () => resolve(String(r.result || ''));
    r.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(
  file: File,
  opts: {maxW: number; maxH: number; quality: number}
): Promise<string> {
  if (file.type === 'image/svg+xml') return fileToDataUrl(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = objectUrl;

    await (img.decode?.() ??
      new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image load failed'));
      }));

    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (!w || !h) return fileToDataUrl(file);

    const scale = Math.min(1, opts.maxW / w, opts.maxH / h);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;

    const ctx = canvas.getContext('2d');
    if (!ctx) return fileToDataUrl(file);

    ctx.drawImage(img, 0, 0, tw, th);

    let out = '';
    try {
      out = canvas.toDataURL('image/webp', opts.quality);
      if (!out.startsWith('data:image/webp')) throw new Error('webp not supported');
    } catch {
      out = canvas.toDataURL('image/jpeg', Math.min(0.92, opts.quality));
    }
    return out;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function roleColorHex(color?: number) {
  const n = Number(color || 0);
  if (!n) return '#64748b';
  return '#' + n.toString(16).padStart(6, '0');
}

function formatWholeCents(amount: number) {
  return Math.round(Number(amount || 0) / 100).toLocaleString();
}

function parseRoleIdInput(value: string) {
  return Array.from(
    new Set(
      String(value || '')
        .split(/[^0-9]+/)
        .map((item) => item.trim())
        .filter((item) => /^\d{6,25}$/.test(item))
    )
  );
}

function formatRoleIdInput(roleIds: string[]) {
  return Array.isArray(roleIds) ? roleIds.join(', ') : '';
}

function normalizeTwitchLogin(raw: string) {
  let value = String(raw || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\/(www\.)?twitch\.tv\//, '');
  value = value.replace(/^@/, '');
  value = value.split(/[/?#]/)[0] || '';
  return /^[a-z0-9_]{3,25}$/.test(value) ? value : '';
}

type UploadKind = 'avatar' | 'background';

const glassCardCss = {
  p: '$8',
  background: 'rgba(0,0,0,0.18)',
  border: '2px solid var(--reblas-outline)',
  backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
};

const settingsTableHeaderStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 10px',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  opacity: 0.7,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const settingsTableCellStyle: React.CSSProperties = {
  padding: '14px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  verticalAlign: 'middle',
};

type UploadCardProps = {
  title: string;
  subtitle: string;
  kind: UploadKind;
  value: string;
  onChange: (next: string) => void;
};

const UploadCard = ({title, subtitle, kind, value, onChange}: UploadCardProps) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const pickFile = () => fileRef.current?.click();

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      window.alert('Please select an image file.');
      return;
    }

    setBusy(true);
    try {
      if (kind === 'background') {
        const url = await uploadOriginalToServer(file);
        onChange(url);
      } else {
        const dataUrl = await compressImageToDataUrl(file, {maxW: 512, maxH: 512, quality: 0.88});
        onChange(dataUrl);
      }
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      console.error(e);
      window.alert(kind === 'background' ? 'Background upload failed.' : 'Avatar upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    await handleFile(f);
  };

  const preview = useMemo(() => {
    const src = (value || '').trim();
    if (!src) return null;

    if (kind === 'avatar') {
      return (
        <Avatar squared size="xl" src={src} css={{border: '2px solid var(--reblas-outline)'}} />
      );
    }

    return (
      <div
        style={{
          width: 240,
          height: 120,
          borderRadius: 16,
          border: '2px solid var(--reblas-outline)',
          backgroundColor: 'rgba(255,255,255,0.02)',
          backgroundImage: `url("${src}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
    );
  }, [value, kind]);

  return (
    <Card css={glassCardCss}>
      <Flex direction="column" css={{gap: '$6'}}>
        <div>
          <Text css={{fontWeight: 900}}>{title}</Text>
          <Text size="$sm" css={{opacity: 0.7}}>{subtitle}</Text>
        </div>

        <Flex align="center" css={{gap: '$10', flexWrap: 'wrap'}}>
          <div>{preview}</div>

          <div style={{flex: 1, minWidth: 320}}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{
                borderRadius: 16,
                border: dragOver ? '2px dashed rgba(255,255,255,0.35)' : '2px dashed rgba(255,255,255,0.14)',
                background: dragOver ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)',
                padding: 16,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
              onClick={() => (busy ? null : pickFile())}
              role="button"
              tabIndex={0}
              aria-label="Upload image"
            >
              <Text css={{fontWeight: 800}}>{busy ? 'Uploading…' : 'Click to upload'}</Text>
              <Text size="$sm" css={{opacity: 0.7}}>or drag & drop an image here</Text>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  await handleFile(f);
                }}
                style={{display: 'none'}}
              />
            </div>

            <Spacer y={0.5} />

            <Input
              aria-label="Paste image URL (https://...)"
              label="Image URL"
              placeholder="Paste image URL (https://...)"
              fullWidth
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </Flex>

        <Flex css={{gap: '$6', flexWrap: 'wrap'}}>
          <Button auto flat className="reblas-btn-1" onPress={() => onChange('')}>Clear</Button>
        </Flex>
      </Flex>
    </Card>
  );
};

const ModalShell = ({children, onClose}: {children: React.ReactNode; onClose: () => void}) => {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{width: '100%', maxWidth: 860}}>
        {children}
      </div>
    </div>
  );
};

function RoleAddDropdown({
  roles,
  selectedIds,
  onAdd,
}: {
  roles: RoleInfo[];
  selectedIds: string[];
  onAdd: (roleId: string) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => String(r.name || '').toLowerCase().includes(q));
  }, [roles, filter]);

  return (
    <Popover placement="bottom" shouldCloseOnBlur={false}>
      <Popover.Trigger>
        <Button className="reblas-btn-1" css={{width: '100%'}}>
          Add roles…
        </Button>
      </Popover.Trigger>

      <Popover.Content>
        <div
          style={{
            padding: 12,
            width: 380,
            maxWidth: '85vw',
            border: '2px solid var(--reblas-outline)',
            borderRadius: 14,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(14px)',
          }}
        >
          <Input
            aria-label="Search roles…"
            clearable
            placeholder="Search roles…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            css={{width: '100%'}}
          />

          <div
            style={{
              marginTop: 10,
              maxHeight: 320,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              paddingRight: 4,
            }}
          >
            {filtered.length === 0 ? (
              <Text size="$sm" css={{opacity: 0.7}}>
                No roles match your search.
              </Text>
            ) : (
              filtered.map((r) => {
                const added = selectedSet.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      if (!added) onAdd(r.id);
                      // Popover stays open; no special handling needed
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 10px',
                      borderRadius: 12,
                      border: '2px solid var(--reblas-outline)',
                      background: added ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.20)',
                      color: 'white',
                      cursor: added ? 'default' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <span style={{display: 'flex', alignItems: 'center', gap: 10}}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: roleColorHex(r.color),
                          boxShadow: '0 0 0 1px var(--reblas-outline)',
                          flex: '0 0 auto',
                        }}
                      />
                      <span style={{fontWeight: 800}}>{r.name || r.id}</span>
                    </span>

                    {added ? <span style={{opacity: 0.7}}>Added</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Popover.Content>
    </Popover>
  );
}

function EmojiPicker({
  onPick,
  triggerLabel = 'Emoji',
}: {
  onPick: (emoji: string) => void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [popupStyle, setPopupStyle] = useState<{top: number; left: number}>({top: 0, left: 0});
  const allItems = useMemo<EmojiItem[]>(() => {
    const out: EmojiItem[] = [...DISCORD_SAFE_EMOJIS];
    const seen = new Set(out.map((x) => x.emoji));
    const ranges: Array<[number, number]> = [
      [0x1f300, 0x1faff],
      [0x2600, 0x27bf],
      [0x1f900, 0x1f9ff],
    ];
    const emojiRegex = /\p{Extended_Pictographic}/u;
    for (const [start, end] of ranges) {
      for (let cp = start; cp <= end; cp += 1) {
        const ch = String.fromCodePoint(cp);
        if (!emojiRegex.test(ch) || seen.has(ch)) continue;
        seen.add(ch);
        out.push({emoji: ch, name: `unicode u+${cp.toString(16)}`});
      }
    }
    return out;
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return allItems;
    return allItems.filter((it) => it.name.toLowerCase().includes(needle) || it.emoji.includes(needle));
  }, [allItems, q]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popupWidth = 320;
      const popupHeight = 360;
      const gutter = 12;
      const top = Math.max(gutter, rect.top - popupHeight - 8);
      const left = Math.min(
        Math.max(gutter, rect.left),
        Math.max(gutter, window.innerWidth - popupWidth - gutter)
      );
      setPopupStyle({top, left});
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    updatePosition();
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{position: 'relative'}}>
      <Button
        auto
        className="reblas-btn-1"
        size="sm"
        ref={buttonRef}
        onPress={() => setOpen((value) => !value)}
      >
        {triggerLabel}
      </Button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popupRef}
              style={{
                position: 'fixed',
                top: popupStyle.top,
                left: popupStyle.left,
                zIndex: 9999,
                padding: 10,
                width: 320,
                maxHeight: 360,
                border: '2px solid var(--reblas-outline)',
                borderRadius: 12,
                background: 'rgba(0,0,0,0.92)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
              }}
            >
              <Input
                aria-label="Search emojis"
                size="sm"
                placeholder="Search emojis…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                clearable
              />
              <div
                style={{
                  marginTop: 10,
                  maxHeight: 280,
                  overflowY: 'auto',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: 8,
                  paddingRight: 4,
                }}
              >
                {filtered.map((item) => (
                  <button
                    key={`${item.emoji}_${item.name}`}
                    type="button"
                    onClick={() => {
                      onPick(item.emoji);
                      setOpen(false);
                    }}
                    style={{
                      border: '2px solid var(--reblas-outline)',
                      background: 'rgba(0,0,0,0.2)',
                      borderRadius: 10,
                      fontSize: 20,
                      lineHeight: 1,
                      padding: '8px 0',
                      cursor: 'pointer',
                      color: 'white',
                    }}
                    title={`Insert ${item.emoji} (${item.name})`}
                  >
                    {item.emoji}
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

const SettingsPage: NextPage = () => {
  const router = useRouter();
  const {data: session} = useSession();
  const {settings, error, updateDraft, refresh, loading: settingsLoading} = useGuildSettings();

  const [tab, setTab] = useState<
    'main' | 'bot' | 'reactions' | 'setup' | 'theme' | 'members' | 'permissions' | 'subcrews' | 'embeds' | 'items'
  >('main');

  // Transfer ownership UI state
  const [showTransfer, setShowTransfer] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferErr, setTransferErr] = useState('');

  // Members roles list (from last import)
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesErr, setRolesErr] = useState('');
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [permMembers, setPermMembers] = useState<MemberInfo[]>([]);
  const [permMembersLoading, setPermMembersLoading] = useState(false);
  const [permMembersErr, setPermMembersErr] = useState('');

  // Members settings local state (saved via /api/members/settings)
  const [displayIds, setDisplayIds] = useState<string[]>([]);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [membersSaveErr, setMembersSaveErr] = useState('');
  const [membersSaving, setMembersSaving] = useState(false);
  const [embedsLoading, setEmbedsLoading] = useState(false);
  const [embedsErr, setEmbedsErr] = useState('');
  const [embedsStore, setEmbedsStore] = useState<EmbedsStore | null>(null);
  const [embedViewOpen, setEmbedViewOpen] = useState(false);
  const [embedEditOpen, setEmbedEditOpen] = useState(false);
  const [createEmbedOpen, setCreateEmbedOpen] = useState(false);
  const [selectedWeeklyId, setSelectedWeeklyId] = useState<WeeklyTemplateId | null>(null);
  const [selectedSubCrewTemplateId, setSelectedSubCrewTemplateId] = useState<SubCrewEmbedTemplateId | null>(null);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string>('');
  const [weeklySummaryChannelDraft, setWeeklySummaryChannelDraft] = useState('');
  const [weeklySummaryRoleDraft, setWeeklySummaryRoleDraft] = useState('');
  const [embedDraftWeekly, setEmbedDraftWeekly] = useState<WeeklyTemplate | null>(null);
  const [embedDraftSubCrewTemplate, setEmbedDraftSubCrewTemplate] = useState<SubCrewEmbedTemplate | null>(null);
  const [embedDraftAnnouncement, setEmbedDraftAnnouncement] = useState<AnnouncementEmbed | null>(null);
  const [subCrewModalOpen, setSubCrewModalOpen] = useState(false);
  const [subCrewDraft, setSubCrewDraft] = useState<SubCrewDraft | null>(null);
  const [subCrewEditId, setSubCrewEditId] = useState('');
  const [subCrewErr, setSubCrewErr] = useState('');
  const [subCrewSyncingId, setSubCrewSyncingId] = useState('');
  const [subCrewRolesLoading, setSubCrewRolesLoading] = useState(false);
  const [subCrewRolesErr, setSubCrewRolesErr] = useState('');
  const [subCrewRoles, setSubCrewRoles] = useState<RoleInfo[]>([]);
  const [itemsStore, setItemsStore] = useState<ItemsStore | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsErr, setItemsErr] = useState('');
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemView, setItemView] = useState<ItemRecord | null>(null);
  const [itemTab, setItemTab] = useState<'mats' | 'orders'>('orders');
  const [itemDraft, setItemDraft] = useState<{
    name: string;
    description: string;
    category: 'mats' | 'orders';
    imageUrl: string;
    dirtyWashRequirementWhole: string;
    cleanCashWhole: string;
    dirtyCashWhole: string;
    materials: ItemMaterialRequirement[];
    active: boolean;
  } | null>(null);
  const [itemEditId, setItemEditId] = useState('');
  const [itemImageBusy, setItemImageBusy] = useState(false);
  const [pendingMatId, setPendingMatId] = useState('');
  const [pendingMatQty, setPendingMatQty] = useState('1');
  const [pendingCoOwnerId, setPendingCoOwnerId] = useState('');
  const [pendingJobTrackingViewerId, setPendingJobTrackingViewerId] = useState('');
  const [pendingTwitchStreamer, setPendingTwitchStreamer] = useState('');
  const [pendingReactionEmoji, setPendingReactionEmoji] = useState('');
  const [pendingReactionLabel, setPendingReactionLabel] = useState('');
  const [pendingReactionRoleId, setPendingReactionRoleId] = useState('');
  const [pendingReactionDescription, setPendingReactionDescription] = useState('');
  const itemImageInputRef = useRef<HTMLInputElement | null>(null);

  const ownerId = String(settings.ownerDiscordId || '').trim();
  const myId = String((session as any)?.discordId || '').trim();
  const coOwnerIds = useMemo(
    () => (Array.isArray(settings.coOwnerDiscordIds) ? settings.coOwnerDiscordIds.map((id) => String(id || '').trim()) : []),
    [settings.coOwnerDiscordIds]
  );
  const {
    actualCanManageSettings,
    isPrimaryOwner,
    previewMemberMode,
    previewMemberId,
    setPreviewMemberId,
    startPreviewMode,
    stopPreviewMode,
  } = useOwnerPreviewMode(settings, myId);
  const autoPermissionIds = useMemo(
    () => Array.from(new Set([ownerId, ...coOwnerIds].map((id) => String(id || '').trim()).filter(Boolean))),
    [coOwnerIds, ownerId]
  );
  const selectedPreviewMember = useMemo(
    () => permMembers.find((m) => String(m.id || '').trim() === previewMemberId) || null,
    [permMembers, previewMemberId]
  );

  const canAccessTab = (_key: typeof tab) => true;

  const tabBtn = (key: typeof tab, label: string) => {
    const active = tab === key;
    const allowed = canAccessTab(key);
    return (
      <Button
        className="reblas-btn-1"
        auto
        disabled={!allowed}
        onPress={() => {
          if (!allowed) return;
          setTab(key);
        }}
        css={{px: '$10', minWidth: 'auto', opacity: !allowed ? 0.45 : active ? 1 : 0.75}}
      >
        {label}
      </Button>
    );
  };

  useEffect(() => {
    if (settingsLoading) return;
    if (!ownerId) return;
    if (actualCanManageSettings) return;
    router.replace('/members');
  }, [actualCanManageSettings, ownerId, router, settingsLoading]);

  const loadRoles = async () => {
    setRolesErr('');
    setRolesLoading(true);
    try {
      const j = await fetchJsonCached<MembersListPayload>(MEMBERS_LIST_URL, 15000);
      const roleOrder = Array.isArray(j?.roleOrder) ? (j.roleOrder as RoleInfo[]) : [];
      setRoles(roleOrder.filter((r) => r?.name !== '@everyone'));
    } catch (e: any) {
      setRoles([]);
      setRolesErr(e?.message || 'Failed to load roles');
    } finally {
      setRolesLoading(false);
    }
  };

  const displayNameOfMember = (m?: MemberInfo) =>
    String(m?.displayName || m?.nick || m?.globalName || m?.username || m?.id || '');

  const loadPermissionMembers = async () => {
    setPermMembersErr('');
    setPermMembersLoading(true);
    try {
      const j = await fetchJsonCached<MembersListPayload>(MEMBERS_LIST_URL, 15000);
      const members = Array.isArray(j?.members) ? (j.members as MemberInfo[]) : [];
      setPermMembers(members);
    } catch (e: any) {
      setPermMembers([]);
      setPermMembersErr(e?.message || 'Failed to load members');
    } finally {
      setPermMembersLoading(false);
    }
  };

  const openCreateSubCrew = () => {
    setSubCrewErr('');
    setSubCrewRolesErr('');
    setSubCrewRoles([]);
    setSubCrewEditId('');
    setSubCrewDraft({
      id: createSubCrewId('subcrew'),
      name: '',
      guildId: '',
      outlineColor: settings.outlineColor || '#ffffff14',
      washLogChannelId: '',
      washLogMentionRoleIds: [],
      orderUpdatesChannelId: '',
      orderUpdatesMentionRoleIds: [],
      roleIds: [],
      memberIds: [],
    });
    setSubCrewModalOpen(true);
  };

  const openEditSubCrew = (crew: SubCrew) => {
    setSubCrewErr('');
    setSubCrewRolesErr('');
    setSubCrewRoles([]);
    setSubCrewEditId(crew.id);
    setSubCrewDraft({
      id: crew.id,
      name: crew.name,
      guildId: '',
      outlineColor: crew.outlineColor || settings.outlineColor || '#ffffff14',
      washLogChannelId: crew.washLogChannelId || '',
      washLogMentionRoleIds: [...(crew.washLogMentionRoleIds || [])],
      orderUpdatesChannelId: crew.orderUpdatesChannelId || '',
      orderUpdatesMentionRoleIds: [...(crew.orderUpdatesMentionRoleIds || [])],
      roleIds: [...(crew.roleIds || [])],
      memberIds: [...(crew.memberIds || [])],
    });
    setSubCrewModalOpen(true);
  };

  const closeSubCrewModal = () => {
    setSubCrewModalOpen(false);
    setSubCrewDraft(null);
    setSubCrewEditId('');
    setSubCrewErr('');
    setSubCrewRolesErr('');
    setSubCrewRoles([]);
  };

  const loadSubCrewGuildRoles = useCallback(async (guildId: string) => {
    if (!guildId) {
      setSubCrewRoles([]);
      setSubCrewRolesErr('Set a Sub Guild ID in Setup first.');
      return;
    }
    setSubCrewRolesErr('');
    setSubCrewRolesLoading(true);
    try {
      const url = `/api/subcrews/roles?guildId=${encodeURIComponent(guildId)}`;
      const j = await fetchJsonCached<{roles?: RoleInfo[]}>(url, 15_000);
      const nextRoles = Array.isArray(j?.roles) ? (j.roles as RoleInfo[]) : [];
      setSubCrewRoles(nextRoles);
    } catch (e: any) {
      setSubCrewRoles([]);
      setSubCrewRolesErr(e?.message || 'Failed to load guild roles');
    } finally {
      setSubCrewRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!subCrewModalOpen || !subCrewDraft?.id) return;
    const guildId = String(settings.subGuildId || '').trim();
    if (!guildId) {
      setSubCrewRoles([]);
      setSubCrewRolesErr('Set a Sub Guild ID in Setup first.');
      return;
    }
    void loadSubCrewGuildRoles(guildId);
  }, [loadSubCrewGuildRoles, settings.subGuildId, subCrewDraft?.id, subCrewModalOpen]);

  const saveSubCrew = () => {
    if (!subCrewDraft) return;
    const name = String(subCrewDraft.name || '').trim();
    const outlineColor = String(subCrewDraft.outlineColor || '').trim();
    if (!name) {
      setSubCrewErr('Sub crew name is required.');
      return;
    }
    if (!isHexColor(outlineColor)) {
      setSubCrewErr('Outline color must be a valid hex value.');
      return;
    }

    const normalized: SubCrew = {
      id: subCrewDraft.id || createSubCrewId(name),
      name,
      guildId: '',
      outlineColor,
      washLogChannelId: String(subCrewDraft.washLogChannelId || '').trim().replace(/[^0-9]/g, ''),
      washLogMentionRoleIds: Array.from(new Set((subCrewDraft.washLogMentionRoleIds || []).map((id) => String(id || '').trim()).filter(Boolean))),
      orderUpdatesChannelId: String(subCrewDraft.orderUpdatesChannelId || '').trim().replace(/[^0-9]/g, ''),
      orderUpdatesMentionRoleIds: Array.from(new Set((subCrewDraft.orderUpdatesMentionRoleIds || []).map((id) => String(id || '').trim()).filter(Boolean))),
      roleIds: Array.from(new Set((subCrewDraft.roleIds || []).map((id) => String(id || '').trim()).filter(Boolean))),
      memberIds: Array.from(new Set((subCrewDraft.memberIds || []).map((id) => String(id || '').trim()).filter(Boolean))),
    };
    const next = [...(settings.subCrews || [])];
    const existingIndex = next.findIndex((crew) => crew.id === (subCrewEditId || normalized.id));
    if (existingIndex >= 0) next[existingIndex] = normalized;
    else next.push(normalized);

    updateDraft({subCrews: next});
    closeSubCrewModal();
  };

  const removeSubCrew = (crewId: string) => {
    const crew = (settings.subCrews || []).find((item) => item.id === crewId);
    const ok = window.confirm(`Delete ${crew?.name || 'this sub crew'}? Existing sub crew wash transactions will remain stored but inaccessible until a crew with the same ID is restored.`);
    if (!ok) return;
    updateDraft({subCrews: (settings.subCrews || []).filter((item) => item.id !== crewId)});
    if (subCrewEditId === crewId) closeSubCrewModal();
  };

  const updateSubCrewChannels = (crewId: string, patch: {
    washLogChannelId?: string;
    washLogMentionRoleIds?: string[];
    orderUpdatesChannelId?: string;
    orderUpdatesMentionRoleIds?: string[];
  }) => {
    updateDraft({
      subCrews: (settings.subCrews || []).map((crew) =>
        crew.id === crewId
          ? {
              ...crew,
              ...(patch.washLogChannelId !== undefined
                ? {washLogChannelId: String(patch.washLogChannelId || '').replace(/[^0-9]/g, '')}
                : null),
              ...(patch.washLogMentionRoleIds !== undefined
                ? {washLogMentionRoleIds: parseRoleIdInput((patch.washLogMentionRoleIds || []).join(','))}
                : null),
              ...(patch.orderUpdatesChannelId !== undefined
                ? {orderUpdatesChannelId: String(patch.orderUpdatesChannelId || '').replace(/[^0-9]/g, '')}
                : null),
              ...(patch.orderUpdatesMentionRoleIds !== undefined
                ? {orderUpdatesMentionRoleIds: parseRoleIdInput((patch.orderUpdatesMentionRoleIds || []).join(','))}
                : null),
            }
          : crew
      ),
    });
  };

  const syncSubCrewMembers = async (crewId: string) => {
    setSubCrewErr('');
    setSubCrewSyncingId(crewId);
    try {
      const res = await fetch('/api/members/import', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({crewId}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to sync sub crew members (${res.status})`);
      invalidateJsonCache(MEMBERS_LIST_URL);
      await refresh();
    } catch (e: any) {
      setSubCrewErr(e?.message || 'Failed to sync sub crew members');
    } finally {
      setSubCrewSyncingId('');
    }
  };

  const loadMembersSettings = async () => {
    setMembersSaveErr('');
    try {
      const j = await fetchJsonCached<{membersDisplayRoleIds?: string[]; membersExcludeRoleIds?: string[]}>(
        MEMBERS_SETTINGS_URL,
        15_000
      );
      setDisplayIds(Array.isArray(j.membersDisplayRoleIds) ? j.membersDisplayRoleIds.map(String) : []);
      setExcludeIds(Array.isArray(j.membersExcludeRoleIds) ? j.membersExcludeRoleIds.map(String) : []);
    } catch (e: any) {
      setDisplayIds([]);
      setExcludeIds([]);
      setMembersSaveErr(e?.message || 'Failed to load members settings');
    }
  };

  const saveMembersSettings = async (nextDisplay: string[], nextExclude: string[]) => {
    setMembersSaveErr('');
    setMembersSaving(true);
    try {
      const res = await fetch('/api/members/settings', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          membersDisplayRoleIds: nextDisplay,
          membersExcludeRoleIds: nextExclude,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to save members settings (${res.status})`);
      invalidateJsonCache(MEMBERS_SETTINGS_URL);

      // re-sync local from server response
      setDisplayIds(Array.isArray(j.membersDisplayRoleIds) ? j.membersDisplayRoleIds.map(String) : nextDisplay);
      setExcludeIds(Array.isArray(j.membersExcludeRoleIds) ? j.membersExcludeRoleIds.map(String) : nextExclude);

      // refresh global settings so Members page updates live
      await refresh();
    } catch (e: any) {
      setMembersSaveErr(e?.message || 'Failed to save members settings');
    } finally {
      setMembersSaving(false);
    }
  };

  const loadEmbeds = async () => {
    setEmbedsErr('');
    setEmbedsLoading(true);
    try {
      const j = await fetchJsonCached<EmbedsStore>(EMBEDS_URL, 15_000);
      setEmbedsStore(j as EmbedsStore);
    } catch (e: any) {
      setEmbedsStore(null);
      setEmbedsErr(e?.message || 'Failed to load embeds');
    } finally {
      setEmbedsLoading(false);
    }
  };

  const loadItems = async () => {
    setItemsErr('');
    setItemsLoading(true);
    try {
      const j = await fetchJsonCached<ItemsStore>(ITEMS_URL, 15_000);
      setItemsStore(j as ItemsStore);
    } catch (e: any) {
      setItemsStore(null);
      setItemsErr(e?.message || 'Failed to load items');
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    setWeeklySummaryChannelDraft(String(embedsStore?.weeklySummaryChannelId || ''));
    setWeeklySummaryRoleDraft(String(embedsStore?.weeklySummaryRoleId || ''));
  }, [embedsStore?.weeklySummaryChannelId, embedsStore?.weeklySummaryRoleId]);

  const openCreateItem = () => {
    setItemsErr('');
    setItemEditId('');
    setPendingMatId('');
    setPendingMatQty('1');
    setItemDraft({
      name: '',
      description: '',
      category: itemTab,
      imageUrl: '',
      dirtyWashRequirementWhole: '',
      cleanCashWhole: '',
      dirtyCashWhole: '',
      materials: [],
      active: true,
    });
    setItemModalOpen(true);
  };

  const openEditItem = (item: ItemRecord) => {
    setItemsErr('');
    setItemEditId(item.id);
    setPendingMatId('');
    setPendingMatQty('1');
    setItemDraft({
      name: item.name,
      description: item.description,
      category: item.category === 'mats' ? 'mats' : 'orders',
      imageUrl: item.imageUrl || '',
      dirtyWashRequirementWhole: String(Math.round(Number(item.dirtyWashRequirementCents || 0) / 100)),
      cleanCashWhole: String(Math.round(Number(item.cleanCashCents || 0) / 100)),
      dirtyCashWhole: String(Math.round(Number(item.dirtyCashCents || 0) / 100)),
      materials: Array.isArray(item.materials) ? item.materials : [],
      active: item.active,
    });
    setItemModalOpen(true);
  };

  const openViewItem = (item: ItemRecord) => {
    setItemView(item);
  };

  const saveItem = async () => {
    if (!itemDraft) return;
    const name = String(itemDraft.name || '').trim();
    const dirtyWashRequirementWhole = Math.max(
      0,
      Math.floor(Number(String(itemDraft.dirtyWashRequirementWhole || '').replace(/[^0-9]/g, '')))
    );
    const cleanCashWhole = Math.max(0, Math.floor(Number(String(itemDraft.cleanCashWhole || '').replace(/[^0-9]/g, ''))));
    const dirtyCashWhole = Math.max(0, Math.floor(Number(String(itemDraft.dirtyCashWhole || '').replace(/[^0-9]/g, ''))));
    if (!name) {
      setItemsErr(itemDraft.category === 'mats' ? 'Mat name is required.' : 'Order title is required.');
      return;
    }
    const action = itemEditId ? 'update' : 'create';
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action,
          id: itemEditId,
          item: {
            name,
            description: itemDraft.description,
            category: itemDraft.category,
            imageUrl: itemDraft.imageUrl,
            dirtyWashRequirementCents: itemDraft.category === 'orders' ? dirtyWashRequirementWhole * 100 : 0,
            cleanCashCents: itemDraft.category === 'orders' ? cleanCashWhole * 100 : 0,
            dirtyCashCents: itemDraft.category === 'orders' ? dirtyCashWhole * 100 : 0,
            materials: itemDraft.category === 'orders' ? itemDraft.materials : [],
            active: itemDraft.active,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to save item (${res.status})`);
      invalidateJsonCache(ITEMS_URL);
      setItemsStore((j?.store || null) as ItemsStore | null);
      setItemModalOpen(false);
      setItemDraft(null);
      setItemEditId('');
    } catch (e: any) {
      setItemsErr(e?.message || 'Failed to save item');
    }
  };

  const deleteItem = async (id: string) => {
    if (!window.confirm('Delete this item?')) return;
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'delete', id}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to delete item (${res.status})`);
      invalidateJsonCache(ITEMS_URL);
      setItemsStore((j?.store || null) as ItemsStore | null);
    } catch (e: any) {
      setItemsErr(e?.message || 'Failed to delete item');
    }
  };

  const filteredItems = useMemo(
    () => (itemsStore?.items || []).filter((item) => (item.category === 'mats' ? 'mats' : 'orders') === itemTab),
    [itemTab, itemsStore]
  );
  const availableMats = useMemo(
    () => (itemsStore?.items || []).filter((item) => item.category === 'mats'),
    [itemsStore]
  );
  const matById = useMemo(() => {
    const map = new Map<string, ItemRecord>();
    for (const item of availableMats) map.set(item.id, item);
    return map;
  }, [availableMats]);

  const uploadItemImage = async (file?: File | null) => {
    if (!file || !itemDraft) return;
    setItemsErr('');
    setItemImageBusy(true);
    try {
      const url = await uploadOriginalToServer(file);
      setItemDraft((current) => (current ? {...current, imageUrl: url} : current));
    } catch (e: any) {
      setItemsErr(e?.message || 'Failed to upload image');
    } finally {
      setItemImageBusy(false);
      if (itemImageInputRef.current) itemImageInputRef.current.value = '';
    }
  };

  const addMatRequirement = () => {
    if (!itemDraft || itemDraft.category !== 'orders') return;
    const matId = String(pendingMatId || '').trim();
    if (!matId) return;
    const quantity = Math.max(1, Math.floor(Number(String(pendingMatQty || '1').replace(/[^0-9]/g, '')) || 1));
    const nextMaterials = [...itemDraft.materials];
    const existingIdx = nextMaterials.findIndex((entry) => entry.matId === matId);
    if (existingIdx >= 0) nextMaterials[existingIdx] = {matId, quantity};
    else nextMaterials.push({matId, quantity});
    setItemDraft({...itemDraft, materials: nextMaterials});
    setPendingMatId('');
    setPendingMatQty('1');
  };

  const removeMatRequirement = (matId: string) => {
    if (!itemDraft || itemDraft.category !== 'orders') return;
    setItemDraft({
      ...itemDraft,
      materials: itemDraft.materials.filter((entry) => entry.matId !== matId),
    });
  };

  const createAnnouncement = async (draft: AnnouncementEmbed) => {
    setEmbedsErr('');
    try {
      const res = await fetch('/api/embeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'create_announcement', announcement: draft}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to create embed (${res.status})`);
      invalidateJsonCache(EMBEDS_URL);
      setEmbedsStore((j?.store || null) as EmbedsStore | null);
      setCreateEmbedOpen(false);
      setEmbedDraftAnnouncement(null);
    } catch (e: any) {
      setEmbedsErr(e?.message || 'Failed to create embed');
    }
  };

  const updateAnnouncement = async (id: string, draft: AnnouncementEmbed) => {
    setEmbedsErr('');
    try {
      const res = await fetch('/api/embeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'update_announcement', id, announcement: draft}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to update embed (${res.status})`);
      invalidateJsonCache(EMBEDS_URL);
      setEmbedsStore((j?.store || null) as EmbedsStore | null);
      setEmbedEditOpen(false);
      setEmbedDraftAnnouncement(null);
      setSelectedAnnouncementId('');
    } catch (e: any) {
      setEmbedsErr(e?.message || 'Failed to update embed');
    }
  };

  const deleteAnnouncement = async (id: string) => {
    setEmbedsErr('');
    try {
      const res = await fetch('/api/embeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'delete_announcement', id}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to delete embed (${res.status})`);
      invalidateJsonCache(EMBEDS_URL);
      setEmbedsStore((j?.store || null) as EmbedsStore | null);
      if (selectedAnnouncementId === id) {
        setSelectedAnnouncementId('');
        setEmbedDraftAnnouncement(null);
        setEmbedEditOpen(false);
        setEmbedViewOpen(false);
      }
    } catch (e: any) {
      setEmbedsErr(e?.message || 'Failed to delete embed');
    }
  };

  const updateWeeklyTemplate = async (id: WeeklyTemplateId, draft: WeeklyTemplate) => {
    setEmbedsErr('');
    try {
      const res = await fetch('/api/embeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'update_weekly_template', id, template: draft}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to update template (${res.status})`);
      invalidateJsonCache(EMBEDS_URL);
      setEmbedsStore((j?.store || null) as EmbedsStore | null);
      setEmbedEditOpen(false);
      setEmbedDraftWeekly(null);
      setSelectedWeeklyId(null);
    } catch (e: any) {
      setEmbedsErr(e?.message || 'Failed to update template');
    }
  };

  const updateWeeklySummarySettings = async (channelId: string, roleId: string) => {
    setEmbedsErr('');
    try {
      const res = await fetch('/api/embeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'update_weekly_summary_settings', channelId, roleId}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to update weekly summary settings (${res.status})`);
      invalidateJsonCache(EMBEDS_URL);
      setEmbedsStore((j?.store || null) as EmbedsStore | null);
    } catch (e: any) {
      setEmbedsErr(e?.message || 'Failed to update weekly summary settings');
    }
  };

  const updateSubCrewTemplate = async (id: SubCrewEmbedTemplateId, draft: SubCrewEmbedTemplate) => {
    setEmbedsErr('');
    try {
      const res = await fetch('/api/embeds', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'update_subcrew_template', id, template: draft}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to update sub crew template (${res.status})`);
      invalidateJsonCache(EMBEDS_URL);
      setEmbedsStore((j?.store || null) as EmbedsStore | null);
      setEmbedEditOpen(false);
      setEmbedDraftSubCrewTemplate(null);
      setSelectedSubCrewTemplateId(null);
    } catch (e: any) {
      setEmbedsErr(e?.message || 'Failed to update sub crew template');
    }
  };

  // When opening Members Settings tab, load roles + current saved lists
  useEffect(() => {
    if (tab === 'main' || tab === 'bot' || tab === 'reactions') {
      if (!rolesLoading && roles.length === 0) void loadRoles();
      const guildId = String(settings.subGuildId || '').trim();
      if (guildId && !subCrewRolesLoading && subCrewRoles.length === 0) void loadSubCrewGuildRoles(guildId);
    }
    if (tab === 'members') {
      if (!rolesLoading && roles.length === 0) void loadRoles();
      void loadMembersSettings();
    }
    if ((tab === 'permissions' || tab === 'subcrews') && !permMembersLoading && permMembers.length === 0) {
      void loadPermissionMembers();
    }
    if (tab === 'embeds' && !embedsLoading && !embedsStore) {
      void loadEmbeds();
    }
    if (tab === 'items' && !itemsLoading && !itemsStore) {
      void loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const openTransfer = () => {
    setTransferErr('');
    setNewOwnerId('');
    setConfirmText('');
    setShowTransfer(true);
  };

  const continueToConfirm = () => {
    const id = newOwnerId.trim();
    if (!/^\d{6,25}$/.test(id)) {
      setTransferErr('Please enter a valid Discord User ID (numbers only).');
      return;
    }
    if (id === ownerId) {
      setTransferErr('That ID is already the current Owner.');
      return;
    }
    setTransferErr('');
    setShowTransfer(false);
    setShowConfirm(true);
  };

  const doTransfer = async () => {
    setTransferBusy(true);
    setTransferErr('');
    try {
      const res = await fetch('/api/setup/transfer-owner', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          newOwnerDiscordId: newOwnerId.trim(),
          confirmPhrase: confirmText.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Transfer failed');

      setShowConfirm(false);
      setNewOwnerId('');
      setConfirmText('');
      await refresh();
      window.alert('Ownership transferred. You no longer have Owner access.');
    } catch (e: any) {
      setTransferErr(e?.message || 'Transfer failed');
    } finally {
      setTransferBusy(false);
    }
  };

  const blockClipboard = (e: React.ClipboardEvent<HTMLInputElement>) => e.preventDefault();
  const blockKeyCombos = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'v' || k === 'c' || k === 'x' || k === 'a')) e.preventDefault();
  };

  const roleById = useMemo(() => {
    const m = new Map<string, RoleInfo>();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);

  const permMemberById = useMemo(() => {
    const m = new Map<string, MemberInfo>();
    for (const mm of permMembers) m.set(mm.id, mm);
    return m;
  }, [permMembers]);

  const sortedSubCrews = useMemo(
    () => [...(settings.subCrews || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [settings.subCrews]
  );
  const subCrewSourceGuildId = String(settings.subGuildId || '').trim();
  const subCrewRoleById = useMemo(() => {
    const map = new Map<string, RoleInfo>();
    for (const role of subCrewRoles) map.set(role.id, role);
    return map;
  }, [subCrewRoles]);
  const buildBotInviteUrl = (guildId: string) => {
    const clientId = String((settings as any)?.discordClientId || '').trim();
    if (!clientId || !/^\d{6,25}$/.test(String(guildId || '').trim())) return '';
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'bot applications.commands',
      permissions: '268520528',
      guild_id: String(guildId || '').trim(),
      disable_guild_select: 'true',
    });
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  };

  const copyInviteLink = async (guildId: string) => {
    const link = buildBotInviteUrl(guildId);
    if (!link) {
      window.alert('Discord Client ID and target Guild ID are required.');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      window.alert('Bot invite link copied.');
    } catch {
      window.prompt('Copy this bot invite link:', link);
    }
  };

  const renderChips = (
    ids: string[],
    onRemove: (id: string) => void,
    opts?: {availableRoles?: RoleInfo[]; roleLookup?: Map<string, RoleInfo>}
  ) => {
    const availableRoles = opts?.availableRoles || roles;
    const lookup = opts?.roleLookup || roleById;
    const orderedKnown = availableRoles.filter((r) => ids.includes(r.id)).map((r) => r.id);
    const remaining = ids.filter((id) => !orderedKnown.includes(id));
    const ordered = [...orderedKnown, ...remaining];
    return (
      <div
        style={{
          border: '2px solid var(--reblas-outline)',
          borderRadius: 14,
          background: 'rgba(0,0,0,0.10)',
          padding: 10,
          minHeight: 56,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
      >
        {ids.length === 0 ? (
          <Text size="$sm" css={{opacity: 0.65}}>(none selected)</Text>
        ) : (
          ordered.map((id) => {
            const r = lookup.get(id);
            return (
              <div
                key={id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: '2px solid var(--reblas-outline)',
                  background: 'rgba(0,0,0,0.25)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: roleColorHex(r?.color),
                    boxShadow: '0 0 0 1px var(--reblas-outline)',
                  }}
                />
                <span style={{fontWeight: 800}}>{r?.name || id}</span>
                <Button
                  auto
                  className="reblas-btn-1"
                  css={{minWidth: 'auto', px: '$4', py: '$2', lineHeight: 1}}
                  onPress={() => onRemove(id)}
                >
                  ✕
                </Button>
              </div>
            );
          })
        )}
      </div>
    );
  };

  const renderWelcomeBotCard = ({
    title,
    guildHint,
    enabledKey,
    tempCategoryKey,
    requestChannelKey,
    tagRoleIdsKey,
    baseRoleIdsKey,
    availableRoles,
    roleLookup,
    rolesLoadingValue,
    rolesErrValue,
    onRefreshRoles,
    refreshDisabled,
  }: {
    title: string;
    guildHint: string;
    enabledKey: keyof typeof settings;
    tempCategoryKey: keyof typeof settings;
    requestChannelKey: keyof typeof settings;
    tagRoleIdsKey: keyof typeof settings;
    baseRoleIdsKey: keyof typeof settings;
    availableRoles: RoleInfo[];
    roleLookup: Map<string, RoleInfo>;
    rolesLoadingValue: boolean;
    rolesErrValue: string;
    onRefreshRoles: () => void;
    refreshDisabled: boolean;
  }) => {
    const enabled = !!settings[enabledKey];
    const tagRoleIds = ((settings[tagRoleIdsKey] as unknown as string[]) || []).filter(Boolean);
    const baseRoleIds = ((settings[baseRoleIdsKey] as unknown as string[]) || []).filter(Boolean);

    return (
      <Card css={{...glassCardCss, p: '$7'}}>
        <div style={{display: 'grid', gap: 12}}>
          <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap'}}>
            <div style={{minWidth: 0}}>
              <Text css={{fontWeight: 900, mb: '$1'}}>{title}</Text>
              <Text size="$sm" css={{opacity: 0.68, mb: 0}}>
                {guildHint}
              </Text>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
              <label style={{display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, cursor: 'pointer'}}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => updateDraft({[enabledKey]: e.target.checked} as any)}
                />
                Enabled
              </label>
              <Button
                auto
                className="reblas-btn-1"
                css={{minWidth: 'auto', px: '$6'}}
                disabled={refreshDisabled}
                onPress={onRefreshRoles}
              >
                {rolesLoadingValue ? 'Loading Roles…' : 'Refresh Roles'}
              </Button>
            </div>
          </div>

          {rolesErrValue ? (
            <Text size="$xs" css={{mb: 0, opacity: 0.82, color: 'var(--reblas-btn3-color)'}}>
              {rolesErrValue}
            </Text>
          ) : null}

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10}}>
            <div style={{display: 'grid', gap: 6}}>
              <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Temp Category ID</Text>
              <Input
                aria-label={`${title} Temp Category ID`}
                fullWidth
                value={String((settings[tempCategoryKey] as unknown as string) || '')}
                onChange={(e) => updateDraft({[tempCategoryKey]: e.target.value.replace(/[^0-9]/g, '')} as any)}
              />
            </div>

            <div style={{display: 'grid', gap: 6}}>
              <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Role Request Channel ID</Text>
              <Input
                aria-label={`${title} Role Request Channel ID`}
                fullWidth
                value={String((settings[requestChannelKey] as unknown as string) || '')}
                onChange={(e) => updateDraft({[requestChannelKey]: e.target.value.replace(/[^0-9]/g, '')} as any)}
              />
            </div>

            <div style={{display: 'grid', gap: 6}}>
              <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Roles To Apply On Submit</Text>
              <RoleAddDropdown
                roles={availableRoles}
                selectedIds={baseRoleIds}
                onAdd={(id) => {
                  const next = baseRoleIds.includes(id) ? baseRoleIds : [...baseRoleIds, id];
                  updateDraft({[baseRoleIdsKey]: next} as any);
                }}
              />
              {renderChips(
                baseRoleIds,
                (id) => updateDraft({[baseRoleIdsKey]: baseRoleIds.filter((entry) => entry !== id)} as any),
                {availableRoles, roleLookup}
              )}
            </div>
          </div>

          <div style={{display: 'grid', gap: 8}}>
            <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Tag Roles On Request</Text>
            <RoleAddDropdown
              roles={availableRoles}
              selectedIds={tagRoleIds}
              onAdd={(id) => {
                const next = tagRoleIds.includes(id) ? tagRoleIds : [...tagRoleIds, id];
                updateDraft({[tagRoleIdsKey]: next} as any);
              }}
            />
            {renderChips(
              tagRoleIds,
              (id) => updateDraft({[tagRoleIdsKey]: tagRoleIds.filter((entry) => entry !== id)} as any),
              {availableRoles, roleLookup}
            )}
          </div>
        </div>
      </Card>
    );
  };

  const renderIdChips = (ids: string[], onRemove: (id: string) => void) => (
    <div
      style={{
        border: '2px solid var(--reblas-outline)',
        borderRadius: 14,
        background: 'rgba(0,0,0,0.10)',
        padding: 10,
        minHeight: 56,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
      }}
    >
      {ids.length === 0 ? (
        <Text size="$sm" css={{opacity: 0.65}}>(none added)</Text>
      ) : (
        ids.map((id) => (
          <div
            key={id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 999,
              border: '2px solid var(--reblas-outline)',
              background: 'rgba(0,0,0,0.25)',
            }}
          >
            <span style={{fontWeight: 800}}>{id}</span>
            <Button
              auto
              className="reblas-btn-1"
              css={{minWidth: 'auto', px: '$4', py: '$2', lineHeight: 1}}
              onPress={() => onRemove(id)}
            >
              ✕
            </Button>
          </div>
        ))
      )}
    </div>
  );

  const addTwitchStreamerLogin = () => {
    const login = normalizeTwitchLogin(pendingTwitchStreamer);
    if (!login) return;
    if ((settings.twitchStreamerLogins || []).includes(login)) {
      setPendingTwitchStreamer('');
      return;
    }
    updateDraft({twitchStreamerLogins: [...(settings.twitchStreamerLogins || []), login]});
    setPendingTwitchStreamer('');
  };

  const addReactionRole = () => {
    const emoji = String(pendingReactionEmoji || '').trim();
    const roleId = String(pendingReactionRoleId || '').trim().replace(/[^0-9]/g, '');
    if (!emoji || !/^\d{6,25}$/.test(roleId)) return;
    const role = roleById.get(roleId);
    const next: ReactionRole = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      emoji,
      label: String(pendingReactionLabel || role?.name || 'Reaction Role').trim().slice(0, 80),
      roleId,
      description: String(pendingReactionDescription || '').trim().slice(0, 180),
    };
    updateDraft({reactionRoles: [...(settings.reactionRoles || []), next]});
    setPendingReactionEmoji('');
    setPendingReactionLabel('');
    setPendingReactionRoleId('');
    setPendingReactionDescription('');
  };

  const updateReactionRole = (id: string, patch: Partial<ReactionRole>) => {
    updateDraft({
      reactionRoles: (settings.reactionRoles || []).map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              ...(patch.emoji !== undefined ? {emoji: String(patch.emoji || '').trim().slice(0, 80)} : null),
              ...(patch.label !== undefined ? {label: String(patch.label || '').trim().slice(0, 80)} : null),
              ...(patch.description !== undefined
                ? {description: String(patch.description || '').trim().slice(0, 180)}
                : null),
              ...(patch.roleId !== undefined ? {roleId: String(patch.roleId || '').replace(/[^0-9]/g, '')} : null),
            }
          : item
      ),
    });
  };

  const removeReactionRole = (id: string) => {
    updateDraft({reactionRoles: (settings.reactionRoles || []).filter((item) => item.id !== id)});
  };

  const addJobTrackingViewerId = () => {
    const id = pendingJobTrackingViewerId.trim();
    if (!/^\d{6,25}$/.test(id)) return;
    if ((settings.jobTrackingViewOnlyDiscordIds || []).includes(id)) {
      setPendingJobTrackingViewerId('');
      return;
    }
    updateDraft({jobTrackingViewOnlyDiscordIds: [...(settings.jobTrackingViewOnlyDiscordIds || []), id]});
    setPendingJobTrackingViewerId('');
  };

  const renderMemberPermissionSection = (
    title: string,
    description: string,
    rows: Array<{k: keyof typeof settings; label: string}>
  ) => (
    <Card css={glassCardCss}>
      <Text css={{fontWeight: 900, mb: '$2'}}>{title}</Text>
      <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
        {description}
      </Text>

      {permMembersErr ? <Text size="$sm" css={{opacity: 0.9, mb: '$6'}}>{permMembersErr}</Text> : null}

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10}}>
        {rows.map((row) => {
          const selected = (settings[row.k] as unknown as string[]) || [];
          const selectedSet = new Set(selected.map((id) => String(id || '').trim()).filter(Boolean));
          const autoSet = new Set(autoPermissionIds);
          const displayIds = Array.from(new Set([...autoPermissionIds, ...selected]));
          const available = permMembers.filter((m) => {
            const id = String(m.id || '').trim();
            return !selectedSet.has(id) && !autoSet.has(id);
          });
          return (
            <Card
              key={String(row.k)}
              css={{p: '$5', background: 'rgba(0,0,0,0.10)', border: '2px solid var(--reblas-outline)'}}
            >
              <div style={{display: 'grid', gap: 10}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10}}>
                  <div style={{minWidth: 0}}>
                    <Text b css={{mb: 0}}>{row.label}</Text>
                    <Text size="$xs" css={{mb: 0, opacity: 0.62}}>
                      {displayIds.length} included
                    </Text>
                  </div>
                  <Dropdown closeOnSelect={false}>
                    <Dropdown.Trigger>
                      <Button
                        auto
                        className="reblas-btn-1"
                        css={{minWidth: 'auto', px: '$6'}}
                        disabled={permMembersLoading || available.length === 0}
                      >
                        {permMembersLoading ? 'Loading…' : 'Add'}
                      </Button>
                    </Dropdown.Trigger>
                    <Dropdown.Menu
                      aria-label={`${row.label} members`}
                      items={available.length ? available : [{id: '__none__'}]}
                      onAction={(id) => {
                        const memberId = String(id || '');
                        if (memberId === '__none__') return;
                        const next = selected.includes(memberId) ? selected : [...selected, memberId];
                        updateDraft({[row.k]: next} as any);
                      }}
                      css={{maxHeight: 320, overflowY: 'auto', minWidth: 260}}
                    >
                      {(m: any) =>
                        String(m?.id) === '__none__' ? (
                          <Dropdown.Item key="__none__" textValue="All members added">
                            <Text size="$sm" css={{mb: 0, opacity: 0.7}}>All members already added</Text>
                          </Dropdown.Item>
                        ) : (
                          <Dropdown.Item key={m.id} textValue={displayNameOfMember(m as MemberInfo)}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                              <Avatar
                                src={(m as MemberInfo).avatarUrl || undefined}
                                size="sm"
                                css={{boxShadow: '0 0 0 1px var(--reblas-outline)', minWidth: 24, width: 24, height: 24}}
                              />
                              <span style={{fontSize: 14, lineHeight: 1.2}}>{displayNameOfMember(m as MemberInfo)}</span>
                            </div>
                          </Dropdown.Item>
                        )
                      }
                    </Dropdown.Menu>
                  </Dropdown>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                    minHeight: 38,
                    padding: selected.length ? 0 : '2px 0',
                  }}
                >
                  {displayIds.length === 0 ? (
                    <Text size="$sm" css={{opacity: 0.58, mb: 0}}>
                      none selected
                    </Text>
                  ) : (
                    displayIds.map((id) => {
                      const m = permMemberById.get(id);
                      const label = displayNameOfMember(m) || id;
                      const isAutoIncluded = autoSet.has(id);
                      return (
                        <button
                          key={`${String(row.k)}_${id}`}
                          type="button"
                          title={isAutoIncluded ? `${label} (always included)` : label}
                          onClick={() => {
                            if (isAutoIncluded) return;
                            updateDraft({[row.k]: selected.filter((x) => x !== id)} as any);
                          }}
                          style={{
                            border: 0,
                            background: 'transparent',
                            padding: 0,
                            cursor: isAutoIncluded ? 'default' : 'pointer',
                            display: 'inline-flex',
                            position: 'relative',
                          }}
                          aria-label={isAutoIncluded ? `${label} is automatically included` : `Remove ${label}`}
                        >
                          <Avatar
                            src={m?.avatarUrl || undefined}
                            text={label ? label[0] : '?'}
                            size="sm"
                            css={{
                              boxShadow: '0 0 0 2px var(--reblas-outline)',
                              width: 28,
                              height: 28,
                              minWidth: 28,
                              minHeight: 28,
                            }}
                          />
                          {isAutoIncluded ? (
                            <span
                              style={{
                                position: 'absolute',
                                right: -2,
                                bottom: -2,
                                minWidth: 14,
                                height: 14,
                                borderRadius: 999,
                                background: 'var(--reblas-btn2-color)',
                                color: 'white',
                                fontSize: 9,
                                fontWeight: 900,
                                lineHeight: '14px',
                                textAlign: 'center',
                                boxShadow: '0 0 0 2px rgba(0,0,0,0.75)',
                              }}
                            >
                              *
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
                <Text size="$xs" css={{mb: 0, opacity: 0.58}}>
                  Owner and co-owners are always included automatically.
                </Text>
              </div>
            </Card>
          );
        })}
      </div>
    </Card>
  );

  const addCoOwnerId = () => {
    const id = String(pendingCoOwnerId || '').trim();
    if (!/^\d{6,25}$/.test(id)) {
      window.alert('Enter a valid Discord User ID.');
      return;
    }
    if (id === ownerId) {
      window.alert('The primary owner already has full access.');
      return;
    }
    updateDraft({coOwnerDiscordIds: Array.from(new Set([...(settings.coOwnerDiscordIds || []), id]))});
    setPendingCoOwnerId('');
  };

  const renderThemeColorControl = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    placeholder = '#3b82f6'
  ) => (
    <Card css={{p: '$7', background: 'rgba(0,0,0,0.12)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(14px)'}}>
      <Text css={{fontWeight: 900, mb: '$4'}}>{label}</Text>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
        <input
          type="color"
          value={(value || '#3b82f6').slice(0, 7)}
          onChange={(e) => {
            const hex6 = e.target.value;
            const cur = String(value || '').trim();
            const alpha = cur.length === 9 ? cur.slice(7, 9) : '';
            onChange(`${hex6}${alpha}`);
          }}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '2px solid var(--reblas-outline)',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
          }}
          aria-label={`Pick ${label} color`}
        />
        <Input
          aria-label={placeholder}
          label="Hex Color"
          placeholder={placeholder}
          fullWidth
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </Card>
  );


  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeklyTemplateRows = useMemo(() => {
    if (!embedsStore?.weeklyTemplates) return [];
    return [
      embedsStore.weeklyTemplates.weekly_outstanding,
      embedsStore.weeklyTemplates.weekly_uptodate,
      embedsStore.weeklyTemplates.weekly_credit,
    ].filter(Boolean);
  }, [embedsStore]);

  const subCrewTemplateRows = useMemo(() => {
    if (!embedsStore?.subCrewTemplates) return [];
    return [
      embedsStore.subCrewTemplates.subcrew_wash_log,
      embedsStore.subCrewTemplates.subcrew_order_update,
    ].filter(Boolean);
  }, [embedsStore]);

  const announcementRows = useMemo(() => embedsStore?.announcements || [], [embedsStore]);

  const blankAnnouncementDraft = (): AnnouncementEmbed => ({
    id: '',
    name: 'New Scheduled Embed',
    title: 'Announcement',
    description: '',
    channelId: '',
    mentionRoleIds: [],
    frequency: 'weekly',
    dayOfWeek: 5,
    timeHHMM: '17:00',
    color: '#3b82f6',
    enabled: true,
    createdAt: '',
    updatedAt: '',
  });

  const appendEmojiToAnnouncementDescription = (emoji: string) => {
    if (!embedDraftAnnouncement) return;
    setEmbedDraftAnnouncement({
      ...embedDraftAnnouncement,
      description: `${embedDraftAnnouncement.description || ''}${emoji}`,
    });
  };

  const appendEmojiToWeeklyField = (
    field: 'title' | 'description' | 'statusLabel' | 'statusEmoji' | 'notice',
    emoji: string
  ) => {
    if (!embedDraftWeekly) return;
    setEmbedDraftWeekly({
      ...embedDraftWeekly,
      [field]: `${String((embedDraftWeekly as any)[field] || '')}${emoji}`,
    } as WeeklyTemplate);
  };

  const appendEmojiToSubCrewField = (field: 'title' | 'description', emoji: string) => {
    if (!embedDraftSubCrewTemplate) return;
    setEmbedDraftSubCrewTemplate({
      ...embedDraftSubCrewTemplate,
      [field]: `${String((embedDraftSubCrewTemplate as any)[field] || '')}${emoji}`,
    } as SubCrewEmbedTemplate);
  };

  const previewSubCrewTemplate = (template: SubCrewEmbedTemplate) => {
    const sample: Record<string, string> = template.id === 'subcrew_wash_log'
      ? {
          crewName: 'Alpha Crew',
          date: '2026-03-09',
          dirtyCollected: '1,500',
          washRate: '25%',
          cleanReturned: '1,125',
          dirtyCollectedTotal: '8,750',
          notes: 'Sample notes',
        }
      : {
          crewName: 'Alpha Crew',
          itemName: 'Starter Pack x2\nUtility Bag x1',
          quantity: '3',
          status: 'pending',
          statusLabel: 'Pending',
          dirtyWash: '450',
          cleanCost: '225',
          dirtyCash: '95',
          materials: 'Mat A x2, Mat B x3',
          items: 'Starter Pack x2\nUtility Bag x1',
          note: 'Urgent order',
          cancelReason: 'Awaiting stock',
        };
    const apply = (value: string) =>
      String(value || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => sample[key] || `{${key}}`);
    return {
      title: apply(template.title),
      description: apply(template.description),
    };
  };

  if (!settingsLoading && ownerId && !actualCanManageSettings) {
    return null;
  }

  return (
    <Box css={{px: '$12', mt: '$8', width: '100%', maxWidth: '1400px', margin: '0 auto'}}>
      <Flex align="center" justify="between" css={{mb: '$6', mt: '$6', gap: '$10', flexWrap: 'wrap'}}>
        <Text h2 css={{mb: 0}}>Settings</Text>

        <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
          {tabBtn('main', 'Main Settings')}
          {tabBtn('bot', 'Bot')}
          {tabBtn('reactions', 'Reactions')}
          {tabBtn('setup', 'Setup')}
          {tabBtn('theme', 'Theme Settings')}
          {tabBtn('members', 'Members Settings')}
          {tabBtn('permissions', 'Permissions')}
          {tabBtn('subcrews', 'Sub Crews')}
          {tabBtn('embeds', 'Embeds')}
          {tabBtn('items', 'Items')}
        </div>
      </Flex>

      {error ? (
        <Card css={{p: '$8', mb: '$8', border: '2px solid var(--reblas-outline)', background: 'rgba(120,0,0,0.25)'}}>
          <Text css={{fontWeight: 900}}>Auto-save error</Text>
          <Text size="$sm" css={{opacity: 0.9}}>{error}</Text>
        </Card>
      ) : null}

      {tab === 'main' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Text h3 css={{mb: '$8'}}>Main Settings</Text>

          <Flex direction="column" css={{gap: '$10'}}>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16}}>
              <Card css={glassCardCss}>
                <Text css={{fontWeight: 900, mb: '$2'}}>Default Global Wash Rate (%)</Text>
                <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
                  Used as the default when no previous week wash rate exists.
                </Text>
                <Input
                  aria-label="Default Global Wash Rate"
                  placeholder="25"
                  type="number"
                  min={0}
                  max={100}
                  fullWidth
                  value={String(settings.defaultWashRatePct ?? 25)}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 25;
                    updateDraft({defaultWashRatePct: clamped});
                  }}
                />
              </Card>

              <Card css={glassCardCss}>
                <Text css={{fontWeight: 900, mb: '$2'}}>Main Crew Dirty Reset Date</Text>
                <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
                  Restart the main crew available dirty wash count from this date without deleting any old wash log entries.
                </Text>
                <div style={{display: 'grid', gap: 10}}>
                  <input
                    type="date"
                    value={String(settings.mainCrewDirtyResetDate || '')}
                    onChange={(e) => updateDraft({mainCrewDirtyResetDate: e.target.value})}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: '2px solid var(--reblas-outline)',
                      background: 'rgba(0,0,0,0.2)',
                      color: 'white',
                    }}
                  />
                  <Text size="$xs" css={{opacity: 0.58, mb: 0}}>
                    This only affects the main crew available dirty balance and dirty usage checks for new main crew orders.
                  </Text>
                  {settings.mainCrewDirtyResetDate ? (
                    <div style={{display: 'flex', justifyContent: 'flex-end'}}>
                      <Button auto className="reblas-btn-1" css={{minWidth: 'auto', px: '$6'}} onPress={() => updateDraft({mainCrewDirtyResetDate: ''})}>
                        Clear Reset Date
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>

            </div>

          </Flex>
        </Card>
      ) : null}

      {tab === 'bot' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Text h3 css={{mb: '$8'}}>Bot</Text>

          <Flex direction="column" css={{gap: '$10'}}>
            <div style={{display: 'grid', gap: 12}}>
              <div>
                <Text css={{fontWeight: 900, mb: '$1'}}>Welcome Bot</Text>
                <Text size="$sm" css={{opacity: 0.7, mb: 0}}>
                  New joins get a temp onboarding channel, complete onboarding, then get the configured roles. Manual push command: <code>/pushwelcome member:@user</code>
                </Text>
              </div>

              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16}}>
                {renderWelcomeBotCard({
                  title: 'Main Guild Welcome',
                  guildHint: 'Uses the main guild roles and the configured main guild.',
                  enabledKey: 'welcomeBotMainEnabled',
                  tempCategoryKey: 'welcomeBotMainTempCategoryId',
                  requestChannelKey: 'welcomeBotMainRoleRequestChannelId',
                  tagRoleIdsKey: 'welcomeBotMainRequestTagRoleIds',
                  baseRoleIdsKey: 'welcomeBotMainBaseRoleIds',
                  availableRoles: roles,
                  roleLookup: roleById,
                  rolesLoadingValue: rolesLoading,
                  rolesErrValue: rolesErr,
                  onRefreshRoles: loadRoles,
                  refreshDisabled: rolesLoading || !String(settings.guildId || '').trim(),
                })}

                {renderWelcomeBotCard({
                  title: 'Sub Guild Welcome',
                  guildHint: 'Uses the sub guild roles and the configured sub guild.',
                  enabledKey: 'welcomeBotSubEnabled',
                  tempCategoryKey: 'welcomeBotSubTempCategoryId',
                  requestChannelKey: 'welcomeBotSubRoleRequestChannelId',
                  tagRoleIdsKey: 'welcomeBotSubRequestTagRoleIds',
                  baseRoleIdsKey: 'welcomeBotSubBaseRoleIds',
                  availableRoles: subCrewRoles,
                  roleLookup: subCrewRoleById,
                  rolesLoadingValue: subCrewRolesLoading,
                  rolesErrValue: subCrewRolesErr,
                  onRefreshRoles: () => void loadSubCrewGuildRoles(String(settings.subGuildId || '').trim()),
                  refreshDisabled: subCrewRolesLoading || !String(settings.subGuildId || '').trim(),
                })}
              </div>
            </div>

            <div style={{display: 'grid', gap: 12}}>
              <div>
                <Text css={{fontWeight: 900, mb: '$1'}}>Twitch Stream Notifications</Text>
                <Text size="$sm" css={{opacity: 0.7, mb: 0}}>
                  Configure Twitch streamers to watch and the Discord channel where the bot should post when they go live.
                </Text>
              </div>

              <Card css={{...glassCardCss, p: '$7'}}>
                <div style={{display: 'grid', gap: 12}}>
                  <label style={{display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, cursor: 'pointer'}}>
                    <input
                      type="checkbox"
                      checked={!!settings.twitchNotificationsEnabled}
                      onChange={(e) => updateDraft({twitchNotificationsEnabled: e.target.checked})}
                    />
                    Enabled
                  </label>

                  <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10}}>
                    <div style={{display: 'grid', gap: 6}}>
                      <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Twitch Client ID</Text>
                      <Input
                        aria-label="Twitch Client ID"
                        fullWidth
                        value={settings.twitchClientId || ''}
                        onChange={(e) => updateDraft({twitchClientId: e.target.value.trim()})}
                      />
                    </div>

                    <div style={{display: 'grid', gap: 6}}>
                      <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Twitch Client Secret</Text>
                      <Input.Password
                        aria-label="Twitch Client Secret"
                        fullWidth
                        value={settings.twitchClientSecret || ''}
                        onChange={(e) => updateDraft({twitchClientSecret: e.target.value.trim()})}
                      />
                    </div>

                    <div style={{display: 'grid', gap: 6}}>
                      <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Notification Channel ID</Text>
                      <Input
                        aria-label="Twitch Notification Channel ID"
                        fullWidth
                        value={settings.twitchNotificationChannelId || ''}
                        onChange={(e) => updateDraft({twitchNotificationChannelId: e.target.value.replace(/[^0-9]/g, '')})}
                      />
                    </div>

                    <div style={{display: 'grid', gap: 6}}>
                      <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Mention Role</Text>
                      <select
                        value={settings.twitchNotificationMentionRoleId || ''}
                        onChange={(e) => updateDraft({twitchNotificationMentionRoleId: e.target.value})}
                        style={{
                          width: '100%',
                          minHeight: 42,
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: '2px solid var(--reblas-outline)',
                          background: 'rgba(0,0,0,0.3)',
                          color: 'white',
                        }}
                      >
                        <option value="">No mention role</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{display: 'grid', gap: 8}}>
                    <Text size="$sm" css={{fontWeight: 800, mb: 0}}>Streamers</Text>
                    <div style={{display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center'}}>
                      <Input
                        aria-label="Twitch streamer login"
                        fullWidth
                        placeholder="Streamer login, @name, or twitch.tv/name"
                        value={pendingTwitchStreamer}
                        onChange={(e) => setPendingTwitchStreamer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTwitchStreamerLogin();
                          }
                        }}
                      />
                      <Button className="reblas-btn-1" auto onPress={addTwitchStreamerLogin}>
                        Add Streamer
                      </Button>
                    </div>
                    <Text size="$xs" css={{opacity: 0.65, mb: 0}}>
                      Use the Twitch login name, not the stream title. The bot posts once per go-live event and waits for the stream to end before posting again.
                    </Text>
                    {renderIdChips(
                      settings.twitchStreamerLogins || [],
                      (login) =>
                        updateDraft({
                          twitchStreamerLogins: (settings.twitchStreamerLogins || []).filter((entry) => entry !== login),
                        })
                    )}
                  </div>
                </div>
              </Card>
            </div>
          </Flex>
        </Card>
      ) : null}

      {tab === 'reactions' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Text h3 css={{mb: '$8'}}>Reactions</Text>

          <Flex direction="column" css={{gap: '$8'}}>
            <Card css={{...glassCardCss, p: '$7'}}>
              <div style={{display: 'grid', gap: 12}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap'}}>
                  <div>
                    <Text css={{fontWeight: 900, mb: '$1'}}>Reaction Role Embed</Text>
                    <Text size="$sm" css={{opacity: 0.7, mb: 0}}>
                      The main bot creates the channel if needed, posts one embed, and keeps its reactions synced.
                    </Text>
                  </div>
                  <label style={{display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, cursor: 'pointer'}}>
                    <input
                      type="checkbox"
                      checked={!!settings.reactionBotEnabled}
                      onChange={(e) => updateDraft({reactionBotEnabled: e.target.checked})}
                    />
                    Enabled
                  </label>
                </div>

                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10}}>
                  <Input
                    aria-label="Reaction channel name"
                    fullWidth
                    label="Channel Name"
                    value={settings.reactionBotChannelName || 'reactions'}
                    onChange={(e) => updateDraft({reactionBotChannelName: e.target.value})}
                  />
                  <Input
                    aria-label="Reaction channel ID"
                    fullWidth
                    label="Channel ID"
                    placeholder="Auto-created if blank"
                    value={settings.reactionBotChannelId || ''}
                    onChange={(e) => updateDraft({reactionBotChannelId: e.target.value.replace(/[^0-9]/g, '')})}
                  />
                  <Input
                    aria-label="Reaction message ID"
                    fullWidth
                    label="Message ID"
                    placeholder="Auto-created if blank"
                    value={settings.reactionBotMessageId || ''}
                    onChange={(e) => updateDraft({reactionBotMessageId: e.target.value.replace(/[^0-9]/g, '')})}
                  />
                  <Input
                    aria-label="Reaction embed color"
                    fullWidth
                    label="Embed Color"
                    value={settings.reactionBotEmbedColor || '#3b82f6'}
                    onChange={(e) => updateDraft({reactionBotEmbedColor: e.target.value})}
                  />
                </div>

                <Input
                  aria-label="Reaction embed title"
                  fullWidth
                  label="Embed Title"
                  value={settings.reactionBotEmbedTitle || ''}
                  onChange={(e) => updateDraft({reactionBotEmbedTitle: e.target.value})}
                />
                <textarea
                  aria-label="Reaction embed description"
                  value={settings.reactionBotEmbedDescription || ''}
                  onChange={(e) => updateDraft({reactionBotEmbedDescription: e.target.value})}
                  rows={4}
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    padding: 12,
                    borderRadius: 12,
                    border: '2px solid var(--reblas-outline)',
                    background: 'rgba(0,0,0,0.2)',
                    color: 'white',
                    font: 'inherit',
                  }}
                />
              </div>
            </Card>

            <Card css={{...glassCardCss, p: '$7'}}>
              <div style={{display: 'grid', gap: 12}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap'}}>
                  <div>
                    <Text css={{fontWeight: 900, mb: '$1'}}>Reaction Roles</Text>
                    <Text size="$sm" css={{opacity: 0.7, mb: 0}}>
                      Add one row per emoji and role. The embed updates itself when these rows change.
                    </Text>
                  </div>
                  <Button className="reblas-btn-1" auto onPress={loadRoles} disabled={rolesLoading}>
                    {rolesLoading ? 'Refreshing...' : 'Refresh Roles'}
                  </Button>
                </div>

                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10}}>
                  <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10}}>
                    <Input
                      aria-label="Reaction emoji"
                      placeholder="Emoji or custom emoji"
                      value={pendingReactionEmoji}
                      onChange={(e) => setPendingReactionEmoji(e.target.value)}
                    />
                    <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                      <EmojiPicker
                        onPick={(emoji) => setPendingReactionEmoji(emoji)}
                        triggerLabel={pendingReactionEmoji ? `Pick Emoji (${pendingReactionEmoji})` : 'Pick Emoji'}
                      />
                      <Text size="$xs" css={{opacity: 0.65, mb: 0}}>
                        Use the picker or paste a custom Discord emoji.
                      </Text>
                    </div>
                  </div>
                  <Input
                    aria-label="Reaction label"
                    placeholder="Label"
                    value={pendingReactionLabel}
                    onChange={(e) => setPendingReactionLabel(e.target.value)}
                  />
                  <select
                    value={pendingReactionRoleId}
                    onChange={(e) => setPendingReactionRoleId(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: 42,
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '2px solid var(--reblas-outline)',
                      background: 'rgba(0,0,0,0.3)',
                      color: 'white',
                    }}
                  >
                    <option value="">Select role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 10, alignItems: 'center'}}>
                  <Input
                    aria-label="Reaction description"
                    fullWidth
                    placeholder="Optional short description"
                    value={pendingReactionDescription}
                    onChange={(e) => setPendingReactionDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addReactionRole();
                      }
                    }}
                  />
                  <Button className="reblas-btn-1" auto onPress={addReactionRole}>
                    Add Reaction
                  </Button>
                </div>

                {(settings.reactionRoles || []).length ? (
                  <div style={{display: 'grid', gap: 10}}>
                    {(settings.reactionRoles || []).map((item) => {
                      const role = roleById.get(item.roleId);
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '90px minmax(150px, 1fr) minmax(220px, 1fr) minmax(220px, 1fr) auto',
                            gap: 10,
                            alignItems: 'center',
                            padding: 10,
                            borderRadius: 12,
                            border: '2px solid var(--reblas-outline)',
                            background: 'rgba(0,0,0,0.14)',
                          }}
                        >
                          <Input
                            aria-label="Reaction emoji"
                            value={item.emoji}
                            onChange={(e) => updateReactionRole(item.id, {emoji: e.target.value})}
                          />
                          <Input
                            aria-label="Reaction label"
                            value={item.label}
                            onChange={(e) => updateReactionRole(item.id, {label: e.target.value})}
                          />
                          <select
                            value={item.roleId}
                            onChange={(e) => updateReactionRole(item.id, {roleId: e.target.value})}
                            style={{
                              width: '100%',
                              minHeight: 42,
                              padding: '10px 12px',
                              borderRadius: 12,
                              border: '2px solid var(--reblas-outline)',
                              background: 'rgba(0,0,0,0.3)',
                              color: 'white',
                            }}
                          >
                            <option value={item.roleId}>{role?.name || item.roleId}</option>
                            {roles
                              .filter((r) => r.id !== item.roleId)
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                          </select>
                          <Input
                            aria-label="Reaction description"
                            value={item.description || ''}
                            onChange={(e) => updateReactionRole(item.id, {description: e.target.value})}
                          />
                          <Button
                            auto
                            className="reblas-btn-1"
                            css={{minWidth: 'auto', px: '$5'}}
                            onPress={() => removeReactionRole(item.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Text size="$sm" css={{opacity: 0.65, mb: 0}}>No reaction roles configured.</Text>
                )}
              </div>
            </Card>
          </Flex>
        </Card>
      ) : null}

      {tab === 'setup' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Text h3 css={{mb: '$8'}}>Setup</Text>

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 16, marginBottom: 16}}>
            <UploadCard
              title="Guild Avatar"
              subtitle="Shown in the top navbar."
              kind="avatar"
              value={settings.guildAvatar}
              onChange={(v) => updateDraft({guildAvatar: v})}
            />

            <UploadCard
              title="Dashboard Background"
              subtitle="Used behind the main content area."
              kind="background"
              value={settings.dashboardBackground}
              onChange={(v) => updateDraft({dashboardBackground: v})}
            />
          </div>

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16}}>
            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$6'}}>Guild Name</Text>
              <Input
                aria-label="Enter Guild Name"
                placeholder="Enter Guild Name"
                fullWidth
                value={settings.guildName}
                onChange={(e) => updateDraft({guildName: e.target.value})}
              />
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$6'}}>Guild ID</Text>
              <Input
                aria-label="Enter Guild ID"
                placeholder="Enter Guild ID"
                fullWidth
                value={settings.guildId}
                onChange={(e) => updateDraft({guildId: e.target.value.replace(/[^0-9]/g, '')})}
              />
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$6'}}>Sub Guild ID</Text>
              <Input
                aria-label="Enter Sub Guild ID"
                placeholder="Enter Sub Guild ID"
                fullWidth
                value={settings.subGuildId}
                onChange={(e) => updateDraft({subGuildId: e.target.value.replace(/[^0-9]/g, '')})}
              />
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$6'}}>Owner Discord ID</Text>
              <Input fullWidth readOnly value={ownerId || 'Not set'} aria-label="Owner Discord ID" />
              <Spacer y={0.6} />
              <Button disabled={!isPrimaryOwner} className="reblas-btn-3" onPress={openTransfer} css={{width: '100%'}}>
                Transfer Ownership
              </Button>
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$2'}}>Co-Owner Discord IDs</Text>
              <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
                Co-owners get full dashboard access. Transfer ownership still requires the primary owner.
              </Text>
              <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'end'}}>
                <Input
                  aria-label="Add co-owner Discord ID"
                  placeholder="Enter Discord User ID"
                  fullWidth
                  value={pendingCoOwnerId}
                  onChange={(e) => setPendingCoOwnerId(String(e.target.value || '').replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCoOwnerId();
                    }
                  }}
                />
                <Button className="reblas-btn-1" onPress={addCoOwnerId}>
                  Add
                </Button>
              </div>
              <Spacer y={0.8} />
              {renderIdChips(settings.coOwnerDiscordIds || [], (id) => {
                updateDraft({coOwnerDiscordIds: (settings.coOwnerDiscordIds || []).filter((entry) => entry !== id)});
              })}
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$6'}}>Bot Token</Text>
              <Input
                aria-label="Enter Bot Token"
                placeholder="Enter Bot Token"
                type="password"
                fullWidth
                value={settings.botToken}
                onChange={(e) => updateDraft({botToken: e.target.value})}
              />
              <Spacer y={0.6} />
              <Button
                className="reblas-btn-1"
                css={{width: '100%'}}
                disabled={!String((settings as any)?.discordClientId || '').trim()}
                onPress={() => {
                  const clientId = String((settings as any)?.discordClientId || '').trim();
                  if (!clientId) return;

                  const guildId = String((settings as any)?.guildId || '').trim();

                  const params = new URLSearchParams({
                    client_id: clientId,
                    scope: 'bot applications.commands',
                    permissions: '0',
                  });

                  if (guildId) {
                    params.set('guild_id', guildId);
                    params.set('disable_guild_select', 'true');
                  }

                  window.open(
                    `https://discord.com/api/oauth2/authorize?${params.toString()}`,
                    '_blank',
                    'noopener,noreferrer'
                  );
                }}
              >
                Invite Bot to Server
              </Button>
              <Text size="$xs" css={{opacity: 0.7, mt: '$4'}}>
                Uses your Discord Client ID. If Guild ID is set, the server picker will be locked.
              </Text>
            </Card>
          </div>
        </Card>
      ) : null}

      {tab === 'theme' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Text h3 css={{mb: '$8'}}>Theme Settings</Text>

          <Flex direction="column" css={{gap: '$10'}}>
            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$2'}}>Outline Color</Text>
              <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>Hex only (supports alpha): e.g. #ffffff14</Text>

              <div style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
                <input
                  type="color"
                  value={(settings.outlineColor || '#ffffff').slice(0, 7)}
                  onChange={(e) => {
                    const hex6 = e.target.value;
                    const cur = (settings.outlineColor || '').trim();
                    const alpha = cur.length === 9 ? cur.slice(7, 9) : '14';
                    updateDraft({outlineColor: `${hex6}${alpha}`});
                  }}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    border: '2px solid var(--reblas-outline)',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                />
                <Input
                  aria-label="#ffffff14"
                  label="Hex Color"
                  placeholder="#ffffff14"
                  fullWidth
                  value={settings.outlineColor || ''}
                  onChange={(e) => updateDraft({outlineColor: e.target.value})}
                />
              </div>
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$2'}}>Button Styles</Text>
              <Text size="$sm" css={{opacity: 0.7, mb: '$8'}}>
                Colors only. Use <code>className=&quot;reblas-btn-1&quot;</code> … <code>reblas-btn-4</code> on any NextUI Button.
              </Text>

              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14}}>
                {[0, 1, 2, 3].map((idx) => {
                  const color = settings.buttonStyles?.[idx]?.color || ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b'][idx];
                  const cls = `reblas-btn-${idx + 1}`;

                  return (
                    <Card
                      key={idx}
                      css={{
                        p: '$8',
                        background: 'rgba(0,0,0,0.12)',
                        border: '2px solid var(--reblas-outline)',
                        backdropFilter: 'blur(14px)',
                      }}
                    >
                      <Text css={{fontWeight: 900, mb: '$6'}}>Style {idx + 1}</Text>

                      <div style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12}}>
                        <input
                          type="color"
                          value={(color || '#3b82f6').slice(0, 7)}
                          onChange={(e) => {
                            const next = [...(settings.buttonStyles || [])];
                            while (next.length < 4) next.push({color: '#3b82f6'});
                            const cur = String(next[idx]?.color || '').trim();
                            const alpha = cur.length === 9 ? cur.slice(7, 9) : '';
                            next[idx] = {color: `${e.target.value}${alpha}`};
                            updateDraft({buttonStyles: next});
                          }}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            border: '2px solid var(--reblas-outline)',
                            background: 'transparent',
                            padding: 0,
                            cursor: 'pointer',
                          }}
                          aria-label={`Pick button style ${idx + 1} color`}
                        />

                        <Input
                          aria-label="#3b82f6"
                          label="Hex Color"
                          placeholder="#3b82f6"
                          fullWidth
                          value={color}
                          onChange={(e) => {
                            const next = [...(settings.buttonStyles || [])];
                            while (next.length < 4) next.push({color: '#3b82f6'});
                            next[idx] = {color: e.target.value};
                            updateDraft({buttonStyles: next});
                          }}
                        />
                      </div>

                      <Button className={cls} css={{width: '100%'}}>
                        Preview
                      </Button>
                    </Card>
                  );
                })}
              </div>
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$2'}}>Member of the Month Card Theme</Text>
              <Text size="$sm" css={{opacity: 0.7, mb: '$8'}}>
                Customize the sidebar card colors.
              </Text>

              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14}}>
                {renderThemeColorControl(
                  'Glow Effect Color',
                  settings.memberOfMonthGlowColor || '#3b82f6',
                  (next) => updateDraft({memberOfMonthGlowColor: next}),
                  '#3b82f6'
                )}
                {renderThemeColorControl(
                  'Avatar Ring Color',
                  settings.memberOfMonthAvatarRingColor || '#3b82f6',
                  (next) => updateDraft({memberOfMonthAvatarRingColor: next}),
                  '#3b82f6'
                )}
                {renderThemeColorControl(
                  'Sparkle Color',
                  settings.memberOfMonthSparkleColor || '#3b82f6',
                  (next) => updateDraft({memberOfMonthSparkleColor: next}),
                  '#3b82f6'
                )}
                {renderThemeColorControl(
                  'Text Color',
                  settings.memberOfMonthTextColor || '#fbbf24',
                  (next) => updateDraft({memberOfMonthTextColor: next}),
                  '#fbbf24'
                )}
              </div>
            </Card>
          </Flex>
        </Card>
      ) : null}

      {tab === 'members' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Flex align="center" justify="between" css={{mb: '$8', gap: '$8', flexWrap: 'wrap'}}>
            <Text h3 css={{mb: 0}}>Members Settings</Text>
            <Button className="reblas-btn-1" auto onPress={loadRoles} disabled={rolesLoading}>
              {rolesLoading ? 'Refreshing…' : 'Refresh Roles'}
            </Button>
          </Flex>

          {rolesErr || membersSaveErr ? (
            <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
              <Text b>Error</Text>
              {rolesErr ? <Text size="$sm" css={{opacity: 0.9}}>{rolesErr}</Text> : null}
              {membersSaveErr ? <Text size="$sm" css={{opacity: 0.9}}>{membersSaveErr}</Text> : null}
            </Card>
          ) : null}

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 16}}>
            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$2'}}>Roles shown on Members page</Text>
              <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
                Add roles from the dropdown. If this list is empty: all roles show.
              </Text>

              <RoleAddDropdown
                roles={roles}
                selectedIds={displayIds}
                onAdd={(id) => {
                  const next = displayIds.includes(id) ? displayIds : [...displayIds, id];
                  setDisplayIds(next);
                  void saveMembersSettings(next, excludeIds);
                }}
              />

              <Spacer y={0.8} />
              {renderChips(displayIds, (id) => {
                const next = displayIds.filter((x) => x !== id);
                setDisplayIds(next);
                void saveMembersSettings(next, excludeIds);
              })}

              <Spacer y={0.6} />
              <Button
                className="reblas-btn-1"
                auto
                disabled={membersSaving || settingsLoading}
                onPress={() => {
                  setDisplayIds([]);
                  void saveMembersSettings([], excludeIds);
                }}
              >
                Clear list
              </Button>
            </Card>

            <Card css={glassCardCss}>
              <Text css={{fontWeight: 900, mb: '$2'}}>Exclude members with these roles</Text>
              <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
                If a member has ANY role in this list, they are hidden.
              </Text>

              <RoleAddDropdown
                roles={roles}
                selectedIds={excludeIds}
                onAdd={(id) => {
                  const next = excludeIds.includes(id) ? excludeIds : [...excludeIds, id];
                  setExcludeIds(next);
                  void saveMembersSettings(displayIds, next);
                }}
              />

              <Spacer y={0.8} />
              {renderChips(excludeIds, (id) => {
                const next = excludeIds.filter((x) => x !== id);
                setExcludeIds(next);
                void saveMembersSettings(displayIds, next);
              })}

              <Spacer y={0.6} />
              <Button
                className="reblas-btn-1"
                auto
                disabled={membersSaving || settingsLoading}
                onPress={() => {
                  setExcludeIds([]);
                  void saveMembersSettings(displayIds, []);
                }}
              >
                Clear list
              </Button>
            </Card>
          </div>
        </Card>
      ) : null}

      {tab === 'permissions' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Text h3 css={{mb: '$8'}}>Permissions</Text>
          {actualCanManageSettings ? (
            <>
              <Card css={glassCardCss}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap'}}>
                  <div>
                    <Text css={{fontWeight: 900, mb: '$2'}}>View As Member</Text>
                    <Text size="$sm" css={{opacity: 0.72, mb: 0}}>
                      Select a member and switch the dashboard into their view so you can verify access and visibility exactly as they see it. Use the global exit bar or the button here to leave.
                    </Text>
                  </div>
                </div>
                <Spacer y={0.8} />
                <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 10, alignItems: 'end'}}>
                  <div style={{display: 'grid', gap: 6}}>
                    <Text size="$sm" css={{opacity: 0.78, mb: 0}}>Selected Member</Text>
                    <select
                      value={previewMemberId}
                      onChange={(e) => setPreviewMemberId(e.target.value)}
                      style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                    >
                      <option value="">Select member</option>
                      {permMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {displayNameOfMember(member)} ({member.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  {previewMemberMode ? (
                    <Button auto className="reblas-btn-3" onPress={() => void stopPreviewMode()}>
                      Exit Member View
                    </Button>
                  ) : (
                    <Button auto className="reblas-btn-2" onPress={() => void startPreviewMode(previewMemberId)} disabled={!previewMemberId}>
                      View As Member
                    </Button>
                  )}
                </div>
                {previewMemberMode && selectedPreviewMember ? (
                  <>
                    <Spacer y={0.6} />
                    <Text size="$sm" css={{opacity: 0.72, mb: 0}}>
                      Currently viewing as <b>{displayNameOfMember(selectedPreviewMember) || previewMemberId}</b>.
                    </Text>
                  </>
                ) : null}
              </Card>

              <Spacer y={0.8} />
            </>
          ) : null}
          {renderMemberPermissionSection(
            'Wash Permissions',
            'Add members per action. Leave a list empty to allow no one.',
            [
              {k: 'washPermissionAddMemberIds', label: 'Add wash'},
              {k: 'washPermissionEditMemberIds', label: 'Edit'},
              {k: 'washPermissionDeleteMemberIds', label: 'Delete'},
              {k: 'washPermissionMarkPendingMemberIds', label: 'Mark pending'},
              {k: 'washPermissionMarkPaidMemberIds', label: 'Mark paid'},
            ]
          )}

          <Spacer y={0.8} />

          {renderMemberPermissionSection(
            'Order Permissions',
            'Control who can view orders, place them, manage statuses, and cancel them.',
            [
              {k: 'orderPermissionViewMemberIds', label: 'View orders'},
              {k: 'orderPermissionPlaceMemberIds', label: 'Place order'},
              {k: 'orderPermissionManageMemberIds', label: 'Order management'},
              {k: 'orderPermissionCancelMemberIds', label: 'Cancel order'},
            ]
          )}

          <Spacer y={0.8} />

          <Card css={glassCardCss}>
            <Text css={{fontWeight: 900, mb: '$2'}}>Job Tracking View-Only Access</Text>
            <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
              Add Discord user IDs here to allow login access to the Job Tracking page only. These users cannot edit Job Tracking and will be redirected away from every other dashboard page.
            </Text>
            <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'end'}}>
              <Input
                aria-label="Add Job Tracking view-only Discord ID"
                placeholder="Enter Discord User ID"
                fullWidth
                value={pendingJobTrackingViewerId}
                onChange={(e) => setPendingJobTrackingViewerId(String(e.target.value || '').replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addJobTrackingViewerId();
                  }
                }}
              />
              <Button className="reblas-btn-1" onPress={addJobTrackingViewerId}>
                Add
              </Button>
            </div>
            <Spacer y={0.8} />
            {renderIdChips(settings.jobTrackingViewOnlyDiscordIds || [], (id) => {
              updateDraft({
                jobTrackingViewOnlyDiscordIds: (settings.jobTrackingViewOnlyDiscordIds || []).filter((entry) => entry !== id),
              });
            })}
          </Card>
        </Card>
      ) : null}

      {tab === 'subcrews' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Flex align="center" justify="between" css={{mb: '$8', gap: '$8', flexWrap: 'wrap'}}>
            <div>
              <Text h3 css={{mb: 0}}>Sub Crews</Text>
              <Text size="$sm" css={{opacity: 0.72}}>
                Configure sub crew access, member rosters, and outline colors.
              </Text>
            </div>
            <Button className="reblas-btn-2" auto onPress={openCreateSubCrew}>
              Create Sub Crew
            </Button>
          </Flex>

          {subCrewErr && !subCrewModalOpen ? (
            <Card css={{p: '$6', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
              <Text size="$sm">{subCrewErr}</Text>
            </Card>
          ) : null}

          <Card css={glassCardCss}>
            {sortedSubCrews.length === 0 ? (
              <Text size="$sm" css={{opacity: 0.72}}>
                No sub crews configured yet.
              </Text>
            ) : (
              <div style={{overflowX: 'auto'}}>
                <table style={{width: '100%', borderCollapse: 'collapse', minWidth: 1020}}>
                  <thead>
                    <tr>
                      <th style={settingsTableHeaderStyle}>Sub Crew</th>
                      <th style={settingsTableHeaderStyle}>Outline</th>
                      <th style={settingsTableHeaderStyle}>Sub Guild ID</th>
                      <th style={settingsTableHeaderStyle}>Required Roles</th>
                      <th style={settingsTableHeaderStyle}>Synced Members</th>
                      <th style={{...settingsTableHeaderStyle, textAlign: 'right'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSubCrews.map((crew) => {
                      return (
                        <tr key={crew.id}>
                          <td style={settingsTableCellStyle}>
                            <div style={{fontWeight: 800}}>{crew.name}</div>
                            <div style={{opacity: 0.58, fontSize: 12}}>{crew.id}</div>
                          </td>
                          <td style={settingsTableCellStyle}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                              <div
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: 999,
                                  background: crew.outlineColor,
                                  border: '1px solid rgba(255,255,255,0.25)',
                                }}
                              />
                              <span>{crew.outlineColor}</span>
                            </div>
                          </td>
                          <td style={settingsTableCellStyle}>
                            <span>{subCrewSourceGuildId || 'Not set'}</span>
                          </td>
                          <td style={settingsTableCellStyle}>
                            <span style={{opacity: 0.72}}>
                              {crew.roleIds?.length ? `${crew.roleIds.length} roles` : 'All roles'}
                            </span>
                          </td>
                          <td style={settingsTableCellStyle}>
                            <span style={{opacity: 0.72}}>{crew.memberIds.length} members</span>
                          </td>
                          <td style={{...settingsTableCellStyle, textAlign: 'right'}}>
                            <div style={{display: 'inline-flex', gap: 8}}>
                              <Button
                                auto
                                light
                                className="reblas-btn-2"
                                onPress={() => void syncSubCrewMembers(crew.id)}
                                disabled={subCrewSyncingId === crew.id || !subCrewSourceGuildId}
                              >
                                {subCrewSyncingId === crew.id ? 'Syncing…' : 'Sync Members'}
                              </Button>
                              <Button
                                auto
                                light
                                className="reblas-btn-1"
                                onPress={() => copyInviteLink(subCrewSourceGuildId)}
                                disabled={!subCrewSourceGuildId}
                              >
                                Copy Invite
                              </Button>
                              <Button auto light className="reblas-btn-1" onPress={() => openEditSubCrew(crew)}>
                                Edit
                              </Button>
                              <Button auto light className="reblas-btn-3" onPress={() => removeSubCrew(crew.id)}>
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Card>
      ) : null}

      {tab === 'embeds' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Flex align="center" justify="between" css={{mb: '$8', gap: '$8', flexWrap: 'wrap'}}>
            <Text h3 css={{mb: 0}}>Embeds</Text>
            <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
              <Button className="reblas-btn-1" auto onPress={loadEmbeds} disabled={embedsLoading}>
                {embedsLoading ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Button
                className="reblas-btn-2"
                auto
                onPress={() => {
                  setEmbedDraftAnnouncement(blankAnnouncementDraft());
                  setCreateEmbedOpen(true);
                }}
              >
                Create Embed
              </Button>
            </div>
          </Flex>

          {embedsErr ? (
            <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
              <Text size="$sm" css={{opacity: 0.95, fontWeight: 800}}>{embedsErr}</Text>
            </Card>
          ) : null}

          <Card css={glassCardCss}>
            <Text css={{fontWeight: 900, mb: '$6'}}>Weekly Reminder Embeds</Text>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, 1fr) auto',
                gap: 10,
                alignItems: 'end',
                marginBottom: 16,
              }}
            >
              <Input
                label="All Members Summary Channel ID"
                fullWidth
                placeholder="Discord channel ID"
                value={weeklySummaryChannelDraft}
                onChange={(e) => setWeeklySummaryChannelDraft(e.target.value)}
              />
              <Input
                label="All Members Summary Tag Role ID"
                fullWidth
                placeholder="Discord role ID"
                value={weeklySummaryRoleDraft}
                onChange={(e) => setWeeklySummaryRoleDraft(e.target.value)}
              />
              <Button
                className="reblas-btn-2"
                auto
                onPress={() => updateWeeklySummarySettings(weeklySummaryChannelDraft, weeklySummaryRoleDraft)}
                disabled={
                  weeklySummaryChannelDraft === String(embedsStore?.weeklySummaryChannelId || '') &&
                  weeklySummaryRoleDraft === String(embedsStore?.weeklySummaryRoleId || '')
                }
              >
                Save Summary
              </Button>
            </div>
            <Text size="$sm" css={{opacity: 0.72, mb: '$6'}}>
              Used only for the combined all-members weekly reminder summary posted during manual and automatic reminder sends.
              The role tag applies only to that summary embed.
            </Text>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse'}}>
                <thead>
                  <tr>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Name</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Title</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Status</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyTemplateRows.map((row) => (
                    <tr key={row.id} style={{borderTop: '1px solid var(--reblas-outline)'}}>
                      <td style={{padding: '10px'}}>{row.name}</td>
                      <td style={{padding: '10px'}}>{row.title}</td>
                      <td style={{padding: '10px'}}>{`${row.statusEmoji} ${row.statusLabel}`}</td>
                      <td style={{padding: '10px', whiteSpace: 'nowrap'}}>
                        <Button
                          className="reblas-btn-1"
                          auto
                          size="sm"
                          onPress={() => {
                            setSelectedWeeklyId(row.id);
                            setEmbedDraftWeekly({...row});
                            setEmbedViewOpen(true);
                          }}
                        >
                          View
                        </Button>
                        <Spacer x={0.4} inline />
                        <Button
                          className="reblas-btn-2"
                          auto
                          size="sm"
                          onPress={() => {
                            setSelectedWeeklyId(row.id);
                            setEmbedDraftWeekly({...row});
                            setEmbedEditOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Spacer y={0.9} />

          <Card css={glassCardCss}>
            <Text css={{fontWeight: 900, mb: '$6'}}>Scheduled Announcement Embeds</Text>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse'}}>
                <thead>
                  <tr>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Name</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Channel</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Schedule</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {announcementRows.length === 0 ? (
                    <tr>
                      <td style={{padding: '10px'}} colSpan={4}>
                        <Text size="$sm" css={{opacity: 0.7, mb: 0}}>No custom embeds yet.</Text>
                      </td>
                    </tr>
                  ) : (
                    announcementRows.map((row) => (
                      <tr key={row.id} style={{borderTop: '1px solid var(--reblas-outline)'}}>
                        <td style={{padding: '10px'}}>{row.name}</td>
                        <td style={{padding: '10px'}}>{row.channelId ? `#${row.channelId}` : '(unset)'}</td>
                        <td style={{padding: '10px'}}>
                          {row.frequency === 'daily' ? 'Daily' : `Weekly ${dayLabels[row.dayOfWeek] || 'Fri'}`} at {row.timeHHMM}
                          {(row.mentionRoleIds || []).length ? ` • ${row.mentionRoleIds.length} tags` : ''}
                        </td>
                        <td style={{padding: '10px', whiteSpace: 'nowrap'}}>
                          <Button
                            className="reblas-btn-1"
                            auto
                            size="sm"
                            onPress={() => {
                              setSelectedAnnouncementId(row.id);
                              setEmbedDraftAnnouncement({...row});
                              setEmbedViewOpen(true);
                            }}
                          >
                            View
                          </Button>
                          <Spacer x={0.4} inline />
                          <Button
                            className="reblas-btn-2"
                            auto
                            size="sm"
                            onPress={() => {
                              setSelectedAnnouncementId(row.id);
                              setEmbedDraftAnnouncement({...row});
                              setEmbedEditOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Spacer x={0.4} inline />
                          <Button
                            className="reblas-btn-3"
                            auto
                            size="sm"
                            onPress={() => {
                              if (!window.confirm(`Delete embed "${row.name}"?`)) return;
                              void deleteAnnouncement(row.id);
                            }}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Spacer y={0.9} />

          <Card css={glassCardCss}>
            <Text css={{fontWeight: 900, mb: '$2'}}>Sub Crew Embed Templates</Text>
            <Text size="$sm" css={{opacity: 0.72, mb: '$6'}}>
              {'Build the default embeds used for sub crew wash logs and order updates. Use placeholders like {crewName}, {date}, {dirtyCollected}, {itemName}.'}
            </Text>
            <div style={{overflowX: 'auto'}}>
              <table style={{width: '100%', borderCollapse: 'collapse'}}>
                <thead>
                  <tr>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Name</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Title</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Color</th>
                    <th style={{textAlign: 'left', padding: '8px 10px'}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subCrewTemplateRows.map((row) => (
                    <tr key={row.id} style={{borderTop: '1px solid var(--reblas-outline)'}}>
                      <td style={{padding: '10px'}}>{row.name}</td>
                      <td style={{padding: '10px'}}>{row.title}</td>
                      <td style={{padding: '10px'}}>{row.color}</td>
                      <td style={{padding: '10px', whiteSpace: 'nowrap'}}>
                        <Button
                          className="reblas-btn-1"
                          auto
                          size="sm"
                          onPress={() => {
                            setSelectedSubCrewTemplateId(row.id);
                            setEmbedDraftSubCrewTemplate({...row});
                            setEmbedViewOpen(true);
                          }}
                        >
                          View
                        </Button>
                        <Spacer x={0.4} inline />
                        <Button
                          className="reblas-btn-2"
                          auto
                          size="sm"
                          onPress={() => {
                            setSelectedSubCrewTemplateId(row.id);
                            setEmbedDraftSubCrewTemplate({...row});
                            setEmbedEditOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Spacer y={0.9} />

          <Card css={glassCardCss}>
            <Text css={{fontWeight: 900, mb: '$2'}}>Crew Embed Channels</Text>
            <Text size="$sm" css={{opacity: 0.72, mb: '$6'}}>
              Configure where wash log and order update embeds should be posted for the main crew and each sub crew.
            </Text>
            <div style={{display: 'grid', gap: 12}}>
              <Card
                css={{
                  p: '$6',
                  background: 'rgba(0,0,0,0.12)',
                  border: '2px solid var(--reblas-outline)',
                  backdropFilter: 'blur(14px)',
                }}
              >
                <div style={{display: 'grid', gap: 12}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                    <Text b css={{mb: 0}}>Reblas Mafia</Text>
                    <Text size="$xs" css={{mb: 0, opacity: 0.58}}>main</Text>
                  </div>
                  <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12}}>
                    <Input
                      label="Wash Log Channel ID"
                      fullWidth
                      value={settings.mainCrewWashLogChannelId || ''}
                      onChange={(e) => updateDraft({mainCrewWashLogChannelId: e.target.value})}
                    />
                    <Input
                      label="Wash Log Tag Role IDs"
                      fullWidth
                      value={formatRoleIdInput(settings.mainCrewWashLogMentionRoleIds || [])}
                      onChange={(e) => updateDraft({mainCrewWashLogMentionRoleIds: parseRoleIdInput(e.target.value)})}
                    />
                    <Input
                      label="Order Updates Channel ID"
                      fullWidth
                      value={settings.mainCrewOrderUpdatesChannelId || ''}
                      onChange={(e) => updateDraft({mainCrewOrderUpdatesChannelId: e.target.value})}
                    />
                    <Input
                      label="Order Updates Tag Role IDs"
                      fullWidth
                      value={formatRoleIdInput(settings.mainCrewOrderUpdatesMentionRoleIds || [])}
                      onChange={(e) => updateDraft({mainCrewOrderUpdatesMentionRoleIds: parseRoleIdInput(e.target.value)})}
                    />
                  </div>
                </div>
              </Card>
              {sortedSubCrews.length === 0 ? (
                <Text size="$sm" css={{opacity: 0.72}}>No sub crews configured yet.</Text>
              ) : (
                sortedSubCrews.map((crew) => (
                  <Card
                    key={`embed_channels_${crew.id}`}
                    css={{
                      p: '$6',
                      background: 'rgba(0,0,0,0.12)',
                      border: '2px solid var(--reblas-outline)',
                      backdropFilter: 'blur(14px)',
                    }}
                  >
                    <div style={{display: 'grid', gap: 12}}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                        <Text b css={{mb: 0}}>{crew.name}</Text>
                        <Text size="$xs" css={{mb: 0, opacity: 0.58}}>{crew.id}</Text>
                      </div>
                      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12}}>
                        <Input
                          label="Wash Log Channel ID"
                          fullWidth
                          value={crew.washLogChannelId || ''}
                          onChange={(e) => updateSubCrewChannels(crew.id, {washLogChannelId: e.target.value})}
                        />
                        <Input
                          label="Wash Log Tag Role IDs"
                          fullWidth
                          value={formatRoleIdInput(crew.washLogMentionRoleIds || [])}
                          onChange={(e) =>
                            updateSubCrewChannels(crew.id, {washLogMentionRoleIds: parseRoleIdInput(e.target.value)})
                          }
                        />
                        <Input
                          label="Order Updates Channel ID"
                          fullWidth
                          value={crew.orderUpdatesChannelId || ''}
                          onChange={(e) => updateSubCrewChannels(crew.id, {orderUpdatesChannelId: e.target.value})}
                        />
                        <Input
                          label="Order Updates Tag Role IDs"
                          fullWidth
                          value={formatRoleIdInput(crew.orderUpdatesMentionRoleIds || [])}
                          onChange={(e) =>
                            updateSubCrewChannels(crew.id, {orderUpdatesMentionRoleIds: parseRoleIdInput(e.target.value)})
                          }
                        />
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </Card>
        </Card>
      ) : null}

      {tab === 'items' ? (
        <Card css={{p: '$10', background: 'rgba(0,0,0,0.14)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
          <Flex align="center" justify="between" css={{mb: '$8', gap: '$8', flexWrap: 'wrap'}}>
            <div>
              <Text h3 css={{mb: 0}}>Items</Text>
              <Text size="$sm" css={{opacity: 0.72}}>
                Manage the item catalog for mats and orderable items.
              </Text>
            </div>
            <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
              <Button className="reblas-btn-1" auto onPress={loadItems} disabled={itemsLoading}>
                {itemsLoading ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Button className="reblas-btn-2" auto onPress={openCreateItem}>
                Add Item
              </Button>
            </div>
          </Flex>

          {itemsErr ? (
            <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
              <Text size="$sm" css={{opacity: 0.95, fontWeight: 800}}>{itemsErr}</Text>
            </Card>
          ) : null}

          <div style={{display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16}}>
            <Button
              auto
              className={itemTab === 'mats' ? 'reblas-btn-2' : 'reblas-btn-1'}
              onPress={() => setItemTab('mats')}
            >
              Mats
            </Button>
            <Button
              auto
              className={itemTab === 'orders' ? 'reblas-btn-2' : 'reblas-btn-1'}
              onPress={() => setItemTab('orders')}
            >
              Orders
            </Button>
          </div>

          <Card css={glassCardCss}>
            {itemTab === 'mats' ? (
              <div style={{overflowX: 'auto'}}>
                <table style={{width: '100%', borderCollapse: 'collapse', minWidth: 760}}>
                  <thead>
                    <tr>
                      <th style={settingsTableHeaderStyle}>Image</th>
                      <th style={settingsTableHeaderStyle}>Name</th>
                      <th style={settingsTableHeaderStyle}>Status</th>
                      <th style={{...settingsTableHeaderStyle, textAlign: 'right'}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!filteredItems.length ? (
                      <tr>
                        <td style={settingsTableCellStyle} colSpan={4}>
                          <Text size="$sm" css={{opacity: 0.72}}>No mats created yet.</Text>
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item) => (
                        <tr key={item.id}>
                          <td style={settingsTableCellStyle}>
                            {item.imageUrl ? (
                              <Avatar src={item.imageUrl} squared size="md" css={{boxShadow: '0 0 0 2px var(--reblas-outline)'}} />
                            ) : (
                              <div
                                style={{
                                  width: 42,
                                  height: 42,
                                  borderRadius: 10,
                                  border: '2px solid var(--reblas-outline)',
                                  display: 'grid',
                                  placeItems: 'center',
                                  opacity: 0.6,
                                }}
                              >
                                <Text size="$xs" css={{mb: 0}}>N/A</Text>
                              </div>
                            )}
                          </td>
                          <td style={settingsTableCellStyle}>{item.name}</td>
                          <td style={settingsTableCellStyle}>
                            <span style={{color: item.active ? 'var(--reblas-btn2-color)' : 'var(--reblas-btn3-color)'}}>
                              {item.active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td style={{...settingsTableCellStyle, textAlign: 'right'}}>
                            <div style={{display: 'inline-flex', gap: 8}}>
                              <Button auto light className="reblas-btn-1" onPress={() => openEditItem(item)}>
                                Edit
                              </Button>
                              <Button auto light className="reblas-btn-3" onPress={() => void deleteItem(item.id)}>
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : !filteredItems.length ? (
              <Text size="$sm" css={{opacity: 0.72}}>No order items created yet.</Text>
            ) : (
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, 220px)', gap: 12}}>
                {filteredItems.map((item) => (
                  <Card
                    key={item.id}
                    css={{
                      p: '$4',
                      background: 'rgba(255,255,255,0.04)',
                      border: '2px solid var(--reblas-outline)',
                      width: 220,
                      minWidth: 220,
                      maxWidth: 220,
                      minHeight: 286,
                    }}
                  >
                    <div style={{display: 'grid', gap: 10, height: '100%'}}>
                      <button
                        type="button"
                        onClick={() => openViewItem(item)}
                        style={{
                          appearance: 'none',
                          border: 0,
                          background: 'transparent',
                          padding: 0,
                          margin: 0,
                          display: 'grid',
                          gap: 10,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            style={{
                              width: '100%',
                              height: 154,
                              borderRadius: 14,
                              border: '2px solid var(--reblas-outline)',
                              objectFit: 'cover',
                              display: 'block',
                              background: 'rgba(0,0,0,0.16)',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: 154,
                              borderRadius: 14,
                              border: '2px solid var(--reblas-outline)',
                              display: 'grid',
                              placeItems: 'center',
                              opacity: 0.6,
                              fontSize: 12,
                              background: 'rgba(0,0,0,0.14)',
                            }}
                          >
                            No Image
                          </div>
                        )}
                        <div style={{display: 'grid', gap: 4}}>
                          <Text h4 css={{mb: 0, fontSize: '$md', lineHeight: 1.1}}>{item.name}</Text>
                          <Text
                            size="$xs"
                            css={{
                              mb: 0,
                              color: item.active ? 'var(--reblas-btn2-color)' : 'var(--reblas-btn3-color)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.08em',
                            }}
                          >
                            {item.active ? 'Active' : 'Disabled'}
                          </Text>
                        </div>
                      </button>

                      <div
                        style={{display: 'flex', gap: 5, marginTop: 'auto', justifyContent: 'flex-end'}}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button auto light className="reblas-btn-1" onPress={() => openEditItem(item)}>
                          Edit
                        </Button>
                        <Button auto light className="reblas-btn-3" onPress={() => void deleteItem(item.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Card>
        </Card>
      ) : null}

      {embedViewOpen ? (
        <ModalShell
          onClose={() => {
            setEmbedViewOpen(false);
            setSelectedWeeklyId(null);
            setSelectedSubCrewTemplateId(null);
            setSelectedAnnouncementId('');
            setEmbedDraftWeekly(null);
            setEmbedDraftSubCrewTemplate(null);
            setEmbedDraftAnnouncement(null);
          }}
        >
          <Card css={{p: '$10', background: 'rgba(0,0,0,0.55)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
            <Text h3 css={{mb: '$6'}}>Embed Preview</Text>
            {embedDraftWeekly ? (
              <Card css={glassCardCss}>
                <Text css={{fontWeight: 900, mb: '$2'}}>{embedDraftWeekly.name}</Text>
                <Text css={{fontWeight: 900}}>{embedDraftWeekly.title}</Text>
                <Text css={{opacity: 0.9, mb: '$4'}}>{embedDraftWeekly.description}</Text>
                <Text size="$sm" css={{opacity: 0.8}}>{`${embedDraftWeekly.statusEmoji} ${embedDraftWeekly.statusLabel}`}</Text>
                <Text size="$sm" css={{opacity: 0.8, mt: '$4'}}>{embedDraftWeekly.notice}</Text>
              </Card>
            ) : null}
            {embedDraftSubCrewTemplate ? (
              <Card css={glassCardCss}>
                <Text css={{fontWeight: 900, mb: '$2'}}>{embedDraftSubCrewTemplate.name}</Text>
                <Text css={{fontWeight: 900}}>{previewSubCrewTemplate(embedDraftSubCrewTemplate).title}</Text>
                <Text css={{opacity: 0.9, mb: '$4', whiteSpace: 'pre-wrap'}}>
                  {previewSubCrewTemplate(embedDraftSubCrewTemplate).description}
                </Text>
                <Text size="$sm" css={{opacity: 0.8}}>Color: {embedDraftSubCrewTemplate.color}</Text>
              </Card>
            ) : null}
            {embedDraftAnnouncement ? (
              <Card css={glassCardCss}>
                <Text css={{fontWeight: 900, mb: '$2'}}>{embedDraftAnnouncement.name}</Text>
                <Text css={{fontWeight: 900}}>{embedDraftAnnouncement.title}</Text>
                <Text css={{opacity: 0.9, mb: '$4'}}>{embedDraftAnnouncement.description}</Text>
                <Text size="$sm" css={{opacity: 0.8}}>
                  Channel: {embedDraftAnnouncement.channelId || '(unset)'} • {embedDraftAnnouncement.frequency === 'daily' ? 'Daily' : `Weekly ${dayLabels[embedDraftAnnouncement.dayOfWeek] || 'Fri'}`} @ {embedDraftAnnouncement.timeHHMM}
                  {(embedDraftAnnouncement.mentionRoleIds || []).length ? ` • Tags: ${formatRoleIdInput(embedDraftAnnouncement.mentionRoleIds)}` : ''}
                </Text>
              </Card>
            ) : null}
            <Spacer y={0.8} />
            <Button
              className="reblas-btn-1"
              onPress={() => {
                setEmbedViewOpen(false);
                setSelectedWeeklyId(null);
                setSelectedSubCrewTemplateId(null);
                setSelectedAnnouncementId('');
                setEmbedDraftWeekly(null);
                setEmbedDraftSubCrewTemplate(null);
                setEmbedDraftAnnouncement(null);
              }}
            >
              Close
            </Button>
          </Card>
        </ModalShell>
      ) : null}

      {embedEditOpen ? (
        <ModalShell
          onClose={() => {
            setEmbedEditOpen(false);
            setSelectedWeeklyId(null);
            setSelectedSubCrewTemplateId(null);
            setSelectedAnnouncementId('');
            setEmbedDraftWeekly(null);
            setEmbedDraftSubCrewTemplate(null);
            setEmbedDraftAnnouncement(null);
          }}
        >
          <Card css={{p: '$10', background: 'rgba(0,0,0,0.55)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
            <Text h3 css={{mb: '$6'}}>Edit Embed</Text>
            {embedDraftWeekly && selectedWeeklyId ? (
              <Flex direction="column" css={{gap: '$6'}}>
                <Input label="Name" fullWidth value={embedDraftWeekly.name} onChange={(e) => setEmbedDraftWeekly({...embedDraftWeekly, name: e.target.value})} />
                <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end'}}>
                  <Input label="Title" fullWidth value={embedDraftWeekly.title} onChange={(e) => setEmbedDraftWeekly({...embedDraftWeekly, title: e.target.value})} />
                  <EmojiPicker onPick={(emoji) => appendEmojiToWeeklyField('title', emoji)} />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end'}}>
                  <Input label="Description" fullWidth value={embedDraftWeekly.description} onChange={(e) => setEmbedDraftWeekly({...embedDraftWeekly, description: e.target.value})} />
                  <EmojiPicker onPick={(emoji) => appendEmojiToWeeklyField('description', emoji)} />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end'}}>
                  <Input label="Status Label" fullWidth value={embedDraftWeekly.statusLabel} onChange={(e) => setEmbedDraftWeekly({...embedDraftWeekly, statusLabel: e.target.value})} />
                  <EmojiPicker onPick={(emoji) => appendEmojiToWeeklyField('statusLabel', emoji)} />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end'}}>
                  <Input label="Status Emoji" fullWidth value={embedDraftWeekly.statusEmoji} onChange={(e) => setEmbedDraftWeekly({...embedDraftWeekly, statusEmoji: e.target.value})} />
                  <EmojiPicker onPick={(emoji) => appendEmojiToWeeklyField('statusEmoji', emoji)} />
                </div>
                <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end'}}>
                  <Input label="Notice" fullWidth value={embedDraftWeekly.notice} onChange={(e) => setEmbedDraftWeekly({...embedDraftWeekly, notice: e.target.value})} />
                  <EmojiPicker onPick={(emoji) => appendEmojiToWeeklyField('notice', emoji)} />
                </div>
                <Button className="reblas-btn-2" onPress={() => updateWeeklyTemplate(selectedWeeklyId, embedDraftWeekly)}>Save</Button>
              </Flex>
            ) : null}
            {embedDraftSubCrewTemplate && selectedSubCrewTemplateId ? (
              <Flex direction="column" css={{gap: '$6'}}>
                <Input
                  label="Name"
                  fullWidth
                  value={embedDraftSubCrewTemplate.name}
                  onChange={(e) => setEmbedDraftSubCrewTemplate({...embedDraftSubCrewTemplate, name: e.target.value})}
                />
                <div style={{display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end'}}>
                  <Input
                    label="Title"
                    fullWidth
                    value={embedDraftSubCrewTemplate.title}
                    onChange={(e) => setEmbedDraftSubCrewTemplate({...embedDraftSubCrewTemplate, title: e.target.value})}
                  />
                  <EmojiPicker onPick={(emoji) => appendEmojiToSubCrewField('title', emoji)} />
                </div>
                <div>
                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6}}>
                    <Text size="$sm" css={{opacity: 0.85}}>Description</Text>
                    <EmojiPicker onPick={(emoji) => appendEmojiToSubCrewField('description', emoji)} />
                  </div>
                  <textarea
                    value={embedDraftSubCrewTemplate.description}
                    onChange={(e) => setEmbedDraftSubCrewTemplate({...embedDraftSubCrewTemplate, description: e.target.value})}
                    style={{
                      width: '100%',
                      minHeight: 140,
                      resize: 'vertical',
                      borderRadius: 12,
                      border: '2px solid var(--reblas-outline)',
                      background: 'rgba(0,0,0,0.2)',
                      color: 'white',
                      padding: 10,
                      font: 'inherit',
                    }}
                    placeholder="Embed description..."
                  />
                </div>
                <Input
                  label="Color (#RRGGBB)"
                  fullWidth
                  value={embedDraftSubCrewTemplate.color}
                  onChange={(e) => setEmbedDraftSubCrewTemplate({...embedDraftSubCrewTemplate, color: e.target.value})}
                />
                <Card css={{...glassCardCss, p: '$6'}}>
                  <Text size="$sm" css={{fontWeight: 900, mb: '$2'}}>Available Placeholders</Text>
                  <Text size="$xs" css={{opacity: 0.74, mb: '$1'}}>
                    Wash log: {`{crewName}`}, {`{date}`}, {`{dirtyCollected}`}, {`{washRate}`}, {`{cleanReturned}`}, {`{dirtyCollectedTotal}`}, {`{notes}`}
                  </Text>
                  <Text size="$xs" css={{opacity: 0.74, mb: 0}}>
                    Order update: {`{crewName}`}, {`{itemName}`}, {`{items}`}, {`{quantity}`}, {`{status}`}, {`{statusLabel}`}, {`{dirtyWash}`}, {`{cleanCost}`}, {`{dirtyCash}`}, {`{materials}`}, {`{note}`}, {`{cancelReason}`}
                  </Text>
                </Card>
                <Button className="reblas-btn-2" onPress={() => updateSubCrewTemplate(selectedSubCrewTemplateId, embedDraftSubCrewTemplate)}>
                  Save
                </Button>
              </Flex>
            ) : null}
            {embedDraftAnnouncement && selectedAnnouncementId ? (
              <Flex direction="column" css={{gap: '$6'}}>
                <Input label="Name" fullWidth value={embedDraftAnnouncement.name} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, name: e.target.value})} />
                <Input label="Title" fullWidth value={embedDraftAnnouncement.title} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, title: e.target.value})} />
                <div>
                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6}}>
                    <Text size="$sm" css={{opacity: 0.85}}>Description</Text>
                    <EmojiPicker onPick={appendEmojiToAnnouncementDescription} />
                  </div>
                  <textarea
                    value={embedDraftAnnouncement.description}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, description: e.target.value})}
                    style={{
                      width: '100%',
                      minHeight: 120,
                      resize: 'vertical',
                      borderRadius: 12,
                      border: '2px solid var(--reblas-outline)',
                      background: 'rgba(0,0,0,0.2)',
                      color: 'white',
                      padding: 10,
                      font: 'inherit',
                    }}
                    placeholder="Embed description..."
                  />
                </div>
                <Input label="Channel ID" fullWidth value={embedDraftAnnouncement.channelId} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, channelId: e.target.value})} />
                <Input
                  label="Tag Role IDs"
                  fullWidth
                  value={formatRoleIdInput(embedDraftAnnouncement.mentionRoleIds)}
                  onChange={(e) =>
                    setEmbedDraftAnnouncement({...embedDraftAnnouncement, mentionRoleIds: parseRoleIdInput(e.target.value)})
                  }
                />
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10}}>
                  <select
                    value={embedDraftAnnouncement.frequency}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, frequency: e.target.value as Frequency})}
                    style={{padding: 10, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                  >
                    <option value="weekly">weekly</option>
                    <option value="daily">daily</option>
                  </select>
                  <select
                    value={String(embedDraftAnnouncement.dayOfWeek)}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, dayOfWeek: Number(e.target.value)})}
                    style={{padding: 10, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                  >
                    {dayLabels.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
                  </select>
                  <Input
                    label="Time (HH:MM)"
                    fullWidth
                    value={embedDraftAnnouncement.timeHHMM}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, timeHHMM: e.target.value})}
                  />
                </div>
                <Input label="Color (#RRGGBB)" fullWidth value={embedDraftAnnouncement.color} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, color: e.target.value})} />
                <Button
                  className="reblas-btn-1"
                  onPress={() => setEmbedDraftAnnouncement({...embedDraftAnnouncement, enabled: !embedDraftAnnouncement.enabled})}
                >
                  {embedDraftAnnouncement.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button className="reblas-btn-2" onPress={() => updateAnnouncement(selectedAnnouncementId, embedDraftAnnouncement)}>Save</Button>
              </Flex>
            ) : null}
          </Card>
        </ModalShell>
      ) : null}

      {createEmbedOpen ? (
        <ModalShell
          onClose={() => {
            setCreateEmbedOpen(false);
            setEmbedDraftAnnouncement(null);
          }}
        >
          <Card css={{p: '$10', background: 'rgba(0,0,0,0.55)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
            <Text h3 css={{mb: '$6'}}>Create Embed</Text>
            {embedDraftAnnouncement ? (
              <Flex direction="column" css={{gap: '$6'}}>
                <Input label="Name" fullWidth value={embedDraftAnnouncement.name} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, name: e.target.value})} />
                <Input label="Title" fullWidth value={embedDraftAnnouncement.title} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, title: e.target.value})} />
                <div>
                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6}}>
                    <Text size="$sm" css={{opacity: 0.85}}>Description</Text>
                    <EmojiPicker onPick={appendEmojiToAnnouncementDescription} />
                  </div>
                  <textarea
                    value={embedDraftAnnouncement.description}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, description: e.target.value})}
                    style={{
                      width: '100%',
                      minHeight: 120,
                      resize: 'vertical',
                      borderRadius: 12,
                      border: '2px solid var(--reblas-outline)',
                      background: 'rgba(0,0,0,0.2)',
                      color: 'white',
                      padding: 10,
                      font: 'inherit',
                    }}
                    placeholder="Embed description..."
                  />
                </div>
                <Input label="Channel ID" fullWidth value={embedDraftAnnouncement.channelId} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, channelId: e.target.value})} />
                <Input
                  label="Tag Role IDs"
                  fullWidth
                  value={formatRoleIdInput(embedDraftAnnouncement.mentionRoleIds)}
                  onChange={(e) =>
                    setEmbedDraftAnnouncement({...embedDraftAnnouncement, mentionRoleIds: parseRoleIdInput(e.target.value)})
                  }
                />
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10}}>
                  <select
                    value={embedDraftAnnouncement.frequency}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, frequency: e.target.value as Frequency})}
                    style={{padding: 10, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                  >
                    <option value="weekly">weekly</option>
                    <option value="daily">daily</option>
                  </select>
                  <select
                    value={String(embedDraftAnnouncement.dayOfWeek)}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, dayOfWeek: Number(e.target.value)})}
                    style={{padding: 10, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                  >
                    {dayLabels.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
                  </select>
                  <Input
                    label="Time (HH:MM)"
                    fullWidth
                    value={embedDraftAnnouncement.timeHHMM}
                    onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, timeHHMM: e.target.value})}
                  />
                </div>
                <Input label="Color (#RRGGBB)" fullWidth value={embedDraftAnnouncement.color} onChange={(e) => setEmbedDraftAnnouncement({...embedDraftAnnouncement, color: e.target.value})} />
                <Button className="reblas-btn-2" onPress={() => createAnnouncement(embedDraftAnnouncement)}>Create</Button>
              </Flex>
            ) : null}
          </Card>
        </ModalShell>
      ) : null}

      {subCrewModalOpen && subCrewDraft ? (
        <ModalShell onClose={closeSubCrewModal}>
          <Card css={{p: '$12', background: 'rgba(0,0,0,0.55)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)', maxWidth: 860, width: '100%'}}>
            <Flex align="center" justify="between" css={{mb: '$8', gap: '$8', flexWrap: 'wrap'}}>
              <Text h3 css={{mb: 0}}>{subCrewEditId ? 'Edit Sub Crew' : 'Create Sub Crew'}</Text>
              <Button auto light className="reblas-btn-1" onPress={closeSubCrewModal}>
                Close
              </Button>
            </Flex>

            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16}}>
              <Input
                label="Sub Crew Name"
                fullWidth
                value={subCrewDraft.name}
                onChange={(e) => setSubCrewDraft({...subCrewDraft, name: e.target.value})}
              />
              <div style={{display: 'grid', gap: 8}}>
                <Text size="$sm" css={{opacity: 0.74}}>Outline Color</Text>
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <input
                    type="color"
                    value={(subCrewDraft.outlineColor || '#ffffff').slice(0, 7)}
                    onChange={(e) => {
                      const nextBase = e.target.value;
                      const current = String(subCrewDraft.outlineColor || '').trim();
                      const alpha = current.length === 9 ? current.slice(7, 9) : '14';
                      setSubCrewDraft({...subCrewDraft, outlineColor: `${nextBase}${alpha}`});
                    }}
                    style={{width: 42, height: 42, border: 'none', background: 'transparent'}}
                  />
                  <Input
                    aria-label="Sub crew outline color"
                    fullWidth
                    value={subCrewDraft.outlineColor}
                    onChange={(e) => setSubCrewDraft({...subCrewDraft, outlineColor: e.target.value})}
                  />
                </div>
              </div>
            </div>

            <Spacer y={0.8} />

            <Card css={{...glassCardCss, p: '$6'}}>
              <Flex align="center" justify="between" css={{gap: '$8', flexWrap: 'wrap', mb: '$6'}}>
                <div>
                  <Text css={{fontWeight: 900, mb: 0}}>Guild Sync</Text>
                  <Text size="$sm" css={{opacity: 0.72}}>
                    Members are synced from the shared Sub Guild ID in Setup. If required roles are set, only members with at least one of those roles will be added to this crew.
                  </Text>
                </div>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                  <Button
                    auto
                    className="reblas-btn-1"
                    onPress={() => void loadSubCrewGuildRoles(subCrewSourceGuildId)}
                    disabled={subCrewRolesLoading || !subCrewSourceGuildId}
                  >
                    {subCrewRolesLoading ? 'Loading Roles…' : 'Refresh Roles'}
                  </Button>
                  <Button
                    auto
                    className="reblas-btn-1"
                    onPress={() => copyInviteLink(subCrewSourceGuildId)}
                    disabled={!subCrewSourceGuildId}
                  >
                    Copy Invite
                  </Button>
                </div>
              </Flex>

              {subCrewErr ? <Text size="$sm" css={{color: 'var(--reblas-btn3-color)', mb: '$6'}}>{subCrewErr}</Text> : null}
              {subCrewRolesErr ? <Text size="$sm" css={{color: 'var(--reblas-btn3-color)', mb: '$6'}}>{subCrewRolesErr}</Text> : null}
              {!subCrewSourceGuildId ? (
                <Text size="$sm" css={{color: 'var(--reblas-btn4-color)', mb: '$6'}}>
                  Set a Sub Guild ID in Setup to load roles, copy the invite link, and sync members for sub crews.
                </Text>
              ) : (
                <Text size="$sm" css={{opacity: 0.7, mb: '$6'}}>
                  Current shared sub guild: {subCrewSourceGuildId}
                </Text>
              )}

              <Card css={{...glassCardCss, p: '$6', mb: '$6'}}>
                <Text css={{fontWeight: 900, mb: '$2'}}>Required Roles</Text>
                <Text size="$sm" css={{opacity: 0.72, mb: '$6'}}>
                  Leave empty to sync everyone in the guild. If roles are selected, a member must have at least one of them to be synced.
                </Text>

                <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                  <Dropdown>
                    <Dropdown.Trigger>
                      <Button auto className="reblas-btn-1" disabled={subCrewRolesLoading || !subCrewRoles.length}>
                        {subCrewRolesLoading ? 'Loading…' : 'Add Role'}
                      </Button>
                    </Dropdown.Trigger>
                    <Dropdown.Menu
                      aria-label="Sub crew required roles"
                      items={
                        subCrewRoles.filter((role) => !(subCrewDraft.roleIds || []).includes(role.id)).length
                          ? subCrewRoles.filter((role) => !(subCrewDraft.roleIds || []).includes(role.id))
                          : [{id: '__none__', name: 'All roles added'} as any]
                      }
                      onAction={(id) => {
                        const roleId = String(id || '');
                        if (roleId === '__none__') return;
                        const next = (subCrewDraft.roleIds || []).includes(roleId)
                          ? subCrewDraft.roleIds || []
                          : [...(subCrewDraft.roleIds || []), roleId];
                        setSubCrewDraft({...subCrewDraft, roleIds: next});
                      }}
                      css={{maxHeight: 320, overflowY: 'auto'}}
                    >
                      {(role: any) =>
                        String(role?.id || '') === '__none__' ? (
                          <Dropdown.Item key="__none__" textValue="All roles already added">
                            <Text size="$sm" css={{mb: 0, opacity: 0.7}}>All roles already added</Text>
                          </Dropdown.Item>
                        ) : (
                          <Dropdown.Item key={role.id} textValue={String(role.name || '')}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 999,
                                  background: roleColorHex(role.color),
                                  boxShadow: '0 0 0 1px var(--reblas-outline)',
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{fontSize: 14, lineHeight: 1.2}}>{String(role.name || role.id)}</span>
                            </div>
                          </Dropdown.Item>
                        )
                      }
                    </Dropdown.Menu>
                  </Dropdown>

                  <Text size="$sm" css={{opacity: 0.65, mb: 0}}>
                    {(subCrewDraft.roleIds || []).length ? `${subCrewDraft.roleIds.length} required role(s)` : 'All guild members will sync'}
                  </Text>
                </div>

                <Spacer y={0.6} />
                <div
                  style={{
                    border: '2px solid var(--reblas-outline)',
                    borderRadius: 14,
                    background: 'rgba(0,0,0,0.10)',
                    padding: 10,
                    minHeight: 56,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  {(subCrewDraft.roleIds || []).length === 0 ? (
                    <Text size="$sm" css={{opacity: 0.65}}>No role filter set</Text>
                  ) : (
                    (subCrewDraft.roleIds || []).map((id) => {
                      const role = subCrewRoleById.get(id);
                      return (
                        <div
                          key={`subcrew_role_${id}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: '2px solid var(--reblas-outline)',
                            background: 'rgba(0,0,0,0.25)',
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              background: roleColorHex(role?.color),
                              boxShadow: '0 0 0 1px var(--reblas-outline)',
                            }}
                          />
                          <span style={{fontWeight: 800}}>{role?.name || id}</span>
                          <Button
                            auto
                            className="reblas-btn-1"
                            css={{minWidth: 'auto', px: '$4', py: '$2', lineHeight: 1}}
                            onPress={() =>
                              setSubCrewDraft({
                                ...subCrewDraft,
                                roleIds: (subCrewDraft.roleIds || []).filter((roleId) => roleId !== id),
                              })
                            }
                          >
                            ✕
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>

              <div
                style={{
                  border: '2px solid var(--reblas-outline)',
                  borderRadius: 14,
                  background: 'rgba(0,0,0,0.10)',
                  padding: 10,
                  minHeight: 72,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  alignItems: 'flex-start',
                }}
              >
                <Text size="$sm" css={{opacity: 0.82}}>
                  Current synced members: {subCrewDraft.memberIds.length}
                </Text>
                <Text size="$sm" css={{opacity: 0.72}}>
                  After the bot joins the guild, the next sync will populate this crew automatically.
                </Text>
                <Text size="$xs" css={{opacity: 0.58}}>
                  Invite is locked to the shared Sub Guild ID in Setup using your configured Discord Client ID.
                </Text>
              </div>
            </Card>

            <Spacer y={0.8} />

            <Flex justify="between" css={{gap: '$8', flexWrap: 'wrap'}}>
              <Button className="reblas-btn-1" auto onPress={closeSubCrewModal}>
                Cancel
              </Button>
              <Button className="reblas-btn-2" auto onPress={saveSubCrew}>
                Save Sub Crew
              </Button>
            </Flex>
          </Card>
        </ModalShell>
      ) : null}

      {itemModalOpen && itemDraft ? (
        <ModalShell
          onClose={() => {
            setItemModalOpen(false);
            setItemDraft(null);
            setItemEditId('');
          }}
        >
          <Card css={{p: '$10', background: 'rgba(0,0,0,0.55)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
            <Text h3 css={{mb: '$6'}}>{itemEditId ? 'Edit Item' : 'Add Item'}</Text>
            <Flex direction="column" css={{gap: '$6'}}>
              <div style={{display: 'grid', gap: 6}}>
                <Text size="$sm" css={{opacity: 0.78}}>Image</Text>
                <div style={{display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap'}}>
                  {itemDraft.imageUrl ? (
                    <Avatar src={itemDraft.imageUrl} squared size="xl" css={{boxShadow: '0 0 0 2px var(--reblas-outline)'}} />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 14,
                        border: '2px solid var(--reblas-outline)',
                        display: 'grid',
                        placeItems: 'center',
                        opacity: 0.6,
                      }}
                    >
                      <Text size="$xs" css={{mb: 0}}>No Image</Text>
                    </div>
                  )}
                  <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
                    <input
                      ref={itemImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => void uploadItemImage(e.target.files?.[0])}
                      style={{display: 'none'}}
                    />
                    <Button className="reblas-btn-1" onPress={() => itemImageInputRef.current?.click()} disabled={itemImageBusy}>
                      {itemImageBusy ? 'Uploading…' : 'Upload Image'}
                    </Button>
                    {itemDraft.imageUrl ? (
                      <Button className="reblas-btn-3" onPress={() => setItemDraft({...itemDraft, imageUrl: ''})}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div style={{display: 'grid', gap: 6}}>
                <Text size="$sm" css={{opacity: 0.78}}>Category</Text>
                <select
                  value={itemDraft.category}
                  onChange={(e) =>
                    setItemDraft({
                      ...itemDraft,
                      category: e.target.value === 'mats' ? 'mats' : 'orders',
                      materials: e.target.value === 'mats' ? [] : itemDraft.materials,
                      dirtyWashRequirementWhole: e.target.value === 'mats' ? '' : itemDraft.dirtyWashRequirementWhole,
                      cleanCashWhole: e.target.value === 'mats' ? '' : itemDraft.cleanCashWhole,
                      dirtyCashWhole: e.target.value === 'mats' ? '' : itemDraft.dirtyCashWhole,
                    })
                  }
                  style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                >
                  <option value="mats">Mats</option>
                  <option value="orders">Orders</option>
                </select>
              </div>
              <Input
                label={itemDraft.category === 'mats' ? 'Mat Name' : 'Order Title'}
                fullWidth
                value={itemDraft.name}
                onChange={(e) => setItemDraft({...itemDraft, name: e.target.value})}
              />
              <Input
                label="Description"
                fullWidth
                value={itemDraft.description}
                onChange={(e) => setItemDraft({...itemDraft, description: e.target.value})}
              />
              {itemDraft.category === 'orders' ? (
                <>
                  <Input
                    label="Dirty Wash Log Requirement"
                    fullWidth
                    value={itemDraft.dirtyWashRequirementWhole}
                    onChange={(e) =>
                      setItemDraft({...itemDraft, dirtyWashRequirementWhole: String(e.target.value || '').replace(/[^0-9]/g, '')})
                    }
                  />
                  <Input
                    label="Clean Cash Amount"
                    fullWidth
                    value={itemDraft.cleanCashWhole}
                    onChange={(e) =>
                      setItemDraft({...itemDraft, cleanCashWhole: String(e.target.value || '').replace(/[^0-9]/g, '')})
                    }
                  />
                  <Input
                    label="Dirty Cash Amount"
                    fullWidth
                    value={itemDraft.dirtyCashWhole}
                    onChange={(e) =>
                      setItemDraft({...itemDraft, dirtyCashWhole: String(e.target.value || '').replace(/[^0-9]/g, '')})
                    }
                  />
                  <Card css={{...glassCardCss, p: '$6'}}>
                    <Text css={{fontWeight: 900, mb: '$4'}}>Required Mats</Text>
                    <div style={{display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 120px auto', gap: 10, alignItems: 'end'}}>
                      <select
                        value={pendingMatId}
                        onChange={(e) => setPendingMatId(e.target.value)}
                        style={{padding: 12, borderRadius: 12, border: '2px solid var(--reblas-outline)', background: 'rgba(0,0,0,0.2)', color: 'white'}}
                      >
                        <option value="">Select mat</option>
                        {availableMats.map((mat) => (
                          <option key={mat.id} value={mat.id}>
                            {mat.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        label="Qty"
                        fullWidth
                        value={pendingMatQty}
                        onChange={(e) => setPendingMatQty(String(e.target.value || '').replace(/[^0-9]/g, '') || '1')}
                      />
                      <Button className="reblas-btn-1" onPress={addMatRequirement} disabled={!pendingMatId}>
                        Add Mat
                      </Button>
                    </div>
                    <Spacer y={0.6} />
                    <div style={{display: 'grid', gap: 8}}>
                      {itemDraft.materials.length === 0 ? (
                        <Text size="$sm" css={{opacity: 0.72}}>No mats required yet.</Text>
                      ) : (
                        itemDraft.materials.map((entry) => (
                          <div
                            key={entry.matId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                              padding: '10px 12px',
                              borderRadius: 12,
                              border: '2px solid var(--reblas-outline)',
                              background: 'rgba(0,0,0,0.14)',
                            }}
                          >
                            <Text css={{mb: 0}}>
                              {matById.get(entry.matId)?.name || entry.matId} x{entry.quantity}
                            </Text>
                            <Button auto light className="reblas-btn-3" onPress={() => removeMatRequirement(entry.matId)}>
                              Remove
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </Card>
                </>
              ) : null}
              <Button
                className={itemDraft.active ? 'reblas-btn-2' : 'reblas-btn-3'}
                onPress={() => setItemDraft({...itemDraft, active: !itemDraft.active})}
              >
                {itemDraft.active ? 'Active' : 'Disabled'}
              </Button>
              <Button className="reblas-btn-2" onPress={() => void saveItem()}>
                Save
              </Button>
            </Flex>
          </Card>
        </ModalShell>
      ) : null}

      {itemView ? (
        <ModalShell onClose={() => setItemView(null)}>
          <Card css={{p: '$10', background: 'rgba(0,0,0,0.55)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
            <Flex direction="column" css={{gap: '$6'}}>
              <Flex justify="between" align="center" css={{gap: '$6', flexWrap: 'wrap'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 14, minWidth: 0}}>
                  {itemView.imageUrl ? (
                    <img
                      src={itemView.imageUrl}
                      alt={itemView.name}
                      style={{
                        width: 72,
                        height: 72,
                        minWidth: 72,
                        borderRadius: 14,
                        border: '2px solid var(--reblas-outline)',
                        objectFit: 'cover',
                        display: 'block',
                        background: 'rgba(0,0,0,0.16)',
                      }}
                    />
                  ) : null}
                  <div style={{minWidth: 0}}>
                    <Text h3 css={{mb: '$1'}}>{itemView.name}</Text>
                    <Text
                      size="$sm"
                      css={{
                        mb: 0,
                        color: itemView.active ? 'var(--reblas-btn2-color)' : 'var(--reblas-btn3-color)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      {itemView.active ? 'Active' : 'Disabled'}
                    </Text>
                  </div>
                </div>
                <Button auto light className="reblas-btn-1" onPress={() => setItemView(null)}>
                  Close
                </Button>
              </Flex>

              {itemView.description ? (
                <Text size="$sm" css={{mb: 0, opacity: 0.84}}>
                  {itemView.description}
                </Text>
              ) : null}

              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12}}>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '2px solid var(--reblas-outline)',
                    background: 'rgba(0,0,0,0.14)',
                  }}
                >
                  <Text size="$xs" css={{mb: 2, opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.08em'}}>
                    Wash Requirement
                  </Text>
                  <Text b size="$lg" css={{mb: 0, color: 'var(--reblas-btn3-color)'}}>
                    {formatWholeCents(itemView.dirtyWashRequirementCents)}
                  </Text>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '2px solid var(--reblas-outline)',
                    background: 'rgba(0,0,0,0.14)',
                  }}
                >
                  <Text size="$xs" css={{mb: 2, opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.08em'}}>
                    Clean Cost
                  </Text>
                  <Text b size="$lg" css={{mb: 0, color: 'var(--reblas-btn2-color)'}}>
                    {formatWholeCents(itemView.cleanCashCents)}
                  </Text>
                </div>
              </div>

              <div
                style={{
                  padding: '12px',
                  borderRadius: 14,
                  border: '2px solid var(--reblas-outline)',
                  background: 'rgba(0,0,0,0.14)',
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                <Text size="$xs" css={{mb: '$3', opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.08em'}}>
                  Mats Cost
                </Text>
                {(itemView.materials || []).length ? (
                  <div style={{display: 'grid', gap: 8}}>
                    {itemView.materials.map((entry) => {
                      const mat = matById.get(entry.matId);
                      return (
                        <div
                          key={`${itemView.id}_${entry.matId}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 10px',
                            borderRadius: 10,
                            border: '2px solid rgba(255,255,255,0.08)',
                            background: 'rgba(255,255,255,0.03)',
                          }}
                        >
                          {mat?.imageUrl ? (
                            <div
                              aria-label={mat?.name || entry.matId}
                              title={mat?.name || entry.matId}
                              style={{
                                width: 42,
                                height: 42,
                                minWidth: 42,
                                borderRadius: 8,
                                border: '2px solid var(--reblas-outline)',
                                background: `rgba(0,0,0,0.16) url("${mat.imageUrl}") center / cover no-repeat`,
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 42,
                                height: 42,
                                minWidth: 42,
                                borderRadius: 8,
                                border: '2px solid var(--reblas-outline)',
                                display: 'grid',
                                placeItems: 'center',
                                opacity: 0.6,
                                fontSize: 9,
                              }}
                            >
                              N/A
                            </div>
                          )}
                          <div style={{display: 'grid', gap: 2}}>
                            <Text b size="$sm" css={{mb: 0, color: 'var(--reblas-btn1-color)'}}>
                              {mat?.name || entry.matId}
                            </Text>
                            <Text size="$xs" css={{mb: 0, opacity: 0.74}}>
                              Qty: {entry.quantity}
                            </Text>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Text b css={{mb: 0, color: 'var(--reblas-btn1-color)'}}>None</Text>
                )}
              </div>
            </Flex>
          </Card>
        </ModalShell>
      ) : null}

      {/* Modal 1: enter new owner id */}
      {showTransfer ? (
        <ModalShell
          onClose={() => {
            setShowTransfer(false);
            setTransferErr('');
          }}
        >
          <Card css={{p: '$12', background: 'rgba(0,0,0,0.55)', border: '2px solid var(--reblas-outline)', backdropFilter: 'blur(16px)'}}>
            <Text h2 css={{mb: '$2'}}>Transfer Ownership</Text>
            <Text css={{opacity: 0.8, mb: '$10'}}>Enter the Discord User ID of the new Owner.</Text>

            {transferErr ? (
              <Card css={{p: '$8', mb: '$10', background: 'rgba(120,0,0,0.25)', border: '2px solid var(--reblas-outline)'}}>
                <Text size="$sm" css={{opacity: 0.95, fontWeight: 800}}>{transferErr}</Text>
              </Card>
            ) : null}

            <Input
              aria-label="Numbers only (e.g. 123456789012345678)"
              label="New Owner Discord ID"
              placeholder="Numbers only (e.g. 123456789012345678)"
              fullWidth
              value={newOwnerId}
              onChange={(e) => setNewOwnerId(e.target.value)}
              css={{mb: '$10'}}
            />

            <Flex justify="between" css={{gap: '$8', flexWrap: 'wrap'}}>
              <Button className="reblas-btn-1" flat onPress={() => { setShowTransfer(false); setTransferErr(''); }} css={{width: '48%'}}>
                Cancel
              </Button>
              <Button className="reblas-btn-3" onPress={continueToConfirm} css={{width: '48%'}}>
                Transfer…
              </Button>
            </Flex>
          </Card>
        </ModalShell>
      ) : null}

      {/* Modal 2: big warning + confirm phrase */}
      {showConfirm ? (
        <ModalShell onClose={() => { setShowConfirm(false); setTransferErr(''); setConfirmText(''); }}>
          <Card css={{p: '$12', background: 'rgba(0,0,0,0.62)', border: '2px solid rgba(255,60,60,0.60)', backdropFilter: 'blur(18px)'}}>
            <Text h1 css={{mb: '$6'}}>⚠️ FINAL WARNING</Text>

            <Text css={{opacity: 0.92, mb: '$6', fontWeight: 900}}>You are about to transfer Ownership to:</Text>

            <Card css={{p: '$8', mb: '$10', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,60,60,0.55)'}}>
              <Text css={{fontWeight: 900}}>New Owner Discord ID: <code>{newOwnerId.trim()}</code></Text>
            </Card>

            <Text css={{opacity: 0.9, mb: '$8'}}>
              After you confirm, you will <b>no longer</b> be the Owner and this <b>CANNOT</b> be undone.
            </Text>

            <Text css={{opacity: 0.9, mb: '$6', fontWeight: 900}}>Type this phrase to confirm:</Text>

            <Card css={{p: '$8', mb: '$6', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,60,60,0.55)'}}>
              <code>{CONFIRM_PHRASE}</code>
            </Card>

            {transferErr ? (
              <Card css={{p: '$8', mb: '$8', background: 'rgba(120,0,0,0.25)', border: '1px solid rgba(255,60,60,0.55)'}}>
                <Text size="$sm" css={{opacity: 0.95, fontWeight: 800}}>{transferErr}</Text>
              </Card>
            ) : null}

            <Input
              aria-label="Input"
              label="Confirmation phrase"
              placeholder={CONFIRM_PHRASE}
              fullWidth
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onPaste={blockClipboard}
              onCopy={blockClipboard}
              onCut={blockClipboard}
              onKeyDown={blockKeyCombos}
              onContextMenu={(e) => e.preventDefault()}
              css={{mb: '$10'}}
            />

            <Flex justify="between" css={{gap: '$8', flexWrap: 'wrap'}}>
              <Button className="reblas-btn-1" flat onPress={() => { setShowConfirm(false); setTransferErr(''); setConfirmText(''); }} css={{width: '48%'}}>
                Cancel
              </Button>

              <Button
                className="reblas-btn-3"
                disabled={transferBusy || confirmText.trim() !== CONFIRM_PHRASE}
                onPress={doTransfer}
                css={{
                  width: '48%',
                  border: '1px solid rgba(255,60,60,0.70)',
                  background: confirmText.trim() === CONFIRM_PHRASE ? 'rgba(255,60,60,0.28)' : 'rgba(0,0,0,0.20)',
                  opacity: confirmText.trim() === CONFIRM_PHRASE ? 1 : 0.6,
                }}
              >
                {transferBusy ? 'Transferring…' : 'CONFIRM TRANSFER'}
              </Button>
            </Flex>
          </Card>
        </ModalShell>
      ) : null}
    </Box>
  );
};

export default SettingsPage;
