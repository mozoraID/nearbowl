"use client";

import "@near-wallet-selector/modal-ui/styles.css";
import { config } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { shortAccount } from "@/lib/format";
import { clearPending, recordOutcome, rememberPending, type TxMeta } from "@/lib/receipts";
import type { WalletModuleFactory, WalletSelector } from "@near-wallet-selector/core";
import { actionCreators } from "@near-js/transactions";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type TxResult = { txHash?: string };

const LOCAL_ICONS: Record<string, string> = {
  "hot-wallet": "/wallets/hot.png",
  "meteor-wallet": "/wallets/meteor.svg",
  "my-near-wallet": "/wallets/my-near-wallet.svg",
  "intear-wallet": "/wallets/intear.svg",
};

function withLocalIcon(factory: WalletModuleFactory, iconUrl: string): WalletModuleFactory {
  return async (options) => {
    const mod = await factory(options);
    if (!mod) return null;
    mod.metadata.iconUrl = iconUrl;
    return mod;
  };
}

function installWalletIconFallback() {
  const rewrite = (img: HTMLImageElement) => {
    if (img.dataset.localFallback === "1") return;
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:") || src.startsWith("/wallets/") || src.startsWith(`${window.location.origin}/wallets/`)) return;
    const inModal = Boolean(img.closest(".nws-modal"));
    const remoteHot = /herewallet|hot-labs/i.test(src);
    if (!inModal && !remoteHot) return;
    const label = `${img.alt} ${img.parentElement?.textContent ?? ""}`.toLowerCase();
    const next = label.includes("meteor")
      ? LOCAL_ICONS["meteor-wallet"]
      : label.includes("intear")
        ? LOCAL_ICONS["intear-wallet"]
        : label.includes("mynear") || label.includes("my near")
          ? LOCAL_ICONS["my-near-wallet"]
          : remoteHot || label.includes("hot")
            ? LOCAL_ICONS["hot-wallet"]
            : "/wallets/fallback.svg";
    img.dataset.localFallback = "1";
    img.src = next;
  };
  const onError = (event: Event) => {
    if (event.target instanceof HTMLImageElement) rewrite(event.target);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const nodes = record.type === "childList" ? Array.from(record.addedNodes) : [record.target];
      for (const node of nodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) rewrite(node);
        node.querySelectorAll("img").forEach((img) => rewrite(img));
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
  window.addEventListener("error", onError, true);
  return () => {
    observer.disconnect();
    window.removeEventListener("error", onError, true);
  };
}

export type CallAction = {
  methodName: string;
  args: object;
  depositYocto: string;
  gas?: string;
};

type WalletApi = {
  accountId: string | null;
  ready: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  call: (receiverId: string, methodName: string, args: object, depositYocto: string, gas?: string, meta?: TxMeta) => Promise<TxResult>;
  callAll: (receiverId: string, actions: CallAction[], meta?: TxMeta) => Promise<TxResult>;
};

const WalletContext = createContext<WalletApi | null>(null);

export function useWallet(): WalletApi {
  const value = useContext(WalletContext);
  if (!value) throw new Error("Wallet is only available inside the app shell");
  return value;
}

function readTxHash(result: unknown): string | undefined {
  if (typeof result === "string" && result.length > 8) return result;
  if (Array.isArray(result)) {
    for (const item of result) {
      const hash = readTxHash(item);
      if (hash) return hash;
    }
    return undefined;
  }
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (typeof record.transaction === "string" && record.transaction.length > 0) return record.transaction;
  const direct = hashOf(record.transaction);
  if (direct) return direct;
  if (typeof record.transactionHash === "string" && record.transactionHash.length > 0) return record.transactionHash;
  if (Array.isArray(record.transactionHashes)) {
    const first = record.transactionHashes.find((item) => typeof item === "string" && item.length > 0);
    if (typeof first === "string") return first;
  }
  const outcome = record.transaction_outcome;
  if (outcome && typeof outcome === "object") {
    const id = (outcome as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  if (Array.isArray(record.transactions)) return readTxHash(record.transactions[0]);
  return undefined;
}

function hashOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const hash = (value as { hash?: unknown }).hash;
  return typeof hash === "string" && hash.length > 0 ? hash : undefined;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<{ show: () => void } | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupMyNearWallet }, { setupHotWallet }, { setupIntearWallet }] =
        await Promise.all([
          import("@near-wallet-selector/core"),
          import("@near-wallet-selector/modal-ui"),
          import("@near-wallet-selector/meteor-wallet"),
          import("@near-wallet-selector/my-near-wallet"),
          import("@near-wallet-selector/hot-wallet"),
          import("@near-wallet-selector/intear-wallet"),
        ]);
      const next = await setupWalletSelector({
        network: config.network === "mainnet" ? "mainnet" : "testnet",
        modules: [
          withLocalIcon(setupMeteorWallet({ iconUrl: LOCAL_ICONS["meteor-wallet"] }), LOCAL_ICONS["meteor-wallet"]),
          withLocalIcon(setupMyNearWallet({ iconUrl: LOCAL_ICONS["my-near-wallet"] }), LOCAL_ICONS["my-near-wallet"]),
          withLocalIcon(setupHotWallet() as WalletModuleFactory, LOCAL_ICONS["hot-wallet"]),
          withLocalIcon(setupIntearWallet({ iconUrl: LOCAL_ICONS["intear-wallet"] }), LOCAL_ICONS["intear-wallet"]),
        ],
      });
      const ui = setupModal(next, { contractId: config.factoryAccountId });
      const state = next.store.getState();
      if (!cancelled) {
        setSelector(next);
        setModal(ui);
        setAccountId(state.accounts.find((account) => account.active)?.accountId ?? null);
        setReady(true);
      }
      const subscription = next.store.observable.subscribe((nextState) => {
        const active = nextState.accounts.find((account) => account.active)?.accountId ?? null;
        setAccountId(active);
      });
      unsubscribe = () => subscription.unsubscribe();
    })().catch((err: unknown) => {
      console.error(humanError(err));
      if (!cancelled) setReady(true);
    });
    const removeFallback = installWalletIconFallback();
    return () => {
      cancelled = true;
      unsubscribe();
      removeFallback();
    };
  }, []);

  const connect = useCallback(() => modal?.show(), [modal]);
  const disconnect = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
  }, [selector]);

  const callAll = useCallback(
    async (receiverId: string, actions: CallAction[], meta?: TxMeta): Promise<TxResult> => {
      if (!selector || !accountId) {
        modal?.show();
        throw new Error("Connect a wallet first.");
      }
      if (meta) rememberPending(meta);
      try {
        const wallet = await selector.wallet();
        const outcome = await wallet.signAndSendTransaction({
          signerId: accountId,
          receiverId,
          actions: actions.map((action) =>
            actionCreators.functionCall(action.methodName, action.args, BigInt(action.gas ?? "80000000000000"), BigInt(action.depositYocto)),
          ),
        });
        const txHash = readTxHash(outcome);
        const redirected = new URLSearchParams(window.location.search).has("transactionHashes");
        if (txHash) recordOutcome(txHash, accountId);
        else if (!redirected) clearPending();
        return { txHash };
      } catch (err) {
        clearPending();
        throw err;
      }
    },
    [accountId, modal, selector],
  );

  const call = useCallback(
    async (receiverId: string, methodName: string, args: object, depositYocto: string, gas = "80000000000000", meta?: TxMeta) =>
      callAll(receiverId, [{ methodName, args, depositYocto, gas }], meta),
    [callAll],
  );

  const value = useMemo(
    () => ({ accountId, ready, connect, disconnect, call, callAll }),
    [accountId, ready, connect, disconnect, call, callAll],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletButton() {
  const { accountId, ready, connect, disconnect } = useWallet();
  if (!ready) {
    return (
      <button className="ghost wallet-btn" disabled>
        Wallet
      </button>
    );
  }
  if (!accountId) {
    return (
      <button className="solid wallet-btn" onClick={connect}>
        <span className="wallet-long">Connect wallet</span>
        <span className="wallet-short">Connect</span>
      </button>
    );
  }
  return (
    <button className="ghost wallet-btn on-dark" onClick={() => void disconnect()} title={`Disconnect ${accountId}`}>
      <span className="wallet-id">{shortAccount(accountId)}</span>
    </button>
  );
}
