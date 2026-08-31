import admin from "firebase-admin";
import { requiredEnv } from "./env";

let initialized = false;

export function initFirebase(): typeof admin {
  if (!initialized) {
    const projectId = requiredEnv("FIREBASE_PROJECT_ID");
    const storageBucket = process.env.GCS_BUCKET?.trim() || undefined;
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
      storageBucket,
    });
    initialized = true;
  }
  return admin;
}

export function getFirestore(): admin.firestore.Firestore {
  return initFirebase().firestore();
}

export function getAuth(): admin.auth.Auth {
  return initFirebase().auth();
}

export function getBucket() {
  const bucketName = requiredEnv("GCS_BUCKET");
  return initFirebase().storage().bucket(bucketName);
}
