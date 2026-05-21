import {Navbar, Tooltip, Avatar} from '@nextui-org/react';
import React from 'react';
import {Box} from '../styles/box';
import {BurguerButton} from './burguer-button';
import {UserDropdown} from './user-dropdown';
import {SettingsIcon} from '../icons/sidebar/settings-icon';
import {useRouter} from 'next/router';
import {useGuildSettings} from '../../lib/guild-settings';
import {useSession} from 'next-auth/react';
import {useOwnerPreviewMode} from '../../lib/client/owner-preview';

function splitTwoLines(name: string) {
  const clean = (name || '').trim();
  if (!clean) return ['Guild', 'Name'];
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return [parts[0], ''];
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')];
}

interface Props {
  children?: React.ReactNode;
}

export const NavbarWrapper = (_props: Props) => {
  const router = useRouter();
  const {settings} = useGuildSettings();
  const {data: session} = useSession();

  const name = settings.guildName?.trim() || 'Guild Name';
  const [line1, line2] = splitTwoLines(name);
  const avatarSrc = settings.guildAvatar?.trim() || undefined;
  const myId = String((session as any)?.discordId || '').trim();
  const {canManageSettings} = useOwnerPreviewMode(settings, myId);

  return (
    <Box css={{width: '100%'}}>
      <Navbar
        isBordered
        css={{
          width: '100%',
          height: 'var(--reblas-nav-h)',
          minHeight: 'var(--reblas-nav-h)',

          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
          borderBottom: '1px solid var(--reblas-outline)',

          '& .nextui-navbar-container': {
            border: 'none',
            background: 'transparent',
            maxWidth: '100%',
            height: 'var(--reblas-nav-h)',
            minHeight: 'var(--reblas-nav-h)',
            alignItems: 'center',
          },
        }}
      >
        <Navbar.Content css={{gap: '$8', alignItems: 'center'}}>
          <Navbar.Content showIn="md">
            <BurguerButton />
          </Navbar.Content>

          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <Avatar
              squared
              size="lg"
              src={avatarSrc}
              text={name ? name[0].toUpperCase() : 'G'}
            />
            <div style={{display: 'flex', flexDirection: 'column', lineHeight: 1.05}}>
              <div style={{fontWeight: 900, fontSize: 20}}>{line1}</div>
              {line2 ? <div style={{fontWeight: 900, fontSize: 20}}>{line2}</div> : null}
            </div>
          </div>
        </Navbar.Content>

        <Navbar.Content css={{gap: '$8', alignItems: 'center'}}>
          {canManageSettings ? (
            <Tooltip content={'Settings'} rounded color="primary">
              <button
                type="button"
                onClick={() => router.push('/settings')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
                aria-label="Open settings"
              >
                <SettingsIcon />
              </button>
            </Tooltip>
          ) : null}

          <UserDropdown />
        </Navbar.Content>
      </Navbar>
    </Box>
  );
};
