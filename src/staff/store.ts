"use client";

// Counter state: last server snapshot + a persisted queue of operations.
// The UI always renders snapshot ⊕ queue, so it works the same online and offline.
// Ops are sent in order; each is idempotent on the server (applied_ops), so retries are safe.

import { useSyncExternalStore } from "react";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { errorCode, isAuthError, isNetworkError, rpc, supabase } from "@/lib/supabase";
import type { Snapshot } from "@/lib/types";
import { applyOp, type Op, type OpType } from "./reducer";
import { reportError } from "@/lib/report";

type QueuedOp = Op & { state: "pending" | "sent"; sentAt?: number };
export type FailedOp = { op: Op; code: string; at: number };

type State = {
  base: Snapshot | null;
  queue: QueuedOp[];
  failed: FailedOp[];
  online: boolean;
  syncing: boolean;
  loaded: boolean;
  lastSyncAt: number | null;
  view: Snapshot | null;
  needsAuth: boolean; // signed out / token expired: queued work waits for a sign-in
};

const STORE_KEY = "dot.staff.v1";
let state: State = { base: null, queue: [], failed: [], online: true, syncing: false, loaded: false, lastSyncAt: null, view: null, needsAuth: false };
const listeners = new Set<() => void>();

function computeView(base: Snapshot | null, queue: QueuedOp[]) {
  if (!base) return null;
  return queue.reduce((s, op) => {
    try {
      return applyOp(s, op);
    } catch {
      return s;
    }
  }, base);
}

function set(partial: Partial<State>, persist = true) {
  const next = { ...state, ...partial };
  if ("base" in partial || "queue" in partial) next.view = computeView(next.base, next.queue);
  state = next;
  listeners.forEach((l) => l());
  if (persist && ("base" in partial || "queue" in partial)) schedulePersist();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    idbSet(STORE_KEY, { base: state.base, queue: state.queue.map(({ state: _s, sentAt: _a, ...op }) => op) }).catch(() => {});
  }, 150);
}

export function useStaff<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
    () => selector(state),
  );
}
export const getState = () => state;

// ---------------------------------------------------------------- lifecycle
let started = false;
let channel: RealtimeChannel | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Called after a successful sign-in: resume syncing queued work. */
export function resumeAfterSignIn() {
  set({ needsAuth: false }, false);
  void flush().then(refresh);
}

/** The cached counter state, if this device has one (for starting offline). */
export async function cachedUserId(): Promise<string | null> {
  try {
    const saved = (await idbGet(STORE_KEY)) as { base: Snapshot | null } | undefined;
    return saved?.base?.me?.user_id ?? null;
  } catch {
    return null;
  }
}

export async function startStore(userId: string) {
  if (started) return;
  started = true;
  try {
    const saved = (await idbGet(STORE_KEY)) as { base: Snapshot | null; queue: Op[] } | undefined;
    if (saved?.base && saved.base.me?.user_id === userId) {
      set({ base: saved.base, queue: (saved.queue ?? []).map((o) => ({ ...o, state: "pending" as const })) }, false);
    } else if (saved?.queue?.length && saved.base?.me?.user_id !== userId) {
      // Another user's unsent ops: keep them (the counter's work matters more than who is signed in).
      set({ base: saved.base, queue: saved.queue.map((o) => ({ ...o, state: "pending" as const })) }, false);
    }
  } catch {}
  set({ loaded: true, online: navigator.onLine }, false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", () => set({ online: false }, false));
  heartbeat = setInterval(() => void refresh(), 30_000);
  subscribeRealtime();
  await flush();
  await refresh();
}

export async function stopStore() {
  started = false;
  window.removeEventListener("online", onOnline);
  if (heartbeat) clearInterval(heartbeat);
  if (channel) await supabase().removeChannel(channel);
  channel = null;
}

export async function clearLocal() {
  await idbDel(STORE_KEY).catch(() => {});
  state = { base: null, queue: [], failed: [], online: true, syncing: false, loaded: false, lastSyncAt: null, view: null, needsAuth: false };
  listeners.forEach((l) => l());
}

function onOnline() {
  set({ online: true }, false);
  void flush().then(refresh);
}

function subscribeRealtime() {
  const sb = supabase();
  channel = sb.channel("staff-feed");
  for (const table of ["orders", "bookings", "bills", "room_sessions", "menu_items", "payments"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => scheduleRefresh(600));
  }
  channel.subscribe();
}

export function scheduleRefresh(ms = 400) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), ms);
}

