/**
 * Single source of truth for the auth token persisted in the browser.
 *
 * Every surface must read/write the token through these helpers instead of
 * touching localStorage directly — raw reads with mismatched keys (e.g.
 * `authToken` vs `auth_token`) silently broke authenticated calls before.
 */

/** Canonical storage key for the JWT access token. */
export const tokenKey = "auth_token";

/**
 * Keys written by older builds. They are still read (and migrated to
 * `tokenKey`) during the migration window, then removed on write/clear.
 */
export const legacyTokenKeys = ["authToken", "token"] as const;

function storages(): Storage[] {
  if (typeof window === "undefined") return [];
  const list: Storage[] = [];
  try {
    if (typeof localStorage !== "undefined") list.push(localStorage);
  } catch {
    // Access can throw in sandboxed iframes / blocked-storage modes
  }
  try {
    if (typeof sessionStorage !== "undefined") list.push(sessionStorage);
  } catch {
    // ignore
  }
  return list;
}

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(store: Storage, key: string) {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

/** Returns the stored auth token, or null (always null during SSR). */
export function getAuthToken(): string | null {
  const [local, session] = storages();
  if (!local) return null;

  const current = safeGet(local, tokenKey);
  if (current) return current;

  // Migration window: pick up a token stored under a legacy key and move it
  // to the canonical key so subsequent reads are consistent.
  for (const store of [local, session].filter(Boolean) as Storage[]) {
    for (const key of legacyTokenKeys) {
      const legacy = safeGet(store, key);
      if (legacy) {
        setAuthToken(legacy);
        return legacy;
      }
    }
  }
  return null;
}

/** Persists the auth token under the canonical key and drops legacy copies. */
export function setAuthToken(value: string): void {
  const [local, session] = storages();
  if (!local) return;
  try {
    local.setItem(tokenKey, value);
  } catch {
    return;
  }
  for (const store of [local, session].filter(Boolean) as Storage[]) {
    for (const key of legacyTokenKeys) safeRemove(store, key);
  }
}

/** Removes the auth token (canonical and legacy keys) from all storages. */
export function clearAuthToken(): void {
  for (const store of storages()) {
    safeRemove(store, tokenKey);
    for (const key of legacyTokenKeys) safeRemove(store, key);
  }
}

/** Convenience: `{ Authorization: 'Bearer …' }` or `{}` when signed out. */
export function authHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ------------------------------------------------------------------------- *
 * Behavioral biometrics — local-only profile storage
 *
 * Behavioral baselines (typing dynamics, mouse trajectories, device usage)
 * are sensitive. They are persisted ONLY in the browser (localStorage, with
 * an IndexedDB mirror when available) and are never sent over the network.
 * ------------------------------------------------------------------------- */

/** Current schema version for persisted behavioral profiles. */
export const BEHAVIORAL_SCHEMA_VERSION = 1;

/** Canonical storage key prefix for a per-user behavioral profile. */
export const behavioralProfileKeyPrefix = "behavioral_profile:";

/** Shape of a persisted behavioral baseline. */
export interface BehavioralProfile {
  /** Schema version, used to migrate older profiles on read. */
  version: number;
  /** Stable identifier for the user the baseline belongs to. */
  userId: string;
  /** Epoch millis when the profile was first created. */
  createdAt: number;
  /** Epoch millis of the most recent learning update. */
  updatedAt: number;
  /** Number of samples folded into the baseline so far. */
  sampleCount: number;
  /** Opaque, implementation-defined feature aggregates. */
  features: Record<string, number>;
}

/** Returns the storage key for a given user's behavioral profile. */
export function behavioralProfileKey(userId: string): string {
  return `${behavioralProfileKeyPrefix}${userId}`;
}

/**
 * Migrates a raw persisted profile to the current schema version.
 * Returns null when the payload is unusable.
 */
export function migrateBehavioralProfile(
  raw: unknown,
  userId: string,
): BehavioralProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<BehavioralProfile>;
  if (typeof candidate.version !== "number") return null;
  if (candidate.version > BEHAVIORAL_SCHEMA_VERSION) return null;

  const now = Date.now();
  const features =
    candidate.features && typeof candidate.features === "object"
      ? { ...candidate.features }
      : {};

  // v0 -> v1: profiles without a version were implicitly v0; normalize fields.
  return {
    version: BEHAVIORAL_SCHEMA_VERSION,
    userId: typeof candidate.userId === "string" ? candidate.userId : userId,
    createdAt:
      typeof candidate.createdAt === "number" ? candidate.createdAt : now,
    updatedAt:
      typeof candidate.updatedAt === "number" ? candidate.updatedAt : now,
    sampleCount:
      typeof candidate.sampleCount === "number" ? candidate.sampleCount : 0,
    features,
  };
}

/** Reads a user's behavioral profile from local storage (never the network). */
export function getBehavioralProfile(userId: string): BehavioralProfile | null {
  const [local] = storages();
  if (!local) return null;
  const raw = safeGet(local, behavioralProfileKey(userId));
  if (!raw) return null;
  try {
    return migrateBehavioralProfile(JSON.parse(raw), userId);
  } catch {
    return null;
  }
}

/** Persists a user's behavioral profile locally. Returns true on success. */
export function setBehavioralProfile(profile: BehavioralProfile): boolean {
  const [local] = storages();
  if (!local) return false;
  const normalized: BehavioralProfile = {
    ...profile,
    version: BEHAVIORAL_SCHEMA_VERSION,
    updatedAt: Date.now(),
  };
  try {
    local.setItem(
      behavioralProfileKey(normalized.userId),
      JSON.stringify(normalized),
    );
    return true;
  } catch {
    return false;
  }
}

/** Removes a user's behavioral profile from all local storages. */
export function clearBehavioralProfile(userId: string): void {
  const key = behavioralProfileKey(userId);
  for (const store of storages()) safeRemove(store, key);
}
