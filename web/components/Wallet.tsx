"use client";

import "@near-wallet-selector/modal-ui/styles.css";
import { config } from "@/lib/config";
import { humanError } from "@/lib/errors";
import type { WalletSelector } from "@near-wallet-selector/core";
import { actionCreators } from "@near-js/transactions";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type WalletApi = {
  accountId: string | null;
  ready: boolean;
  connect: () => void;
  disconnect: () => Promise<void>;
  call: (receiverId: string, methodName: string, args: object, depositYocto: string, gas?: string) => Promise<void>;
};

const WalletContext = createContext<WalletApi | null>(null);

export function useWallet(): WalletApi {
  const value = useContext(WalletContext);
  if (!value) throw new Error("Wallet is only available inside the app shell");
  return value;
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
      unsubscribe = next.store.observable.subscribe((nextState) => {
        const active = nextState.accounts.find((account) => account.active)?.accountId ?? null;
        setAccountId(active);
      }).unsubscribe;
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

  const call = useCallback(
    async (receiverId: string, methodName: string, args: object, depositYocto: string, gas = "80000000000000") => {
      if (!selector || !accountId) {
        modal?.show();
        throw new Error("Connect a wallet first.");
      }
      const wallet = await selector.wallet();
      await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId,
        actions: [actionCreators.functionCall(methodName, args, BigInt(gas), BigInt(depositYocto))],
      });
    },
    [accountId, modal, selector],
  );

  const value = useMemo(
    () => ({ accountId, ready, connect, disconnect, call }),
    [accountId, ready, connect, disconnect, call],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletButton() {
  const { accountId, ready, connect, disconnect } = useWallet();
  if (!ready) return <button className="ghost" disabled>Wallet</button>;
  if (!accountId) return <button className="solid" onClick={connect}>Connect wallet</button>;
  return (
    <button className="ghost" onClick={() => void disconnect()}>
      {accountId}
    </button>
  );
}
