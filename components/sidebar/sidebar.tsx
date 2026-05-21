import React, {useEffect, useMemo, useState} from 'react';
import {Avatar, Text} from '@nextui-org/react';
import {Box} from '../styles/box';
import {Sidebar} from './sidebar.styles';
import {Flex} from '../styles/flex';
import {PaymentsIcon} from '../icons/sidebar/payments-icon';
import {AccountsIcon} from '../icons/sidebar/accounts-icon';
import {CalculatorIcon} from '../icons/sidebar/calculator-icon';
import {CustomersIcon} from '../icons/sidebar/customers-icon';
import {SidebarItem} from './sidebar-item';
import {SidebarMenu} from './sidebar-menu';
import {useSidebarContext} from '../layout/layout-context';
import {useRouter} from 'next/router';
import {fetchJsonCached} from '../../lib/client/request-cache';
import {useGuildSettings} from '../../lib/guild-settings';
import {useSession} from 'next-auth/react';
import {ProductsIcon} from '../icons/sidebar/products-icon';
import {useOwnerPreviewMode} from '../../lib/client/owner-preview';

type Member = {
  id: string;
  username?: string;
  globalName?: string;
  nick?: string;
  displayName?: string;
  avatarUrl?: string;
  isPrevMonthTopDirty?: boolean;
};

function displayNameOf(m?: Member | null) {
  if (!m) return 'Member name';
  return String(m.displayName || m.nick || m.globalName || m.username || m.id || 'Member name');
}

