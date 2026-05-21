import {Avatar, Button, Dropdown, Input, Modal, Navbar, Spacer, Text} from '@nextui-org/react';
import React, {useEffect, useState} from 'react';
import {signIn, signOut, useSession} from 'next-auth/react';
import {debounceAsync, fetchJsonCached, invalidateJsonCache} from '../../lib/client/request-cache';

const RING_BLUE = '#3b82f6';

function withDiscordSize(url: string) {
  const u = (url || '').trim();
  if (!u) return '';
  if (u.includes('cdn.discordapp.com') && !u.includes('size=')) {
    return u + (u.includes('?') ? '&' : '?') + 'size=128';
  }
  return u;
}

const PROFILE_URL = '/api/profile/me';

export const UserDropdown = () => {
  const {data: session, status} = useSession();

  const label = String(session?.user?.name || session?.user?.email || 'Discord User');
  const avatarSrc = withDiscordSize(String(session?.user?.image || ''));

  const SIZE = 34;

  const [profileOpen, setProfileOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [mobileNumber, setMobileNumber] = useState('');
  const [ibanAccount, setIbanAccount] = useState('');

  const loadProfile = async () => {
    setErr('');
    setLoading(true);
    try {
      const j = await fetchJsonCached<any>(PROFILE_URL, 30000);
      setMobileNumber(String(j?.mobileNumber || ''));
      setIbanAccount(String(j?.ibanAccount || ''));
    } catch (e: any) {
      setErr(e?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    setErr('');
    setSaving(true);
    try {
      const res = await fetch('/api/profile/me', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({mobileNumber, ibanAccount}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to save profile (${res.status})`);
      invalidateJsonCache(PROFILE_URL);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('reblas-profile-updated'));
      }
      setProfileOpen(false);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (profileOpen) void debounceAsync('user-profile-modal-open', 120, loadProfile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileOpen]);

  if (status !== 'authenticated') {
    return (
      <Button auto className="reblas-btn-1" onPress={() => signIn('discord')}>
        Sign In
      </Button>
    );
  }

  return (
    <>
      <Dropdown placement="bottom-right">
        <Navbar.Item>
          <Dropdown.Trigger>
            <button
              type="button"
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                borderRadius: 9999,
                width: SIZE,
                height: SIZE,
                boxShadow: `0 0 0 2px ${RING_BLUE}`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                lineHeight: 0,
              }}
              aria-label="Open user menu"
            >
              <Avatar
                bordered={false}
                src={avatarSrc || undefined}
                text={label ? label[0].toUpperCase() : 'U'}
                css={{
                  width: `${SIZE}px`,
                  height: `${SIZE}px`,
                  minWidth: `${SIZE}px`,
                  minHeight: `${SIZE}px`,
                  borderRadius: '9999px',
                  overflow: 'hidden',
                }}
              />
            </button>
          </Dropdown.Trigger>
        </Navbar.Item>

        <Dropdown.Menu
          aria-label="User menu"
          onAction={(key) => {
            if (key === 'my_settings') setProfileOpen(true);
            if (key === 'sign_out') signOut();
          }}
        >
          <Dropdown.Item key="profile" css={{height: '$18'}}>
            <Text b color="inherit" css={{d: 'flex'}}>
              Signed in as
            </Text>
            <Text b color="inherit" css={{d: 'flex'}}>
              {label}
            </Text>
          </Dropdown.Item>

          <Dropdown.Item key="my_settings" withDivider>
            My Settings
          </Dropdown.Item>

          <Dropdown.Item key="sign_out" withDivider color="error">
            Sign out
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <Modal
        closeButton
        blur
        aria-label="My Settings"
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        width="520px"
      >
        <Modal.Header>
          <Text b>My Settings</Text>
        </Modal.Header>

        <Modal.Body>
          {err ? (
            <CardError message={err} />
          ) : null}

          <Input
            aria-label="Mobile number"
            label="Mobile Number"
            placeholder="e.g. 04xx xxx xxx"
            fullWidth
            disabled={loading || saving}
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
          />

          <Input
            aria-label="IBAN account"
            label="IBAN Account"
            placeholder="e.g. DE89 3704 0044 0532 0130 00"
            fullWidth
            disabled={loading || saving}
            value={ibanAccount}
            onChange={(e) => setIbanAccount(e.target.value)}
          />

          <Text size="$xs" css={{opacity: 0.7}}>
            These details are only stored in your dashboard and shown on the Members page.
          </Text>
        </Modal.Body>

        <Modal.Footer>
          <Button flat auto onPress={() => setProfileOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button className="reblas-btn-2" auto onPress={saveProfile} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

function CardError({message}: {message: string}) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: '2px solid var(--reblas-outline)',
        background: 'rgba(120,0,0,0.20)',
      }}
    >
      <Text b css={{mb: 0}}>Error</Text>
      <Spacer y={0.2} />
      <Text size="$sm" css={{opacity: 0.9, mb: 0}}>
        {message}
      </Text>
    </div>
  );
}
