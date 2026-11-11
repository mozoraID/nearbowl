"use client";

import { FaucetButton, useUsdcAccount } from "@/components/FaucetButton";
import { Pet } from "@/components/Pet";
import { useWallet } from "@/components/Wallet";
import { isTestnet } from "@/lib/config";
import { getConfig, listCoins } from "@/lib/factory";
import { formatDuration, formatUsdc, shortAccount } from "@/lib/format";
import type { CoinView } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export function StartGuide() {
  const { accountId, ready, connect } = useWallet();
  const { balance, registered } = useUsdcAccount();
  const [alive, setAlive] = useState<CoinView[] | null>(null);
  const [initialLife, setInitialLife] = useState<string | null>(null);
  let hasBalance = false;
  try {
    hasBalance = balance !== null && BigInt(balance) > 0n;
  } catch {
    hasBalance = false;
  }
  const step = !accountId ? 1 : !hasBalance ? 2 : 3;

  useEffect(() => {
    let stop = false;
    const load = () => {
      listCoins("alive", 0, 12)
        .then((rows) => {
          if (!stop) setAlive(rows);
        })
        .catch(() => {
          if (!stop) setAlive([]);
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    getConfig()
      .then((row) => {
        if (!stop) setInitialLife(row.params.initial_life_ns);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="start-guide">
      <header className="section-head">
        <p className="eyebrow on-light">Three steps</p>
        <h1>Get started</h1>
        <p>Connect a testnet wallet, take free tUSDC, then launch a coin or feed one that is still alive. tUSDC is play money.</p>
      </header>
      <ol className="stepper">
        <li className={accountId ? "is-done" : step === 1 ? "is-current" : ""} aria-current={step === 1 ? "step" : undefined}>
          <span className="step-index">{accountId ? "✓" : "1"}</span>
          <div className="card step-body">
            <h2>Connect a testnet wallet</h2>
            {accountId ? (
              <p className="hint ok">Connected as {shortAccount(accountId)}.</p>
            ) : (
              <>
                <p>Use the same wallet selector as the rest of the app: Meteor, MyNearWallet, HOT, or Intear, with the network set to testnet.</p>
                <p>A free account from <a href="https://testnet.mynearwallet.com/" target="_blank" rel="noreferrer">MyNearWallet testnet</a> is enough. Meteor Wallet works too if you create the account on testnet. New accounts usually arrive with a little testnet NEAR, which covers storage.</p>
                <button type="button" className="solid" disabled={!ready} onClick={connect}>
                  {ready ? "Connect wallet" : "Loading wallets…"}
                </button>
              </>
            )}
          </div>
        </li>
        <li className={hasBalance ? "is-done" : step === 2 ? "is-current" : ""} aria-current={step === 2 ? "step" : undefined}>
          <span className="step-index">{hasBalance ? "✓" : "2"}</span>
          <div className="card step-body">
            <h2>Get free tUSDC</h2>
            {isTestnet ? (
              <>
                <p>The tUSDC contract has a public faucet: 100 tUSDC, at most once a minute. The first tap registers your account for storage (0.00125 NEAR) and then mints, in one approval.</p>
                <FaucetButton detailed />
                {registered === false && accountId ? <p className="hint">This account is not on tUSDC yet. The button registers it and mints together.</p> : null}
              </>
            ) : (
              <p>The faucet exists only on the testnet token. This app is pointed at mainnet.</p>
            )}
          </div>
        </li>
        <li className={step === 3 ? "is-current" : ""} aria-current={step === 3 ? "step" : undefined}>
          <span className="step-index">3</span>
          <div className="card step-body">
            <h2>Launch a coin, or feed one</h2>
            <p>A launch needs 0.06 NEAR of factory storage and a seed of at least 1 USDC. Feeding means buying at least 1 USDC. Buys smaller than that can mint tokens but do not add time.</p>
            <div className="hero-actions">
              <Link className="solid" href="/launch">
                Launch a coin
              </Link>
            </div>
            {alive === null ? (
              <p className="hint">Looking for coins that are still alive…</p>
            ) : alive.length === 0 ? (
              <div className="inline-note">
                <Pet mood="hungry" size="sm" />
                <p>
                  {initialLife
                    ? `Nothing is alive right now. Each coin on this factory starts with ${formatDuration(BigInt(initialLife))} of life, so they reach the graveyard quickly. Launch the first one, then buy at least 1 tUSDC to feed it.`
                    : "Nothing is alive right now. Launch the first one, then buy at least 1 tUSDC to feed it."}
                </p>
              </div>
            ) : (
              <ul className="feed-list">
                {alive.slice(0, 4).map((coin) => (
                  <li key={coin.coin_id}>
                    <Link href={`/coin/${coin.coin_id}`}>
                      <strong>
                        {coin.symbol} · {coin.name}
                      </strong>
                      <span>
                        {formatDuration(BigInt(coin.remaining_ns))} left · {formatUsdc(coin.reserve, 2)} USDC
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
