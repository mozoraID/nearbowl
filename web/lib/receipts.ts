"use client";

import { useSyncExternalStore } from "react";

export type ReceiptKind = "launch" | "buy" | "sell" | "claim" | "faucet" | "storage" | "transaction";

export type TxMeta = {
  kind: ReceiptKind;
  coinId?: string;
  usdc?: string;
  tokens?: string;
};

export type StoredReceipt = TxMeta & {
  hash: string;
  accountId: string;
  at: number;
};

const STORAGE_KEY = "nearbowl.receipts.v1";
const PENDING_KEY = "nearbowl.pendingAction";
const EMPTY: StoredReceipt[] = [];

let cacheRaw: string | null = null;
let cache: StoredReceipt[] = EMPTY;
const listeners = new Set<() => void>();

function isReceipt(value: unknown): value is StoredReceipt {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredReceipt>;
  return typeof row.hash === "string" && row.hash.length > 0 && typeof row.kind === "string" && typeof row.accountId === "string" && typeof row.at === "number";
}

export function loadReceipts(): StoredReceipt[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  if (!raw) {
    cache = EMPTY;
    return cache;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    cache = Array.isArray(parsed) ? parsed.filter(isReceipt) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function writeReceipts(next: StoredReceipt[]) {
  cache = next;
  cacheRaw = JSON.stringify(next);
  window.localStorage.setItem(STORAGE_KEY, cacheRaw);
  listeners.forEach((listener) => listener());
}

export function saveReceipt(receipt: StoredReceipt) {
  const current = loadReceipts().filter((row) => row.hash !== receipt.hash);
  writeReceipts([receipt, ...current].slice(0, 40));
}

export function rememberPending(meta: TxMeta) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...meta, at: Date.now() }));
}

export function takePending(): (TxMeta & { at: number }) | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PENDING_KEY);
  window.sessionStorage.removeItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TxMeta & { at?: number };
    if (!parsed || typeof parsed.kind !== "string") return null;
    return { ...parsed, at: typeof parsed.at === "number" ? parsed.at : Date.now() };
  } catch {
    return null;
  }
}

export function clearPending() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_KEY);
}

export function recordOutcome(hash: string | undefined, accountId: string | null): StoredReceipt | null {
  if (!hash || !accountId) return null;
  const pending = takePending();
  const receipt: StoredReceipt = {
    hash,
    accountId,
    at: Date.now(),
    kind: pending?.kind ?? "transaction",
    coinId: pending?.coinId,
    usdc: pending?.usdc,
    tokens: pending?.tokens,
  };
  saveReceipt(receipt);
  return receipt;
}

export function matchTrade(coinId: string, trade: { account_id: string; side: string; usdc: string; tokens: string }): StoredReceipt | null {
  const kind = trade.side === "sell" ? "sell" : "buy";
  const rows = loadReceipts().filter((row) => row.kind === kind && row.accountId === trade.account_id && (row.coinId === undefined || row.coinId === coinId));
  const exact = rows.find((row) => row.usdc === trade.usdc && row.tokens === trade.tokens);
  if (exact) return exact;
  return rows.find((row) => row.usdc === trade.usdc) ?? null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cacheRaw = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useReceipts(): StoredReceipt[] {
  return useSyncExternalStore(subscribe, loadReceipts, () => EMPTY);
}
