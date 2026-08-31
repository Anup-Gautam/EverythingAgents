import http from "node:http";
import { randomUUID } from "node:crypto";
import { shell } from "electron";
import type { AuthSession } from "./authSession";
import { withTokenExpiry } from "./authSession";

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type GoogleSignInResult =
  | { ok: true; session: AuthSession }
  | { ok: false; error: string; cancelled?: boolean };

const AUTH_PORT = 17891;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_LOGIN_URL = `http://127.0.0.1:${AUTH_PORT}/login`;

let activeServer: http.Server | null = null;
let activeLogin: Promise<GoogleSignInResult> | null = null;

export function readFirebaseConfigFromEnv(): FirebaseWebConfig | null {
  const apiKey = process.env.VITE_FIREBASE_API_KEY?.trim() ?? "";
  const authDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ?? "";
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID?.trim() ?? "";
  const storageBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ?? "";
  const messagingSenderId =
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? "";
  const appId = process.env.VITE_FIREBASE_APP_ID?.trim() ?? "";

  if (!apiKey || !authDomain || !projectId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function renderLoginHtml(config: FirebaseWebConfig, state: string): string {
  const configJson = JSON.stringify(config);
  const stateJson = JSON.stringify(state);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in to Coco</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1a1814;
      --muted: #6b6560;
      --bg: #f7f3ee;
      --accent: #2f6f4e;
      --accent-ink: #f7f3ee;
      --line: rgba(26, 24, 20, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      background:
        radial-gradient(ellipse 80% 50% at 20% 0%, #e8f0ea 0%, transparent 55%),
        radial-gradient(ellipse 70% 45% at 100% 100%, #efe6d8 0%, transparent 50%),
        var(--bg);
      color: var(--ink);
    }
    main {
      width: min(420px, calc(100% - 2rem));
      text-align: center;
    }
    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0 0 1.5rem;
      color: var(--muted);
      line-height: 1.45;
    }
    button {
      appearance: none;
      border: 1px solid var(--line);
      background: var(--accent);
      color: var(--accent-ink);
      font: inherit;
      font-weight: 600;
      padding: 0.85rem 1.25rem;
      border-radius: 999px;
      cursor: pointer;
      min-width: 220px;
    }
    button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .status {
      margin-top: 1rem;
      min-height: 1.4em;
      font-size: 0.95rem;
      color: var(--muted);
    }
    .status.error { color: #9b2c2c; }
    .status.ok { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <h1>Coco</h1>
    <p>Sign in with Google to sync sessions later. This tab is only for auth — close it when done.</p>
    <button type="button" id="sign-in">Continue with Google</button>
    <p class="status" id="status" aria-live="polite"></p>
  </main>
  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
    import {
      getAuth,
      GoogleAuthProvider,
      signInWithPopup,
    } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

    const firebaseConfig = ${configJson};
    const expectedState = ${stateJson};
    const btn = document.getElementById("sign-in");
    const status = document.getElementById("status");

    function setStatus(text, kind) {
      status.textContent = text;
      status.className = "status" + (kind ? " " + kind : "");
    }

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      setStatus("Opening Google…");
      try {
        const result = await signInWithPopup(auth, provider);
        const cred = GoogleAuthProvider.credentialFromResult(result);
        const user = result.user;
        if (!user?.uid) {
          throw new Error("Google sign-in did not return a usable session.");
        }
        // Firebase Admin verifyIdToken needs the Firebase ID token, not Google's OAuth idToken.
        const firebaseIdToken = await user.getIdToken(true);
        if (!firebaseIdToken) {
          throw new Error("Could not get Firebase ID token.");
        }
        setStatus("Finishing sign-in…");
        const res = await fetch("/auth/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: expectedState,
            idToken: firebaseIdToken,
            accessToken: cred?.accessToken ?? null,
            refreshToken: user.refreshToken ?? null,
            uid: user.uid,
            email: user.email ?? null,
            displayName: user.displayName ?? null,
            photoURL: user.photoURL ?? null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Could not complete sign-in.");
        }
        setStatus("Signed in. You can close this tab.", "ok");
        btn.textContent = "Done";
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setStatus(message, "error");
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function stopActiveServer(): void {
  if (!activeServer) return;
  try {
    activeServer.close();
  } catch {
    // ignore
  }
  activeServer = null;
}

export function startGoogleSystemBrowserLogin(
  config: FirebaseWebConfig,
): Promise<GoogleSignInResult> {
  // Reuse the in-flight login so a second menu click doesn't invalidate the open tab.
  if (activeLogin) {
    void shell.openExternal(AUTH_LOGIN_URL);
    return activeLogin;
  }

  activeLogin = new Promise((resolve) => {
    const state = randomUUID();
    let settled = false;

    const finish = (result: GoogleSignInResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopActiveServer();
      activeLogin = null;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({
        ok: false,
        error: "Sign-in timed out. Try again from the orb menu.",
        cancelled: true,
      });
    }, AUTH_TIMEOUT_MS);

    const server = http.createServer((req, res) => {
      const url = req.url ?? "/";

      if (req.method === "GET" && (url === "/" || url === "/login")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderLoginHtml(config, state));
        return;
      }

      if (req.method === "POST" && url === "/auth/complete") {
        void (async () => {
          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw) as {
              state?: string;
              idToken?: string;
              accessToken?: string | null;
              refreshToken?: string | null;
              uid?: string;
              email?: string | null;
              displayName?: string | null;
              photoURL?: string | null;
            };

            if (body.state !== state) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error:
                    "Invalid auth state. Close old Coco login tabs and sign in once from the orb.",
                }),
              );
              return;
            }

            if (!body.idToken || !body.uid) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({ error: "Missing signed-in user details." }),
              );
              return;
            }

            const session: AuthSession = withTokenExpiry({
              uid: body.uid,
              email: body.email ?? null,
              displayName: body.displayName ?? null,
              photoURL: body.photoURL ?? null,
              idToken: body.idToken,
              refreshToken: body.refreshToken ?? null,
              accessToken: body.accessToken ?? null,
              signedInAt: Date.now(),
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            finish({ ok: true, session });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: message }));
          }
        })();
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    activeServer = server;

    server.on("error", (err: NodeJS.ErrnoException) => {
      const message =
        err.code === "EADDRINUSE"
          ? `Port ${AUTH_PORT} is already in use. Close the other process and try again.`
          : err.message || "Could not start local auth server.";
      finish({ ok: false, error: message });
    });

    server.listen(AUTH_PORT, "127.0.0.1", () => {
      void shell.openExternal(AUTH_LOGIN_URL).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        finish({ ok: false, error: message });
      });
    });
  });

  return activeLogin;
}
