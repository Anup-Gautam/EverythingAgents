export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

/** Renderer only checks that Vite env is present. Auth runs in the system browser. */
export function getFirebaseConfig(): FirebaseWebConfig {
  return {
    apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY ?? "").trim(),
    authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim(),
    projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "").trim(),
    storageBucket: String(
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    ).trim(),
    messagingSenderId: String(
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    ).trim(),
    appId: String(import.meta.env.VITE_FIREBASE_APP_ID ?? "").trim(),
  };
}

export function isFirebaseConfigured(): boolean {
  const config = getFirebaseConfig();
  return Boolean(
    config.apiKey && config.authDomain && config.projectId && config.appId,
  );
}
