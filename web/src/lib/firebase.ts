import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithPhoneNumber, 
  RecaptchaVerifier,
  type Auth,
  type ConfirmationResult
} from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

export const firebaseConfig = {
  apiKey: "AIzaSyCQIO5I-Vm9gKkJVPD6-44sRwv7m-ydDFs",
  authDomain: "quantveda-1e363.firebaseapp.com",
  projectId: "quantveda-1e363",
  storageBucket: "quantveda-1e363.firebasestorage.app",
  messagingSenderId: "750385560091",
  appId: "1:750385560091:web:7b2c65d79b29a3320b56be",
  measurementId: "G-RGYE0MFJTX"
};

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (appInstance) return appInstance;
  if (getApps().length > 0) {
    appInstance = getApp();
  } else {
    appInstance = initializeApp(firebaseConfig);
  }
  if (typeof window !== "undefined") {
    isSupported().then(yes => {
      if (yes && appInstance) getAnalytics(appInstance);
    }).catch(() => {});
  }
  return appInstance;
}

export function getFirebaseAuth(): Auth {
  if (authInstance) return authInstance;
  authInstance = getAuth(getFirebaseApp());
  authInstance.useDeviceLanguage();
  return authInstance;
}

export function ensureFirebase(): Promise<boolean> {
  try {
    getFirebaseApp();
    return Promise.resolve(true);
  } catch (e) {
    console.error("Failed to initialize Firebase:", e);
    return Promise.resolve(false);
  }
}

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || "";
  const msg = err instanceof Error ? err.message : "Authentication failed.";
  if (code === "auth/popup-closed-by-user") return "Google Sign-In was closed before completion.";
  if (code === "auth/popup-blocked") return "Google popup was blocked by browser. Please allow popups for this site.";
  if (code === "auth/cancelled-popup-request") return "Multiple sign-in requests were made. Please try again.";
  if (code === "auth/operation-not-allowed") return "Google Sign-In is disabled in Firebase Console -> Authentication -> Sign-in method.";
  if (code === "auth/unauthorized-domain") return `Domain '${window.location.hostname}' is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.`;
  if (code === "auth/invalid-phone-number") return "Invalid phone number. Use full international format (e.g. +919876543210).";
  if (code === "auth/quota-exceeded" || code === "auth/too-many-requests") return "SMS limit reached. Please use Email OTP or Google Sign-In.";
  if (code === "auth/captcha-check-failed") return "reCAPTCHA check failed. Please refresh and try again.";
  return msg;
}

export async function googleIdToken(): Promise<string> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await signInWithPopup(auth, provider);
    return await cred.user.getIdToken();
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }
}

function ensureRecaptchaContainer(): HTMLElement {
  let el = document.getElementById("qv-recaptcha");
  if (!el) {
    el = document.createElement("div");
    el.id = "qv-recaptcha";
    document.body.appendChild(el);
  }
  return el;
}

export async function sendFirebaseSms(phoneE164: string): Promise<{ confirm: (code: string) => Promise<string> }> {
  const auth = getFirebaseAuth();
  const container = ensureRecaptchaContainer();
  const w = window as unknown as { qvRecaptchaVerifier?: RecaptchaVerifier };
  try {
    if (w.qvRecaptchaVerifier) {
      try { w.qvRecaptchaVerifier.clear(); } catch { /* ignore */ }
    }
    w.qvRecaptchaVerifier = new RecaptchaVerifier(auth, container, { size: "invisible" });
    const confirmation: ConfirmationResult = await signInWithPhoneNumber(auth, phoneE164, w.qvRecaptchaVerifier);
    return {
      confirm: async (code: string) => {
        try {
          const cred = await confirmation.confirm(code);
          return await cred.user.getIdToken();
        } catch (e) {
          throw new Error(friendlyAuthError(e));
        }
      },
    };
  } catch (e) {
    if (w.qvRecaptchaVerifier) {
      try { w.qvRecaptchaVerifier.clear(); } catch { /* ignore */ }
      w.qvRecaptchaVerifier = undefined;
    }
    throw new Error(friendlyAuthError(e));
  }
}
