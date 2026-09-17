import { useSyncExternalStore } from "react";

import { forgetCredential, isVaultAvailable, recallCredential, rememberCredential } from "@/lib/credentialVault";

/**
 * Client-side mirror of the temporary single-user Basic credentials Aurum's
 * own login screen collects. Every API request sends the Authorization header
 * itself; nginx validates it without emitting a browser Basic challenge.
 *
 * Two tiers, chosen by the "remember me" checkbox:
 *  - sessionStorage (default): plain, but gone when the browser closes.
 *  - the encrypted vault: survives a restart for REMEMBER_DAYS.
 */
const SESSION_KEY = "aurum:basicAuth";
const LEGACY_REMEMBER_KEY = "aurum:basicAuth:remember";
const REMEMBER_DAYS = 7;
const REMEMBER_MS = REMEMBER_DAYS * 24 * 60 * 60 * 1000;

function forgetLegacyRememberedCredentials(): void {
  try {
    localStorage.removeItem(LEGACY_REMEMBER_KEY);
  } catch {
    // storage unavailable
  }
}

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function isRememberSupported(): boolean {
  return isVaultAvailable();
}

forgetLegacyRememberedCredentials();

let currentHeader: string | null = readSession();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getAuthHeader(): string | null {
  return currentHeader;
}

const restored: Promise<void> = (async () => {
  if (currentHeader !== null) return;
  const remembered = await recallCredential();
  if (remembered === null || currentHeader !== null) return;
  currentHeader = remembered;
  notify();
})();

export function whenAuthRestored(): Promise<void> {
  return restored;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${encodeUtf8Base64(`${username}:${password}`)}`;
}

export function setCredentials(username: string, password: string, remember = false): void {
  currentHeader = buildBasicAuthHeader(username, password);
  try {
    sessionStorage.setItem(SESSION_KEY, currentHeader);
  } catch {
    // keep in memory for this tab
  }
  if (remember) {
    void rememberCredential(currentHeader, REMEMBER_MS);
  } else {
    void forgetCredential();
  }
  notify();
}

/** Called when the API says the temporary credentials are wrong or stale. */
export function clearCredentials(): void {
  if (currentHeader === null) return;
  currentHeader = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
    forgetLegacyRememberedCredentials();
  } catch {
    // ignore
  }
  void forgetCredential();
  notify();
}

export type CredentialCheck = "ok" | "unauthorized" | "unreachable";

// Deliberately wrong placeholder used only to detect whether auth is enabled.
// The nginx gate returns 403 rather than 401 + WWW-Authenticate on a mismatch,
// so mobile browsers do not open their native Basic Auth dialog.
const PROBE_HEADER = `Basic ${btoa("__aurum_probe__:__aurum_probe__")}`;

export async function checkCredentials(header: string | null): Promise<CredentialCheck> {
  try {
    const response = await fetch("/api/accounts", {
      headers: { Authorization: header ?? PROBE_HEADER },
    });
    return response.status === 401 || response.status === 403 ? "unauthorized" : "ok";
  } catch {
    return "unreachable";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuthHeader(): string | null {
  return useSyncExternalStore(subscribe, () => currentHeader);
}
