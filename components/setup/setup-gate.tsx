import React, {useEffect, useMemo, useState} from 'react';
import {Button, Card, Input, Text, Spacer} from '@nextui-org/react';
import {signIn, useSession} from 'next-auth/react';
import {useGuildSettings} from '../../lib/guild-settings';
import {debounceAsync, fetchJsonCached, invalidateJsonCache} from '../../lib/client/request-cache';

const SETUP_STATUS_URL = '/api/setup/status';

export const SetupGate = () => {
  const {data: session, status} = useSession();
  const {refresh} = useGuildSettings();

  const [checking, setChecking] = useState(true);
  const [ownerSet, setOwnerSet] = useState(false);
  const [discordConfigured, setDiscordConfigured] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const [copied, setCopied] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState(false);
  const [testHint, setTestHint] = useState('');

  const origin = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);

  const redirectUri = origin ? `${origin}/api/auth/callback/discord` : '';

  const setTempMsg = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(''), 1800);
  };

  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  };

  const copyRedirectUri = async () => {
    if (!redirectUri) return;
    setMsg('');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(redirectUri);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
        return;
      }
    } catch {
      // fall back
    }

    const ok = fallbackCopy(redirectUri);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      return;
    }

    window.prompt('Copy this Redirect URI:', redirectUri);
    setTempMsg('Select + copy shown.');
  };

  const checkStatus = async (opts?: {force?: boolean; debounceMs?: number}) => {
    const force = !!opts?.force;
    const debounceMs = opts?.debounceMs ?? 100;

    if (force) invalidateJsonCache(SETUP_STATUS_URL);

    const run = async () => {
      try {
        setChecking(true);
        const j = await fetchJsonCached<any>(SETUP_STATUS_URL, 2500);
        setOwnerSet(!!j?.ownerSet);
        setDiscordConfigured(!!j?.discordConfigured);
      } catch {
        setOwnerSet(false);
        setDiscordConfigured(false);
      } finally {
        setChecking(false);
      }
    };

    if (debounceMs > 0) {
      await debounceAsync('setup-status', debounceMs, run);
      return;
    }
    await run();
  };

  useEffect(() => {
    void checkStatus({debounceMs: 0});
  }, []);

  if (checking) return null;
  if (ownerSet) return null;

  const discordId = String((session as any)?.discordId || '').trim();
  const discordName = String((session as any)?.user?.name || '').trim();

  const saveDiscordConfig = async () => {
    setBusy(true);
    setMsg('');
    setTestOk(false);
    setTestHint('');
    try {
      const res = await fetch('/api/setup/discord-config', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          discordClientId: clientId,
          discordClientSecret: clientSecret,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Failed to save Discord settings');
      setTempMsg('Saved!');
      await checkStatus({force: true, debounceMs: 0});
    } catch (e: any) {
      setMsg(e?.message || 'Failed to save Discord settings');
    } finally {
      setBusy(false);
    }
  };

  const testRedirect = async () => {
    setTesting(true);
    setMsg('');
    setTestOk(false);
    setTestHint('');
    try {
      const res = await fetch('/api/setup/test-redirect', {method: 'POST'});
      const j = await res.json().catch(() => ({}));

      if (j?.ok) {
        setTestOk(true);
        setTempMsg('Redirect OK!');
      } else {
        setTestOk(false);
        setTestHint(j?.hint || 'Discord rejected the redirect URI. Add it to OAuth2 Redirects.');
        setMsg('Redirect test failed.');
      }
    } catch (e: any) {
      setMsg(e?.message || 'Redirect test failed.');
    } finally {
      setTesting(false);
    }
  };

  const claimOwner = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/setup/claim-owner', {method: 'POST'});
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Failed to set Owner');
      setTempMsg('Owner set!');
      await refresh();
      await checkStatus({force: true, debounceMs: 0});
    } catch (e: any) {
      setMsg(e?.message || 'Failed to set Owner');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(var(--reblas-soft-blur, 10px))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <Card
        css={{
          p: '$12',
          maxWidth: '860px',
          width: '100%',
          background: 'rgba(0,0,0,0.55)',
          border: '2px solid var(--reblas-outline)',
          backdropFilter: 'blur(var(--reblas-panel-blur, 16px))',
        }}
      >
        <Text h2 css={{mb: '$2'}}>Initial Setup</Text>
        <Text css={{opacity: 0.8, mb: '$10'}}>
          One-time setup. First successful login becomes <b>Owner</b>.
        </Text>

        {msg ? (
          <Card
            css={{
              p: '$8',
              mb: '$10',
              background: msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('error')
                ? 'rgba(120,0,0,0.25)'
                : 'rgba(0,80,120,0.20)',
              border: '2px solid var(--reblas-outline)',
            }}
          >
            <Text size="$sm" css={{opacity: 0.95, fontWeight: 800}}>
              {msg}
            </Text>
            {testHint ? (
              <Text size="$sm" css={{opacity: 0.85, mt: '$4'}}>
                {testHint}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {!discordConfigured ? (
          <>
            <Text css={{fontWeight: 900, mb: '$4'}}>Step 1 — Create a Discord Application</Text>

            <div style={{opacity: 0.85, marginBottom: 14, lineHeight: 1.45}}>
              <div>1) Open the Discord Developer Portal and create an application.</div>
              <div>2) Go to <b>OAuth2</b> → <b>Redirects</b> → add this exact Redirect URI:</div>

              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  border: '2px solid var(--reblas-outline)',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <code style={{wordBreak: 'break-all', flex: 1}}>
                  {redirectUri || '(open this page in your browser to detect the URL)'}
                </code>

                <button
                  type="button"
                  onClick={copyRedirectUri}
                  disabled={!redirectUri}
                  style={{
                    border: '2px solid var(--reblas-outline)',
                    background: 'rgba(255,255,255,0.06)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: 10,
                    cursor: redirectUri ? 'pointer' : 'not-allowed',
                    fontWeight: 900,
                    whiteSpace: 'nowrap',
                    opacity: redirectUri ? 1 : 0.6,
                  }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <div style={{marginTop: 8}}>
                3) Copy <b>Client ID</b> and <b>Client Secret</b> and paste them below.
              </div>

              <div style={{marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap'}}>
                <a
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noreferrer"
                  style={{color: 'white', textDecoration: 'underline', fontWeight: 800}}
                >
                  Open Discord Developer Portal
                </a>
                <a
                  href="https://docs.discord.com/developers/topics/oauth2"
                  target="_blank"
                  rel="noreferrer"
                  style={{color: 'white', textDecoration: 'underline', fontWeight: 800}}
                >
                  Discord OAuth2 Docs
                </a>
                <a
                  href="https://next-auth.js.org/providers/discord"
                  target="_blank"
                  rel="noreferrer"
                  style={{color: 'white', textDecoration: 'underline', fontWeight: 800}}
                >
                  NextAuth Discord Provider Docs
                </a>
              </div>
            </div>

            <Input
              label="Discord Client ID"
              placeholder="Paste Client ID"
              fullWidth
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              css={{mb: '$8'}}
            />

            <Input
              label="Discord Client Secret"
              placeholder="Paste Client Secret"
              type="password"
              fullWidth
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              css={{mb: '$10'}}
            />

            <Button
              disabled={busy || !clientId.trim() || !clientSecret.trim()}
              onPress={saveDiscordConfig}
              css={{
                border: '2px solid var(--reblas-outline)',
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
              }}
            >
              {busy ? 'Saving…' : 'Save Discord Settings'}
            </Button>
          </>
        ) : status !== 'authenticated' ? (
          <>
            <Text css={{fontWeight: 900, mb: '$4'}}>Step 2 — Test Redirect URI</Text>

            <div
              style={{
                marginTop: 8,
                marginBottom: 14,
                padding: 10,
                border: '2px solid var(--reblas-outline)',
                borderRadius: 12,
                background: 'rgba(0,0,0,0.35)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <code style={{wordBreak: 'break-all', flex: 1}}>{redirectUri}</code>
              <button
                type="button"
                onClick={copyRedirectUri}
                style={{
                  border: '2px solid var(--reblas-outline)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'white',
                  padding: '8px 12px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontWeight: 900,
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <Button
              disabled={testing}
              onPress={testRedirect}
              css={{
                border: '2px solid var(--reblas-outline)',
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
                mr: '$8',
              }}
            >
              {testing ? 'Testing…' : 'Test Redirect URI'}
            </Button>

            <Spacer y={0.8} />

            <Text css={{fontWeight: 900, mb: '$6', opacity: testOk ? 1 : 0.7}}>
              Step 3 — Sign in with Discord
            </Text>

            <Button
              disabled={!testOk}
              onPress={() => signIn('discord')}
              css={{
                border: '2px solid var(--reblas-outline)',
                background: testOk ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)',
                backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
                opacity: testOk ? 1 : 0.6,
              }}
            >
              Sign in with Discord
            </Button>

            {!testOk ? (
              <Text size="$sm" css={{opacity: 0.65, mt: '$6'}}>
                Login is locked until the redirect test passes.
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <Text css={{fontWeight: 900, mb: '$6'}}>Step 4 — Set Owner</Text>
            <Text css={{opacity: 0.85, mb: '$8'}}>
              Signed in as <b>{discordName || 'Discord User'}</b>
              {discordId ? <> (ID: <code>{discordId}</code>)</> : null}
            </Text>

            <Button
              disabled={busy || !discordId}
              onPress={claimOwner}
              css={{
                border: '2px solid var(--reblas-outline)',
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(var(--reblas-soft-blur, 14px))',
              }}
            >
              {busy ? 'Setting Owner…' : 'Set me as Owner'}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
};