let refreshing = false;
export async function refresh() {
  if (refreshing) return;
  if (state.queue.some((q) => q.state === "pending")) {
    void flush();
    return;
  }
  if (!(await hasSession())) {
    set({ needsAuth: true }, false);
    return;
  }
  refreshing = true;
  const startedAt = Date.now();
  try {
    const snap = await rpc<Snapshot>("staff_snapshot");
    // Drop ops the server confirmed before this snapshot was taken.
    const queue = state.queue.filter((q) => q.state === "pending" || (q.sentAt ?? 0) > startedAt);
    set({ base: snap, queue, online: true, lastSyncAt: Date.now() });
  } catch (e) {
    if (isNetworkError(e)) set({ online: false }, false);
    else if (errorCode(e) === "not_staff" && (await hasSession())) throw e;
    else if (isAuthError(e)) set({ needsAuth: true }, false);
  } finally {
    refreshing = false;
  }
}

async function hasSession() {
  try {
    const { data } = await supabase().auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

async function flush() {
  if (state.syncing) return;
  if (state.queue.some((q) => q.state === "pending") && !(await hasSession())) {
    set({ needsAuth: true }, false);
    return;
  }
  set({ syncing: true }, false);
  try {
    for (;;) {
      const next = state.queue.find((q) => q.state === "pending");
      if (!next) break;
      const { state: _s, sentAt: _a, by: _b, ...op } = next;
      try {
        await rpc("staff_op", { op });
        set({ queue: state.queue.map((q) => (q.id === next.id ? { ...q, state: "sent" as const, sentAt: Date.now() } : q)), online: true });
      } catch (e) {
        if (isAuthError(e) && errorCode(e) !== "bad_owner_credentials") {
          set({ needsAuth: true }, false);
          return;
        }
        if (isNetworkError(e)) {
          set({ online: false }, false);
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => void flush().then(refresh), 5000);
          return;
        }
        // The server refused it: drop it, tell the counter, and resync.
        set({ queue: state.queue.filter((q) => q.id !== next.id), failed: [...state.failed, { op, code: errorCode(e), at: Date.now() }] });
        reportError("sync", `Counter change rejected: ${op.type} (${errorCode(e)})`, JSON.stringify(op.payload).slice(0, 2000), state.base?.me.user_id);
      }
    }
  } finally {
    set({ syncing: false }, false);
  }
  scheduleRefresh(250);
}

export function dismissFailed(i: number) {
  set({ failed: state.failed.filter((_, idx) => idx !== i) }, false);
}

// ---------------------------------------------------------------- actions
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)));

/** Queue an op (works offline). Returns the op id. */
export function dispatch(type: OpType, payload: Record<string, unknown>): string {
  const op: QueuedOp = { id: uuid(), type, at: new Date().toISOString(), payload, state: "pending", by: state.base?.me.user_id };
  set({ queue: [...state.queue, op] });
  void flush();
  return op.id;
}

/** Send an op that must reach the server now (owner override). Throws on failure. */
export async function dispatchOnline(type: OpType, payload: Record<string, unknown>, override?: { phone: string; password: string }) {
  if (state.queue.some((q) => q.state === "pending")) await flush();
  const op = { id: uuid(), type, at: new Date().toISOString(), payload, override };
  await rpc("staff_op", { op });
  await refresh();
}
