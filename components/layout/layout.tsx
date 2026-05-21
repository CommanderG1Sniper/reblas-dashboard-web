import React, {useEffect} from 'react';
import dynamic from 'next/dynamic';
import {useRouter} from 'next/router';
import {useSession} from 'next-auth/react';
import {Button, Modal, Text} from '@nextui-org/react';
import {useLockedBody} from '../hooks/useBodyLock';
import {NavbarWrapper} from '../navbar/navbar';
import {SidebarWrapper} from '../sidebar/sidebar';
import {SidebarContext} from './layout-context';
import {WrapperLayout} from './layout.styles';
import {useGuildSettings} from '../../lib/guild-settings';
import {Box} from '../styles/box';
import {fetchJsonCached} from '../../lib/client/request-cache';
import {useOwnerPreviewMode} from '../../lib/client/owner-preview';
import {buildOwnerPreviewHeaders} from '../../lib/owner-preview';

const SetupGate = dynamic(() => import('../setup/setup-gate').then((m) => m.SetupGate), {ssr: false});
const AuthGate = dynamic(() => import('../auth/auth-gate').then((m) => m.AuthGate), {ssr: false});

interface Props {
  children: React.ReactNode;
}

type MotionLevel = 'full' | 'lite' | 'reduced';

export const Layout = ({children}: Props) => {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [_, setLocked] = useLockedBody(false);
  const {settings, loading: settingsLoading} = useGuildSettings();
  const {data: session, status} = useSession();
  const warmupDoneRef = React.useRef(false);
  const [motionLevel, setMotionLevel] = React.useState<MotionLevel>('full');
  const [reminderOpen, setReminderOpen] = React.useState(false);
  const [reminderClean, setReminderClean] = React.useState(0);
  const [reminderDirty, setReminderDirty] = React.useState(0);
  const [reminderSeenKey, setReminderSeenKey] = React.useState('');

  const handleToggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
    setLocked(!sidebarOpen);
  };

  const ownerId = String(settings.ownerDiscordId || '').trim();
  const myId = String((session as any)?.discordId || '').trim();
  const {previewMemberMode, previewMemberId, actualCanManageSettings, stopPreviewMode} = useOwnerPreviewMode(settings, myId);
  const bg = (settings.dashboardBackground || '').trim();
  const NAV_H = '78px';
  const viewerRole = settings.viewerRole || 'main';
  const accessMode = settings.dashboardAccessMode || 'none';
  const publicAnonymousJobTracking = router.pathname === '/job-tracking' && status !== 'authenticated';
  const outline = (settings.viewerOutlineColor || settings.outlineColor || '#ffffff14').trim();
  const accessRedirectTarget =
    accessMode === 'subcrew'
      ? router.pathname === '/crews' || router.pathname === '/job-tracking'
        ? ''
        : '/crews'
      : accessMode === 'job_tracking_only'
        ? router.pathname === '/job-tracking'
          ? ''
          : '/job-tracking'
        : '';
  const noDashboardAccess = accessMode === 'none' && !publicAnonymousJobTracking;
  const weeklysBlocked = router.pathname === '/weeklys-tracker' && !settings.weeklysTrackerAccess;

  // IMPORTANT: NextUI Modal renders in a portal under <body>, so it won't inherit CSS vars
  // from WrapperLayout. Set them on <html> too so modals match the outline color.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--reblas-outline', outline);
    root.style.setProperty('--nextui-colors-border', 'var(--reblas-outline)');

    root.style.setProperty('--reblas-btn1-color', (settings.buttonStyles?.[0]?.color || '#3b82f6'));
    root.style.setProperty('--reblas-btn2-color', (settings.buttonStyles?.[1]?.color || '#22c55e'));
    root.style.setProperty('--reblas-btn3-color', (settings.buttonStyles?.[2]?.color || '#ef4444'));
    root.style.setProperty('--reblas-btn4-color', (settings.buttonStyles?.[3]?.color || '#f59e0b'));
    root.style.setProperty('--reblas-text-primary', '#ffffff');
    root.style.setProperty('--reblas-text-muted', 'rgba(255,255,255,0.96)');
    root.style.setProperty('--reblas-surface-soft', 'rgba(255,255,255,0.04)');
    root.style.setProperty('--reblas-surface-card', 'rgba(0,0,0,0.14)');
    root.style.setProperty('--reblas-surface-strong', 'rgba(0,0,0,0.26)');
    root.style.setProperty('--reblas-page-overlay', 'rgba(0,0,0,0.22)');
    root.style.setProperty('--reblas-button-bg', 'rgba(0,0,0,0.35)');
    root.style.setProperty('--reblas-button-hover-bg', 'rgba(0,0,0,0.5)');
    root.style.setProperty('--reblas-table-odd', 'rgba(255,255,255,0.035)');
    root.style.setProperty('--reblas-table-even', 'rgba(255,255,255,0.015)');
    root.style.setProperty('--reblas-table-hover', 'rgba(255,255,255,0.06)');
    root.style.setProperty('--reblas-native-bg', 'rgba(0,0,0,0.28)');
    root.style.setProperty('--reblas-native-text', '#ffffff');
    root.style.setProperty('--reblas-native-border', 'rgba(255,255,255,0.22)');
    root.style.setProperty('--reblas-native-option-bg', '#0b0b0b');
    root.style.setProperty('--reblas-native-option-text', '#ffffff');
    root.style.colorScheme = 'dark';
  }, [outline, settings.buttonStyles]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const root = document.documentElement;
    const nav = window.navigator as Navigator & {
      connection?: {saveData?: boolean};
      mozConnection?: {saveData?: boolean};
      webkitConnection?: {saveData?: boolean};
      deviceMemory?: number;
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');

    const applyMotionProfile = () => {
      const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
      const prefersReduced = media.matches;
      const saveData = !!connection?.saveData;
      const lowCpu = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
      const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
      const compactViewport = window.innerWidth < 900;

      const nextLevel: MotionLevel = prefersReduced
        ? 'reduced'
        : saveData || lowCpu || lowMemory || compactViewport
          ? 'lite'
          : 'full';

      setMotionLevel((current) => (current === nextLevel ? current : nextLevel));
      root.dataset.reblasMotion = nextLevel;
      root.style.setProperty('--reblas-panel-blur', nextLevel === 'full' ? '16px' : nextLevel === 'lite' ? '10px' : '0px');
      root.style.setProperty('--reblas-soft-blur', nextLevel === 'full' ? '14px' : nextLevel === 'lite' ? '8px' : '0px');
    };

    applyMotionProfile();
    const onChange = () => applyMotionProfile();
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
    else media.addListener(onChange);
    window.addEventListener('resize', onChange, {passive: true});

    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange);
      else media.removeListener(onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: {timeout: number}) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const warm = () => {
      void import('../auth/auth-gate');
      void import('../setup/setup-gate');
    };

    const idleId =
      typeof win.requestIdleCallback === 'function' ? win.requestIdleCallback(warm, {timeout: 1500}) : null;
    const timeoutId = idleId === null ? window.setTimeout(warm, 350) : null;

    return () => {
      if (idleId !== null && typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(idleId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (settingsLoading) return;
    if (!ownerId) return;
    if (accessMode !== 'owner' && accessMode !== 'main') return;
    if (warmupDoneRef.current) return;
    warmupDoneRef.current = true;

    void Promise.allSettled([
      fetchJsonCached('/api/settings', 30000),
      fetchJsonCached('/api/profile/me', 30000),
      fetchJsonCached('/api/members/list', 30000),
      fetchJsonCached('/api/members/member-of-month', 30000),
    ]);
  }, [accessMode, ownerId, settingsLoading, status]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (settingsLoading) return;
    if (!accessRedirectTarget) return;
    router.replace(accessRedirectTarget);
  }, [accessRedirectTarget, router, settingsLoading, status]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (settingsLoading) return;
    if (!weeklysBlocked) return;
    router.replace('/members');
  }, [router, settingsLoading, status, weeklysBlocked]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (settingsLoading || !ownerId) return;
    if (accessMode !== 'owner' && accessMode !== 'main') return;
    const myId = String((session as any)?.discordId || '').trim();
    if (!/^\d{6,25}$/.test(myId)) return;

    const loginKey = `reblas_outstanding_reminder_seen:${myId}`;
    setReminderSeenKey(loginKey);
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(loginKey) === '1') return;

    let cancelled = false;
    const headers = buildOwnerPreviewHeaders(previewMemberMode, previewMemberId);
    void fetch('/api/weeklys/outstanding-me', {headers})
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((payload as any)?.error || `Failed to load outstanding weeklys (${res.status})`);
        if (cancelled) return;
        const clean = Number(payload?.cleanOutstandingCents || 0) || 0;
        const dirty = Number(payload?.dirtyOutstandingCents || 0) || 0;
        const hasOutstanding = clean > 0 || dirty > 0;
        if (typeof window !== 'undefined') window.sessionStorage.setItem(loginKey, '1');
        if (!hasOutstanding) return;
        setReminderClean(clean);
        setReminderDirty(dirty);
        setReminderOpen(true);
      })
      .catch(() => {
        if (typeof window !== 'undefined') window.sessionStorage.setItem(loginKey, '1');
      });

    return () => {
      cancelled = true;
    };
  }, [accessMode, ownerId, previewMemberId, previewMemberMode, session, settingsLoading, status]);

  function formatCentsWhole(cents: number) {
    const n = Number(cents || 0) / 100;
    try {
      return n.toLocaleString(undefined, {style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0});
    } catch {
      return `$${n.toFixed(0)}`;
    }
  }

  const closeReminder = React.useCallback(() => {
    if (typeof window !== 'undefined' && reminderSeenKey) {
      window.sessionStorage.setItem(reminderSeenKey, '1');
    }
    setReminderOpen(false);
  }, [reminderSeenKey]);


  return (
    <SidebarContext.Provider
      value={{
        collapsed: sidebarOpen,
        setCollapsed: handleToggleSidebar,
      }}
    >
      <WrapperLayout
      
        css={{
          '--reblas-nav-h': NAV_H,
          '--reblas-outline': outline,
          '--nextui-colors-border': 'var(--reblas-outline)',

          '--reblas-btn1-color': (settings.buttonStyles?.[0]?.color || '#3b82f6'),
          '--reblas-btn2-color': (settings.buttonStyles?.[1]?.color || '#22c55e'),
          '--reblas-btn3-color': (settings.buttonStyles?.[2]?.color || '#ef4444'),
          '--reblas-btn4-color': (settings.buttonStyles?.[3]?.color || '#f59e0b'),

          color: 'var(--reblas-text-primary)',

          position: 'relative',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',

          backgroundImage: bg ? `url("${bg}")` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: motionLevel === 'full' ? 'fixed' : 'scroll',

          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background: 'var(--reblas-page-overlay)',
            pointerEvents: 'none',
            zIndex: 0,
          },

          '& > *': {position: 'relative', zIndex: 1},
        }}
      >
        {!settingsLoading && !ownerId ? <SetupGate /> : null}
        {!settingsLoading && ownerId && !publicAnonymousJobTracking ? <AuthGate /> : null}
        {actualCanManageSettings && previewMemberMode ? (
          <Box
            css={{
              px: '$8',
              py: '$4',
              background: 'rgba(120, 70, 0, 0.32)',
              borderBottom: '1px solid var(--reblas-outline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '$6',
            }}
          >
            <Text size="$sm" css={{mb: 0, fontWeight: 700}}>
              Viewing the dashboard as member `{previewMemberId}`. Owner and co-owner UI is hidden for testing.
            </Text>
            <Button auto className="reblas-btn-2" onPress={() => void stopPreviewMode()}>
              Exit Member View
            </Button>
          </Box>
        ) : null}
        <NavbarWrapper />

        <Box
          css={{
            display: 'flex',
            flex: '1 1 auto',
            height: 'calc(100vh - var(--reblas-nav-h))',
            overflow: 'hidden',
          }}
        >
          <SidebarWrapper />

          <Box as="main" css={{flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden'}}>
            {noDashboardAccess ? (
              <Box css={{p: '$10'}}>
                <Text b css={{mb: '$2'}}>No Dashboard Access</Text>
                <Text size="$sm" css={{mb: 0, opacity: 0.72}}>
                  This account is not in the main guild and does not have approved dashboard access.
                </Text>
              </Box>
            ) : accessRedirectTarget || weeklysBlocked ? null : children}
          </Box>
        </Box>
        <Modal
          closeButton
          blur
          aria-label="Outstanding weeklys reminder"
          open={reminderOpen}
          onClose={closeReminder}
          width="560px"
          css={{
            background: 'rgba(0,0,0,0.22)',
            border: '2px solid var(--reblas-outline)',
            backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
            borderRadius: 14,
          }}
        >
          <Modal.Header>
            <Text
              b
              css={{
                mb: 0,
                color: 'var(--reblas-btn3-color)',
                fontSize: '$3xl',
                lineHeight: 1.1,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              REMINDER
            </Text>
          </Modal.Header>
          <Modal.Body>
            <Text
              size="$lg"
              css={{
                mb: '$4',
                textAlign: 'center',
                fontWeight: 700,
              }}
            >
              You currently have outstanding weeklys.
            </Text>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 14,
                alignItems: 'start',
              }}
            >
              <div style={{textAlign: 'left'}}>
                <Text
                  size="$sm"
                  css={{
                    mb: '$2',
                    opacity: 0.85,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    fontSize: '$lg',
                  }}
                >
                  Clean Outstanding
                </Text>
                <Text b css={{mb: 0, color: 'var(--reblas-btn2-color)', fontSize: '$2xl'}}>
                  {formatCentsWhole(reminderClean)}
                </Text>
              </div>
              <div style={{textAlign: 'right'}}>
                <Text
                  size="$sm"
                  css={{
                    mb: '$2',
                    opacity: 0.85,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    fontSize: '$lg',
                  }}
                >
                  Dirty Outstanding
                </Text>
                <Text b css={{mb: 0, color: 'var(--reblas-btn4-color)', fontSize: '$2xl'}}>
                  {formatCentsWhole(reminderDirty)}
                </Text>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button className="reblas-btn-1" auto onPress={closeReminder}>
              Close
            </Button>
          </Modal.Footer>
        </Modal>
      </WrapperLayout>
    </SidebarContext.Provider>
  );
};
