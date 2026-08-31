import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export type AuthSession = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  idToken: string;
  refreshToken: string | null;
  accessToken: string | null;
  signedInAt: number;
  /** Epoch ms when idToken expires (from JWT `exp`). */
  expiresAt?: number | null;
};

const REFRESH_SKEW_MS = 5 * 60 * 1000;

function sessionPath(): string {
  return path.join(app.getPath("userData"), "auth-session.json");
}

export function decodeIdTokenExpiry(idToken: string): number | null {
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function withTokenExpiry(session: AuthSession): AuthSession {
  const expiresAt =
    session.expiresAt ?? decodeIdTokenExpiry(session.idToken) ?? null;
  return { ...session, expiresAt };
}

function needsRefresh(session: AuthSession, now = Date.now()): boolean {
  const expiresAt =
    session.expiresAt ?? decodeIdTokenExpiry(session.idToken) ?? null;
  if (expiresAt != null) {
    return expiresAt - REFRESH_SKEW_MS <= now;
  }
  // Fallback if JWT can't be decoded: refresh after ~50 minutes.
  return now - session.signedInAt > 50 * 60 * 1000;
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  try {
    const raw = await fs.readFile(sessionPath(), "utf8");
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.uid || !parsed?.idToken) return null;
    return withTokenExpiry(parsed);
  } catch {
    return null;
  }
}

export async function saveAuthSession(
  session: AuthSession | null,
): Promise<void> {
  const file = sessionPath();
  if (!session) {
    try {
      await fs.unlink(file);
    } catch {
      // ignore missing file
    }
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const toSave = withTokenExpiry(session);
  await fs.writeFile(file, JSON.stringify(toSave, null, 2), "utf8");
}

/**
 * Refresh a Firebase ID token via the Secure Token API.
 * https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
 */
export async function refreshAuthSession(
  session: AuthSession,
  apiKey: string,
): Promise<AuthSession> {
  const refreshToken = session.refreshToken?.trim();
  if (!refreshToken) {
    throw new Error("No refresh token — sign in again.");
  }
  const key = apiKey.trim();
  if (!key) {
    throw new Error("Missing Firebase API key for token refresh.");
  }

  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
  );

  const data = (await res.json().catch(() => ({}))) as {
    id_token?: string;
    refresh_token?: string;
    user_id?: string;
    expires_in?: string;
    error?: { message?: string };
  };

  if (!res.ok || !data.id_token) {
    throw new Error(
      data.error?.message || `Token refresh failed (HTTP ${res.status})`,
    );
  }

  const expiresInSec = Number(data.expires_in) || 3600;
  return withTokenExpiry({
    ...session,
    uid: data.user_id || session.uid,
    idToken: data.id_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + expiresInSec * 1000,
    signedInAt: session.signedInAt,
  });
}

/**
 * Return a session with a fresh ID token, refreshing when near expiry.
 */
export async function ensureFreshAuthSession(
  session: AuthSession,
  apiKey: string,
): Promise<AuthSession> {
  const current = withTokenExpiry(session);
  if (!needsRefresh(current)) {
    return current;
  }
  return refreshAuthSession(current, apiKey);
}
