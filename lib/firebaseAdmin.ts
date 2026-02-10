import "server-only";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export function adminApp() {
  if (getApps().length) return getApps()[0];

  const json = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!json) {
    throw new Error("Missing FIREBASE_ADMIN_SERVICE_ACCOUNT env var");
  }

  const serviceAccount = JSON.parse(json);

  return initializeApp({
    credential: cert(serviceAccount),
  });
}

export function adminDb() {
  const app = adminApp();
  return getFirestore(app);
}

export function adminAuth() {
  const app = adminApp();
  return getAuth(app);
}