function hexToRgba(hex: string, alpha: number) {
  const s = String(hex || '').trim().replace('#', '');
  if (![3, 4, 6, 8].includes(s.length)) return `rgba(59,130,246,${alpha})`;

  const full =
    s.length === 3 || s.length === 4
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexToRgb(hex: string) {
  const s = String(hex || '').trim().replace('#', '');
  const full =
    s.length === 3 || s.length === 4
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  if (!/^[0-9a-fA-F]{6,8}$/.test(full)) return {r: 59, g: 130, b: 246};
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function starTileData(hex: string, alpha: number, variant: 1 | 2 | 3) {
  const {r, g, b} = hexToRgb(hex);
  const fill = `rgba(${r},${g},${b},${alpha})`;
  const fillSoft = `rgba(${r},${g},${b},${Math.max(0.08, alpha * 0.6)})`;
  const tiles: Record<1 | 2 | 3, string> = {
    1: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 140'>
      <g fill='${fill}'>
        <polygon points='12,6 15,14 24,14 17,19 20,28 12,22 4,28 7,19 0,14 9,14'/>
        <polygon points='88,12 90,18 96,18 91,22 93,28 88,24 83,28 85,22 80,18 86,18'/>
        <polygon points='58,72 61,80 70,80 63,85 66,94 58,88 50,94 53,85 46,80 55,80'/>
        <polygon points='120,84 124,94 134,94 126,100 129,110 120,103 111,110 114,100 106,94 116,94'/>
      </g>
    </svg>`,
    2: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'>
      <g fill='${fillSoft}'>
        <polygon points='18,16 20,22 27,22 21,26 24,33 18,29 12,33 15,26 9,22 16,22'/>
        <polygon points='76,30 79,38 88,38 81,43 84,52 76,46 68,52 71,43 64,38 73,38'/>
        <polygon points='132,44 134,50 141,50 135,54 138,61 132,57 126,61 129,54 123,50 130,50'/>
        <polygon points='46,112 50,122 60,122 52,128 55,138 46,131 37,138 40,128 32,122 42,122'/>
        <polygon points='118,118 122,128 132,128 124,134 127,144 118,137 109,144 112,134 104,128 114,128'/>
      </g>
    </svg>`,
    3: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'>
      <g fill='${fill}'>
        <polygon points='24,20 28,30 38,30 30,36 33,46 24,39 15,46 18,36 10,30 20,30'/>
        <polygon points='96,18 99,26 107,26 101,31 103,39 96,34 89,39 91,31 85,26 93,26'/>
        <polygon points='148,66 152,76 162,76 154,82 157,92 148,85 139,92 142,82 134,76 144,76'/>
        <polygon points='70,94 73,102 82,102 75,107 78,116 70,110 62,116 65,107 58,102 67,102'/>
        <polygon points='28,140 31,148 40,148 33,153 36,162 28,156 20,162 23,153 16,148 25,148'/>
      </g>
    </svg>`,
  };
  return `url("data:image/svg+xml,${encodeURIComponent(tiles[variant])}")`;
}

export const SidebarWrapper = () => {
  const router = useRouter();
  const {collapsed, setCollapsed} = useSidebarContext();
  const [memberOfMonth, setMemberOfMonth] = useState<Member | null>(null);
  const {settings} = useGuildSettings();
  const {data: session, status} = useSession();
  const viewerRole = settings.viewerRole || 'main';
  const accessMode = settings.dashboardAccessMode || 'none';
  const isSubCrew = accessMode === 'subcrew' || viewerRole === 'subcrew';
  const myId = String((session as any)?.discordId || '').trim();
  const {isPrimaryOwner, actualCanManageSettings} = useOwnerPreviewMode(settings, myId);
  const isJobTrackingViewOnly = accessMode === 'job_tracking_only';

  const memberName = useMemo(() => displayNameOf(memberOfMonth), [memberOfMonth]);
  const momTheme = useMemo(
    () => ({
      glowColor: settings.memberOfMonthGlowColor || '#3b82f6',
      avatarRingColor: settings.memberOfMonthAvatarRingColor || '#3b82f6',
      sparkleColor: settings.memberOfMonthSparkleColor || '#3b82f6',
      textColor: settings.memberOfMonthTextColor || '#fbbf24',
    }),
    [
      settings.memberOfMonthGlowColor,
      settings.memberOfMonthAvatarRingColor,
      settings.memberOfMonthSparkleColor,
      settings.memberOfMonthTextColor,
    ]
  );

  useEffect(() => {
    if (accessMode !== 'owner' && accessMode !== 'main') {
      setMemberOfMonth(null);
      return;
    }
    const load = async () => {
      try {
        const payload = await fetchJsonCached<any>('/api/members/member-of-month', 30000);
        const top = payload?.member || null;
        setMemberOfMonth(top as Member | null);
      } catch {
        setMemberOfMonth(null);
      }
    };
    void load();
  }, [accessMode]);

  return (
    <Box
      as="aside"
      css={{
        height: '100%',
        zIndex: 202,
        position: 'relative',
        top: 'auto',
      }}
    >
      {collapsed ? <Sidebar.Overlay onClick={setCollapsed} /> : null}

      <Sidebar collapsed={collapsed}>
        <Sidebar.Header>
          {/* Guild header moved to the TOP NAVBAR */}
          <div style={{height: 10}} />
        </Sidebar.Header>

        <Flex direction={'column'} justify={'between'} css={{height: '100%'}}>
          <Sidebar.Body className="body sidebar">
            <SidebarMenu title="Main Menu">
              {accessMode === 'none' ? null : isJobTrackingViewOnly ? null : accessMode === 'subcrew' ? (
                <>
                  <SidebarItem
                    isActive={router.pathname === '/crews'}
                    title="Crews"
                    icon={<CustomersIcon />}
                    href="/crews"
                  />
                </>
              ) : (
                <>
                  <SidebarItem
                    isActive={router.pathname === '/members'}
                    title="Members"
                    icon={<AccountsIcon />}
                    href="/members"
                  />
                  {!isSubCrew ? (
                    <SidebarItem
                      isActive={router.pathname === '/scav-hunt-tracker'}
                      title="Scav Hunt Tracker"
                      icon={<PaymentsIcon />}
                      href="/scav-hunt-tracker"
                    />
                  ) : null}
                  {!isSubCrew ? (
                    <SidebarItem
                      isActive={router.pathname === '/wash-calculator'}
                      title="Wash Calculator"
                      icon={<CalculatorIcon />}
                      href="/wash-calculator"
                    />
                  ) : null}
                  <SidebarItem
                    isActive={router.pathname === '/washtracker'}
                    title="Wash Tracker"
                    icon={<PaymentsIcon />}
                    href="/washtracker"
                  />
                  {!isSubCrew && settings.weeklysTrackerAccess ? (
                    <SidebarItem
                      isActive={router.pathname === '/weeklys-tracker'}
                      title="Weeklys Tracker"
                      icon={<PaymentsIcon />}
                      href="/weeklys-tracker"
                    />
                  ) : null}
                  {!isSubCrew && isPrimaryOwner ? (
                    <SidebarItem
                      isActive={router.pathname === '/order-management'}
                      title="Order Management"
                      icon={<ProductsIcon />}
                      href="/order-management"
                    />
                  ) : null}
                  <SidebarItem
                    isActive={router.pathname === '/crews'}
                    title="Crews"
                    icon={<CustomersIcon />}
                    href="/crews"
                  />
                </>
              )}
            </SidebarMenu>
          </Sidebar.Body>

          {accessMode === 'owner' || accessMode === 'main' ? (
            <div style={{padding: '0 12px 12px'}}>
              <CardMemberOfMonth name={memberName} avatarUrl={memberOfMonth?.avatarUrl} theme={momTheme} />
            </div>
          ) : null}
        </Flex>
      </Sidebar>
    </Box>
  );
};

function CardMemberOfMonth({
  name,
  avatarUrl,
  theme,
}: {
  name: string;
  avatarUrl?: string;
  theme: {
    glowColor: string;
    avatarRingColor: string;
    sparkleColor: string;
    textColor: string;
  };
}) {
  const safeName = String(name || 'Member name').toUpperCase();
  return (
    <>
      <div
        className="mom-card"
        style={{
          border: '2px solid var(--reblas-outline)',
          borderRadius: 14,
          background:
            `radial-gradient(circle at 15% 18%, ${hexToRgba(theme.glowColor, 0.12)} 0, ${hexToRgba(
              theme.glowColor,
              0.03
            )} 26%, transparent 45%), rgba(0,0,0,0.28)`,
          backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
          padding: 16,
          minHeight: 260,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          boxShadow: `inset 0 0 28px ${hexToRgba(theme.glowColor, 0.1)}, 0 0 16px ${hexToRgba(theme.glowColor, 0.08)}`,
        }}
      >
        <div className="mom-spark mom-spark-a" />
        <div className="mom-spark mom-spark-b" />
        <div className="mom-spark mom-spark-c" />

        <Text
          b
          css={{
            mb: 14,
            textAlign: 'center',
            fontSize: 14,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: theme.textColor,
          }}
        >
          MEMBER OF THE MONTH
        </Text>

        <div style={{display: 'flex', justifyContent: 'center', marginBottom: 14}}>
          <Avatar
            src={avatarUrl || undefined}
            text={safeName ? safeName[0] : 'M'}
            size="xl"
            css={{
              boxShadow: `0 0 0 1px ${hexToRgba(theme.avatarRingColor, 0.72)}, 0 0 18px ${hexToRgba(
                theme.avatarRingColor,
                0.22
              )}`,
              width: 112,
              height: 112,
              minWidth: 112,
              minHeight: 112,
            }}
          />
        </div>

        <Text
          b
          css={{
            mb: 0,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            width: '100%',
            textTransform: 'uppercase',
            color: theme.textColor,
            letterSpacing: '0.06em',
          }}
        >
          {safeName}
        </Text>
      </div>

      <style jsx>{`
        .mom-spark {
          position: absolute;
          inset: -20%;
          pointer-events: none;
          opacity: 0.38;
          background-repeat: repeat;
          filter: none;
          mix-blend-mode: screen;
          will-change: transform, opacity;
          transform: translate3d(0, 0, 0);
        }
        .mom-spark-a {
          background-image: ${starTileData(theme.sparkleColor, 0.95, 1)};
          background-size: 66px 66px;
          animation: momTwinkleA 8s ease-in-out infinite, momGlideA 42s linear infinite;
        }
        .mom-spark-b {
          background-image: ${starTileData(theme.sparkleColor, 0.8, 2)};
          background-size: 78px 78px;
          animation: momTwinkleB 10s ease-in-out infinite, momGlideB 56s linear infinite;
        }
        .mom-spark-c {
          background-image: ${starTileData(theme.sparkleColor, 0.72, 3)};
          background-size: 94px 94px;
          animation: momTwinkleC 12s ease-in-out infinite, momGlideC 72s linear infinite;
        }
        :global(:root[data-reblas-motion='lite']) .mom-spark-c {
          display: none;
        }
        :global(:root[data-reblas-motion='lite']) .mom-spark-a {
          animation-duration: 12s, 56s;
        }
        :global(:root[data-reblas-motion='lite']) .mom-spark-b {
          animation-duration: 14s, 72s;
        }
        :global(:root[data-reblas-motion='reduced']) .mom-spark {
          animation: none !important;
          transform: none !important;
        }
        @keyframes momTwinkleA {
          0%, 100% {opacity: 0.34;}
          50% {opacity: 0.52;}
        }
        @keyframes momTwinkleB {
          0%, 100% {opacity: 0.3;}
          50% {opacity: 0.46;}
        }
        @keyframes momTwinkleC {
          0%, 100% {opacity: 0.26;}
          50% {opacity: 0.4;}
        }
        @keyframes momGlideA {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(66px, 66px, 0);
          }
        }
        @keyframes momGlideB {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-78px, 78px, 0);
          }
        }
        @keyframes momGlideC {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(94px, -94px, 0);
          }
        }
      `}</style>
    </>
  );
}
