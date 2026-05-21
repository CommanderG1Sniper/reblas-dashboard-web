import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir, getRuntimeDataPath} from '../../../lib/server/runtime-data';

const SETTINGS_PATH = getRuntimeDataPath('settings.json');

function readDiscordClientId(): string {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const j = JSON.parse(raw);
    return typeof j.discordClientId === 'string' ? j.discordClientId.trim() : '';
  } catch {
    return '';
  }
}

function getOrigin(req: NextApiRequest) {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = xfProto || 'http';
  const host = String(req.headers.host || '').trim();
  return {proto, host, origin: `${proto}://${host}`};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  const clientId = readDiscordClientId();
  if (!clientId) return res.status(400).json({ok: false, error: 'Discord Client ID not saved yet'});

  const {origin} = getOrigin(req);
  const redirectUri = `${origin}/api/auth/callback/discord`;

  // If this redirect URI is NOT registered, Discord will return an error page immediately.
  const url =
    `https://discord.com/api/oauth2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('identify')}`;

  try {
    const r = await fetch(url, {method: 'GET'});
    const text = await r.text();

    const bad =
      !r.ok ||
      /invalid oauth2 redirect/i.test(text) ||
      /invalid redirect/i.test(text) ||
      /redirect uri/i.test(text) && /invalid/i.test(text);

    if (bad) {
      return res.status(200).json({
        ok: false,
        redirectUri,
        hint: 'Discord rejected this redirect URI. Add it in Discord Developer Portal → OAuth2 → Redirects.',
      });
    }

    return res.status(200).json({ok: true, redirectUri});
  } catch (e: any) {
    return res.status(200).json({
      ok: false,
      redirectUri,
      error: e?.message || 'Network error while testing Discord',
    });
  }
}
