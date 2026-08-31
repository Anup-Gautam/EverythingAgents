# Coco

Coco is a macOS floating **session companion orb**. Start a screen/window session, capture screenshots and recordings, save quotes, dictate voice notes (**Remember**), ask **Explain** on selected text, then end the session to get a structured study-note HTML pack.

Stack: **Electron + React + Vite** (orb) · **Express** API on `:8080` · **Firebase Auth / Firestore / GCS** · **Genkit + Gemini** (session synthesize) · **Gemini** (explain, captions) · **Groq** STT · **Cartesia** TTS.

Architecture diagram: [docs/architecture.md](docs/architecture.md).

---

## Prerequisites

- **macOS** (Screen Recording + Microphone permissions required)
- **Node.js 20+** and npm
- A **Firebase** project (Auth Google provider, Firestore, Storage bucket)
- API keys:
  - [Google AI Studio](https://aistudio.google.com/) — `GEMINI_API_KEY` (billing/credits required for synthesize)
  - [Groq](https://console.groq.com/) — `GROQ_API_KEY` (speech-to-text)
  - [Cartesia](https://cartesia.ai/) — `CARTESIA_API_KEY` (text-to-speech)
- Firebase **service account JSON** with access to Firestore + the GCS bucket

Optional: Deepgram keys as STT/TTS fallback if Groq/Cartesia are unset.

---

## 1. Clone and install

```bash
git clone <your-repo-url>
cd "ALL AGENTS"   # or your clone directory name

# Orb (Electron + Vite)
npm install

# Backend API
cd backend && npm install && cd ..
```

---

## 2. Configure environment

### Orb — root `.env`

```bash
cp .env.example .env
```

Fill Firebase **web** config (Firebase Console → Project settings → Your apps → Web):

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

VITE_API_BASE_URL=http://127.0.0.1:8080
```

### Backend — `backend/.env`

```bash
cp backend/.env.example backend/.env
```

Place your service account at `backend/serviceAccount.json` (gitignored), then set:

```env
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
FIREBASE_PROJECT_ID=your-project-id
GCS_BUCKET=your-bucket-name
PORT=8080

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODELS=gemini-3.7-flash

GROQ_API_KEY=...
CARTESIA_API_KEY=...
# CARTESIA_VOICE_ID / models — defaults in .env.example are fine to start
```

Never commit `.env` or `serviceAccount.json`.

### Firebase console checklist

1. Enable **Google** sign-in under Authentication.
2. Create **Firestore** (production or test mode for hackathon).
3. Create a **Storage** bucket matching `GCS_BUCKET` / `VITE_FIREBASE_STORAGE_BUCKET`.
4. Ensure the service account can read/write Firestore and the bucket.

---

## 3. Run locally (two terminals)

### Terminal A — API

```bash
cd backend
npm start
```

You should see something like:

```text
[coco-api] listening on http://127.0.0.1:8080
[coco-api] Voice STT=groq TTS=cartesia
```

Health check:

```bash
curl -s http://127.0.0.1:8080/health
```

Expect `"ok": true`, `"hasGemini": true`, and preferred voice providers when keys are set.

### Terminal B — Orb

From the **repo root**:

```bash
env -u ELECTRON_RUN_AS_NODE npm start
```

(`env -u ELECTRON_RUN_AS_NODE` avoids a common macOS/npm issue where Electron is launched incorrectly.)

This starts Vite on **http://127.0.0.1:5174** and opens the floating orb.

### macOS permissions

On first use:

1. **System Settings → Privacy & Security → Screen Recording** — enable **Electron** (or your packaged app).
2. Allow **Microphone** when prompted (push-to-talk / Remember).
3. If screen previews are blank, toggle Screen Recording off/on and **restart the orb**.

The source picker includes helpers to open Screen Recording settings.

---

## 4. Quick demo loop

1. Click the orb → pick a screen or window → session starts.
2. Sign in (orb menu → **Sign in with Google**) for cloud + voice features.
3. Try:
   - **Screenshot** `⌘⇧S`
   - **Record** `⌘⇧R` (toggle)
   - **Note this** `⌘⇧N` (copy text first)
   - **Remember** `⌘⇧M` (speak → click mic or press again to save)
   - **Push to talk** `⌘⇧Space` (say “explain”, “screenshot”, “remember”, …)
4. **End session** → study note HTML under `~/Pictures/Coco/notes/`.

Captures also land in `~/Pictures/Coco/screenshots` and `~/Pictures/Coco/recordings`.

**When signed in**, Firebase also stores that session in the cloud: notes and Q&A go to **Firestore**; screenshots, recordings, and the synthesized study note go to **GCS** (study-note markdown is also written on the Firestore session document).

---

## 5. Hotkeys

| Shortcut | Action |
|----------|--------|
| `⌘⇧S` | Screenshot |
| `⌘⇧R` | Start/stop screen recording |
| `⌘⇧N` | Note this (clipboard) |
| `⌘⇧M` | Remember (voice note; toggle stop) |
| `⌘⇧C` | Command bar |
| `⌘⇧Space` | Push to talk |

---

## 6. Deploying the API to the cloud (optional)

The orb talks to whatever `VITE_API_BASE_URL` points at. For a hosted API (e.g. **Cloud Run**):

1. Build/run the Express app from `backend/` with the same env vars as local (`GEMINI_*`, `GROQ_*`, `CARTESIA_*`, Firebase credentials, `GCS_BUCKET`, `PORT` or Cloud Run’s `PORT`).
2. Mount `GOOGLE_APPLICATION_CREDENTIALS` via Secret Manager / Cloud Run service account (preferred over shipping a JSON file).
3. Allow CORS from your Electron origin if you tighten CORS later (local setup uses open CORS for hackathon speed).
4. Set root `.env`:

   ```env
   VITE_API_BASE_URL=https://YOUR-SERVICE-xxxxx.run.app
   ```

5. Restart the orb so Electron picks up the new base URL.

**Notes for judges / reproducibility**

- A packaged `.app` installer is **not** required for the demo; `npm start` is the supported path.
- End-of-session note quality depends on **Gemini quota/credits**. If credits are depleted, Coco still writes a local fallback note (weaker than full synthesize).
- Keep the API process running while using the orb; without it, cloud explain/transcribe/synthesize fail.

Example Cloud Run sketch (adjust image build to your CI):

```bash
# From backend/, after containerizing the Express app:
gcloud run deploy coco-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated   # or lock down + use auth as you prefer
  # plus --set-secrets / --set-env-vars for keys and bucket
```

Then point `VITE_API_BASE_URL` at the service URL.

---

## 7. Project layout

```text
├── src/                 # React orb UI
├── electron/            # Main process, IPC, notes HTML, cloud client
├── backend/             # Express API (Genkit synthesize, Gemini, Groq, Cartesia, Firebase)
├── scripts/             # Electron Info.plist screen-capture patch
├── .env.example         # Orb Firebase + API URL
└── backend/.env.example # API keys + GCS + service account path
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Port 5174 is already in use` | Quit the other Vite/orb, or `lsof -tiTCP:5174 \| xargs kill`, then restart |
| Blank source thumbnails | Grant Screen Recording to Electron; restart orb |
| Explain / notes are weak or “Synthesize failed” | Check Gemini billing/credits; restart `backend` after fixing `.env` |
| Voice commands fail | Sign in; confirm Groq key; `curl` `/health` shows `stt: groq` |
| Orb won’t launch Electron correctly | Use `env -u ELECTRON_RUN_AS_NODE npm start` |

---