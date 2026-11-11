"use client";

import "@near-wallet-selector/modal-ui/styles.css";
import { config } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { shortAccount } from "@/lib/format";
import type { WalletSelector } from "@near-wallet-selector/core";
import { actionCreators } from "@near-js/transactions";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type TxResult = { txHash?: string };

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
  call: (receiverId: string, methodName: string, args: object, depositYocto: string, gas?: string) => Promise<TxResult>;
  callAll: (receiverId: string, actions: CallAction[]) => Promise<TxResult>;
};

const WalletContext = createContext<WalletApi | null>(null);

export function useWallet(): WalletApi {
  const value = useContext(WalletContext);
  if (!value) throw new Error("Wallet is only available inside the app shell");
  return value;
}

function readTxHash(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  const direct = hashOf(record.transaction);
  if (direct) return direct;
  if (typeof record.transactionHash === "string" && record.transactionHash.length > 0) return record.transactionHash;
  if (Array.isArray(record.transactionHashes) && typeof record.transactionHashes[0] === "string") return record.transactionHashes[0];
  if (Array.isArray(record.transactions)) return hashOf(record.transactions[0]);
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
        modules: [setupMeteorWallet(), setupMyNearWallet(), setupHotWallet(), setupIntearWallet()],
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
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const connect = useCallback(() => modal?.show(), [modal]);
  const disconnect = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
  }, [selector]);

  const callAll = useCallback(
    async (receiverId: string, actions: CallAction[]): Promise<TxResult> => {
      if (!selector || !accountId) {
        modal?.show();
        throw new Error("Connect a wallet first.");
      }
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId,
        actions: actions.map((action) =>
          actionCreators.functionCall(action.methodName, action.args, BigInt(action.gas ?? "80000000000000"), BigInt(action.depositYocto)),
        ),
      });
      return { txHash: readTxHash(outcome) };
    },
    [accountId, modal, selector],
  );

  const call = useCallback(
    async (receiverId: string, methodName: string, args: object, depositYocto: string, gas = "80000000000000") =>
      callAll(receiverId, [{ methodName, args, depositYocto, gas }]),
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
