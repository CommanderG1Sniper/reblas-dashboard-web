import type {NextApiRequest, NextApiResponse} from "next";
import type {NextAuthOptions} from "next-auth";
import NextAuth from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import fs from "fs";
import {getRuntimeDataPath} from "../../../lib/server/runtime-data";

const SETTINGS_PATH = getRuntimeDataPath("settings.json");
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

function readDiscordConfig() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const j = JSON.parse(raw);
    const fileId = typeof j.discordClientId === "string" ? j.discordClientId.trim() : "";
    const fileSecret =
      typeof j.discordClientSecret === "string" ? j.discordClientSecret.trim() : "";

    const clientId = fileId || (process.env.DISCORD_CLIENT_ID || "").trim();
    const clientSecret = fileSecret || (process.env.DISCORD_CLIENT_SECRET || "").trim();
    return {clientId, clientSecret};
  } catch {
    return {
      clientId: (process.env.DISCORD_CLIENT_ID || "").trim(),
      clientSecret: (process.env.DISCORD_CLIENT_SECRET || "").trim(),
    };
  }
}

function reqOrigin(req: NextApiRequest) {
  const proto =
    String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  const host =
    String(req.headers["x-forwarded-host"] || req.headers.host || "")
      .split(",")[0]
      .trim();
  return host ? `${proto}://${host}` : "";
}

export function getAuthOptions(req?: NextApiRequest): NextAuthOptions {
  const {clientId, clientSecret} = readDiscordConfig();

  const providers: any[] = [];
  if (clientId && clientSecret) {
    providers.push(
      DiscordProvider({
        clientId,
        clientSecret,
        authorization: {params: {scope: "identify email"}},
      }) as any
    );
  }

  return {
    providers,
    session: {strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS},
    jwt: {maxAge: SESSION_MAX_AGE_SECONDS},
    callbacks: {
      async jwt({token, account, profile}) {
        if (account) (token as any).accessToken = (account as any).access_token;
        const p = profile as any;
        if (p?.id) (token as any).discordId = p.id;
        return token;
      },
      async session({session, token}) {
        (session as any).discordId = (token as any).discordId;
        (session as any).accessToken = (token as any).accessToken;
        return session;
      },
    },
  };
}

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  // IMPORTANT: force NextAuth to use the real origin of THIS request
  const origin = reqOrigin(req);
  if (origin) {
    process.env.NEXTAUTH_URL = origin;
    process.env.NEXTAUTH_URL_INTERNAL = origin;
  }

  return await NextAuth(req, res, getAuthOptions(req));
}
