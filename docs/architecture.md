# Coco — architecture

Clear view of how the orb, local API, Google services, and voice providers connect.

```mermaid
flowchart TB
  subgraph User["User machine"]
    Orb["Electron Orb<br/>React UI + hotkeys"]
    Main["Electron Main<br/>capture · clipboard · notes HTML · auth"]
    Files["Local files<br/>~/Pictures/Coco/<br/>screenshots · recordings · notes"]
    Orb <-->|preload IPC| Main
    Main --> Files
  end

  subgraph API["Local backend :8080<br/>Express + Firebase Admin"]
    Routes["Routes<br/>/session · /explain · /caption<br/>/transcribe · /speak · /health"]
  end

  subgraph Google["Google / Firebase"]
    Auth["Firebase Auth<br/>Google sign-in + ID tokens"]
    FS["Cloud Firestore<br/>sessions · notes · Q&A · study note"]
    GCS["Cloud Storage<br/>screenshots · recordings · study notes"]
    Gemini["Gemini API<br/>explain · caption<br/>+ Genkit synthesize flow"]
  end

  subgraph Voice["Voice providers"]
    Groq["Groq Whisper<br/>STT preferred"]
    Cartesia["Cartesia Sonic<br/>TTS preferred"]
  end

  Main -->|"Bearer ID token<br/>HTTP localhost:8080"| Routes
  Orb -.->|sign-in browser| Auth
  Auth -->|ID token refresh| Main

  Routes --> Gemini
  Routes --> Groq
  Routes --> Cartesia
  Routes --> FS
  Routes --> GCS

  Main -->|end session| Notes["Study note HTML<br/>open in notes window"]
  Routes -->|Genkit synthesizeNotes flow| Main
```

## Layers

| Layer | Role |
|--------|------|
| **Orb (frontend)** | UI, PTT / Remember mic, commands |
| **Electron main** | Screenshots / recording, clipboard notes, session timeline, opens notes |
| **Backend `:8080`** | Auth-gated API; holds provider keys |
| **Genkit** | `synthesizeNotes` flow for end-of-session study notes (Gemini under the hood) |
| **Gemini** | Explain, image / recording captions; model used by Genkit synthesize |
| **Groq / Cartesia** | Speech in / speech out |
| **Firestore + GCS** | When signed in: session docs, notes/Q&A events, study-note markdown (Firestore); screenshot + recording blobs + `study-note.md` (GCS) |
| **Local disk** | Always-available captures + final HTML note (works offline / unsigned-in) |

## Typical flows

1. **Explain:** copy text → main → `POST /explain` → Gemini → speak via Cartesia  
2. **Remember:** mic → `POST /transcribe` (Groq) → save as session note → Firestore when signed in  
3. **Recording:** WebM local + (signed in) GCS upload + Firestore event  
4. **End session:** timeline → `POST /session/synthesize` → **Genkit `synthesizeNotes` flow** → Gemini markdown → local HTML pack + (signed in) Firestore fields + GCS `study-note.md`  

Optional Deepgram STT/TTS is used only if Groq/Cartesia are unset or fail.
