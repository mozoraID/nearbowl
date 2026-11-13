"use client";

import { useToast } from "@/components/Toast";
import { useWallet } from "@/components/Wallet";
import { config, isTestnet, USDC_STORAGE_YOCTO } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { txUrl } from "@/lib/explorer";
import { formatUsdc } from "@/lib/format";
import { view } from "@/lib/near";
import type { StorageView } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

export function useUsdcAccount() {
  const { accountId } = useWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!accountId) {
      setBalance(null);
      setRegistered(null);
      setError(null);
      return;
    }
    try {
      const [bal, storage] = await Promise.all([
        view<string>(config.usdcAccountId, "ft_balance_of", { account_id: accountId }),
        view<StorageView | null>(config.usdcAccountId, "storage_balance_of", { account_id: accountId }),
      ]);
      setBalance(typeof bal === "string" ? bal : String(bal));
      setRegistered(storage !== null);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
    if (!accountId) return;
    const timer = window.setInterval(() => void reload(), 8000);
    return () => window.clearInterval(timer);
  }, [accountId, reload]);

  return { balance, registered, error, reload };
}

export function FaucetButton({ detailed = false }: { detailed?: boolean }) {
  const { accountId, call, callAll, connect } = useWallet();
  const push = useToast();
  const { balance, registered, error, reload } = useUsdcAccount();
  const [pending, setPending] = useState(false);
  if (!isTestnet) return null;

  const label = pending ? "Sending…" : registered === false ? "Register and get 100 tUSDC" : "Get 100 tUSDC";

  return (
    <div className="faucet">
      {accountId ? (
        <p className="hint">
          Balance {balance === null ? "…" : `${formatUsdc(balance)} tUSDC`}
          {registered === false ? " · not registered yet" : ""}
        </p>
      ) : null}
      <button
        type="button"
        className={detailed ? "solid" : "soft"}
        disabled={pending}
        onClick={() => {
          if (!accountId) {
            connect();
            return;
          }
          setPending(true);
          const run = async () => {
            if (registered === false) {
              return callAll(config.usdcAccountId, [
                {
                  methodName: "storage_deposit",
                  args: { account_id: accountId },
                  depositYocto: USDC_STORAGE_YOCTO,
                  gas: "40000000000000",
                },
                { methodName: "faucet", args: {}, depositYocto: "0", gas: "30000000000000" },
              ], { kind: "faucet", usdc: "100000000" });
            }
            return call(config.usdcAccountId, "faucet", {}, "0", "30000000000000", { kind: "faucet", usdc: "100000000" });
          };
          run()
            .then((result) => {
              push({
                tone: "ok",
                title: "100 tUSDC is on the way",
                detail: "The faucet allows one mint a minute. Balance updates after the transaction lands.",
                href: result.txHash ? txUrl(result.txHash) : undefined,
              });
              void reload();
              window.setTimeout(() => void reload(), 2000);
              window.setTimeout(() => void reload(), 5000);
            })
            .catch((err: unknown) => {
              push({ tone: "err", title: "Faucet did not go through", detail: humanError(err) });
            })
            .finally(() => setPending(false));
        }}
      >
        {accountId ? label : "Connect to get tUSDC"}
      </button>
      {detailed ? <p className="hint">100 tUSDC, at most once a minute. Registration costs 0.00125 NEAR once.</p> : null}
      {error ? <p className="hint warn">{error}</p> : null}
    </div>
  );
}
