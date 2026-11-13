"use client";

import { FaucetButton, useUsdcAccount } from "@/components/FaucetButton";
import { Pet } from "@/components/Pet";
import { useWallet } from "@/components/Wallet";
import { config, CYCLE_FEED_USDC, CYCLE_SEED_USDC, FAUCET_USDC, isTestnet } from "@/lib/config";
import { getConfig, getRecentTrades, listCoins } from "@/lib/factory";
import { extensionPerUsdc, formatDuration, formatUsdc, shortAccount } from "@/lib/format";
import { view } from "@/lib/near";
import { useReceipts } from "@/lib/receipts";
import type { CoinView, ParamsView, PositionView } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

function duration(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return formatDuration(BigInt(value));
  } catch {
    return fallback;
  }
}

export function StartGuide() {
  const { accountId, ready, connect } = useWallet();
  const { balance, registered } = useUsdcAccount();
  const receipts = useReceipts();
  const [params, setParams] = useState<ParamsView | null>(null);
  const [paramsFailed, setParamsFailed] = useState(false);
  const [mine, setMine] = useState<CoinView | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [bought, setBought] = useState(false);
  const [sold, setSold] = useState(false);

  let hasBalance = false;
  try {
    hasBalance = balance !== null && BigInt(balance) > 0n;
  } catch {
    hasBalance = false;
  }

  useEffect(() => {
    let stop = false;
    getConfig()
      .then((row) => {
        if (!stop) setParams(row.params);
      })
      .catch(() => {
        if (!stop) setParamsFailed(true);
      });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (!accountId) {
      setMine(null);
      return;
    }
    let stop = false;
    const load = () => {
      Promise.all([listCoins("alive", 0, 50), listCoins("dead", 0, 50)])
        .then(([alive, dead]) => {
          if (stop) return;
          const coins = [...alive, ...dead].filter((coin) => coin.creator_id === accountId);
          coins.sort((a, b) => Number(b.coin_id) - Number(a.coin_id));
          setMine(coins[0] ?? null);
        })
        .catch(() => {
          if (!stop) setMine(null);
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !mine) {
      setPosition(null);
      setBought(false);
      setSold(false);
      return;
    }
    let stop = false;
    Promise.all([
      view<PositionView>(config.factoryAccountId, "get_position", { coin_id: Number(mine.coin_id), account_id: accountId }),
      getRecentTrades(mine.coin_id),
    ])
      .then(([row, trades]) => {
        if (stop) return;
        setPosition(row);
        setBought(trades.some((trade) => trade.side === "buy" && trade.account_id === accountId) || BigInt(row.balance || "0") > 0n);
        setSold(trades.some((trade) => trade.side === "sell" && trade.account_id === accountId));
      })
      .catch(() => {
        if (!stop) {
          setPosition(null);
          setBought(false);
          setSold(false);
        }
      });
    return () => {
      stop = true;
    };
  }, [accountId, mine]);

  const life = duration(params?.initial_life_ns, "30m");
  const perUsdc = params ? extensionPerUsdc(params.ext_ns_per_raw_usdc) : "60s";
  const capMin = duration(params?.max_life_min_ns, "1h");
  const capMax = duration(params?.max_life_max_ns, "3h");
  const minSeed = params ? formatUsdc(params.min_seed_usdc) : "1";
  const minFeed = params ? formatUsdc(params.min_trade_usdc) : "1";
  const launched = Boolean(mine) || receipts.some((row) => row.kind === "launch" && row.accountId === accountId);
  const fed = bought || receipts.some((row) => row.kind === "buy" && row.accountId === accountId);
  const exited = sold || receipts.some((row) => (row.kind === "sell" || row.kind === "claim") && row.accountId === accountId);
  const coinHref = mine ? `/coin/${mine.coin_id}` : "/";
  const dead = mine?.status === "dead";
  const steps = [
    { done: Boolean(accountId) && (hasBalance || receipts.some((row) => row.kind === "faucet")), id: "faucet" },
    { done: launched, id: "launch" },
    { done: fed, id: "feed" },
    { done: exited, id: "exit" },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <div className="start-guide" id="cycle">
      <header className="section-head">
        <p className="eyebrow on-light">Try one cycle</p>
        <h1>One coin, from faucet to farewell</h1>
        <p>
          Four steps, with the cost written down before you start. The walkthrough uses {CYCLE_SEED_USDC} tUSDC to launch and {CYCLE_FEED_USDC} tUSDC to feed.
          The faucet hands out {FAUCET_USDC} tUSDC, so one mint covers the whole cycle. tUSDC is play money.
        </p>
      </header>

      <div className="card cycle-costs">
        <h2>What this cycle spends</h2>
        <dl>
          <div>
            <dt>Faucet</dt>
            <dd>{FAUCET_USDC} tUSDC, once a minute. First tap also spends 0.00125 NEAR to register.</dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>
              {CYCLE_SEED_USDC} tUSDC seed (minimum {minSeed}). Plus 0.06 NEAR of factory storage. No launch fee. Timer starts at {life}.
            </dd>
          </div>
          <div>
            <dt>Feed</dt>
            <dd>
              At least {minFeed} tUSDC. This factory adds {perUsdc} of life per USDC, up to a cap of {capMin}–{capMax}. A 1% fee is split between the bowl, the protocol, and the creator.
            </dd>
          </div>
          <div>
            <dt>Sell or claim</dt>
            <dd>
              Sell any time the coin is alive. The payout slides toward a pro-rata share as it gets hungry, then a 1% fee, with a 2% minimum. A claim waits until death: about {life} after launch if nobody feeds it again. The creator&apos;s seed claim is cut in half. Bought tokens are not.
            </dd>
          </div>
        </dl>
        {params ? (
          <p className="hint ok">Those times are read from {config.factoryAccountId}. Timer controls are {params.allow_demo_controls ? "on" : "off"}.</p>
        ) : paramsFailed ? (
          <p className="hint">The factory view did not load. The times above are the public plan: 30 minutes of life, 60 seconds per USDC, and a 1–3 hour cap, with timer controls off.</p>
        ) : (
          <p className="hint">Times show the public factory plan (30 minutes, 60 seconds per USDC, 1–3 hour cap) until the factory view loads.</p>
        )}
      </div>

      <ol className="stepper">
        <li className={steps[0].done ? "is-done" : current === 0 ? "is-current" : ""} aria-current={current === 0 ? "step" : undefined}>
          <span className="step-index">{steps[0].done ? "✓" : "1"}</span>
          <div className="card step-body">
            <h2>Take {FAUCET_USDC} tUSDC</h2>
            <p>
              Connect a testnet wallet, then use the faucet. You need about {Number(CYCLE_SEED_USDC) + Number(CYCLE_FEED_USDC)} tUSDC for the steps below. The faucet gives {FAUCET_USDC}, and it only mints once a minute. The first call registers your account for 0.00125 NEAR and mints in the same approval.
            </p>
            {accountId ? (
              <p className="hint ok">Connected as {shortAccount(accountId)}.</p>
            ) : (
              <>
                <p>Meteor, MyNearWallet, HOT, or Intear, with the network set to testnet. A free account from <a href="https://testnet.mynearwallet.com/" target="_blank" rel="noreferrer">MyNearWallet testnet</a> is enough, and it usually arrives with a little NEAR for storage.</p>
                <button type="button" className="solid" disabled={!ready} onClick={connect}>
                  {ready ? "Connect wallet" : "Loading wallets…"}
                </button>
              </>
            )}
            {isTestnet ? (
              <>
                <FaucetButton detailed />
                {registered === false && accountId ? <p className="hint">This account is not on tUSDC yet. The button registers it and mints together.</p> : null}
              </>
            ) : (
              <p>The faucet exists only on the testnet token. This app is pointed at mainnet.</p>
            )}
          </div>
        </li>

        <li className={steps[1].done ? "is-done" : current === 1 ? "is-current" : ""} aria-current={current === 1 ? "step" : undefined}>
          <span className="step-index">{steps[1].done ? "✓" : "2"}</span>
          <div className="card step-body">
            <h2>Launch with {CYCLE_SEED_USDC} tUSDC</h2>
            <p>
              The seed becomes the whole pool. There is no launch fee. You receive claim-only seed tokens, and the timer starts at {life}. Factory storage is 0.06 NEAR, paid once. The minimum seed on this factory is {minSeed} tUSDC. The form is filled with {CYCLE_SEED_USDC}.
            </p>
            <div className="action-row">
              <Link className="solid" href={`/launch?seed=${CYCLE_SEED_USDC}`}>
                Launch a coin
              </Link>
            </div>
            {mine ? (
              <p className="hint ok">
                Your latest coin is {mine.symbol}. {dead ? "It is already in the graveyard." : `${formatDuration(BigInt(mine.remaining_ns))} left.`}
              </p>
            ) : (
              <div className="inline-note">
                <Pet mood="hungry" size="sm" />
                <p>If the alive list is empty, that is normal. Launch this one and it shows up while the timer is still running.</p>
              </div>
            )}
          </div>
        </li>

        <li className={steps[2].done ? "is-done" : current === 2 ? "is-current" : ""} aria-current={current === 2 ? "step" : undefined}>
          <span className="step-index">{steps[2].done ? "✓" : "3"}</span>
          <div className="card step-body">
            <h2>Feed it with {CYCLE_FEED_USDC} tUSDC</h2>
            <p>
              Buying is feeding. {CYCLE_FEED_USDC} tUSDC adds about {perUsdc} on this factory, as long as your feeding bucket is not full. Buys under {minFeed} tUSDC can still mint tokens, but they do not add time. The coin page shows the tokens, the fee split, and the 2% minimum before the wallet opens.
            </p>
            <div className="action-row">
              <Link className="solid" href={coinHref}>
                {mine ? `Feed ${mine.symbol}` : "Open the bowl"}
              </Link>
            </div>
            {position && BigInt(position.balance || "0") > 0n ? <p className="hint ok">You already hold tradable tokens on this coin.</p> : null}
          </div>
        </li>

        <li className={steps[3].done ? "is-done" : current === 3 ? "is-current" : ""} aria-current={current === 3 ? "step" : undefined}>
          <span className="step-index">{steps[3].done ? "✓" : "4"}</span>
          <div className="card step-body">
            <h2>Sell while it lives, or claim after it rests</h2>
            <p>
              A sale pays the hunger-adjusted amount, then takes a 1% fee. It never pays more than the curve and never less than a pro-rata share. The confirm step shows both numbers and the 2% minimum.
            </p>
            <p>
              A claim is only available after death. If you launch and do not feed again, that is about {life} from the start. Feeding stretches it, up to the {capMin}–{capMax} cap. Holders split what is left. That is not a refund. If you are the creator, the seed portion of the claim is cut in half and the other half goes to the protocol.
            </p>
            <div className="action-row">
              <Link className="solid" href={coinHref}>
                {dead ? "Claim the pool" : mine ? "Sell or wait" : "Open your coin"}
              </Link>
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}
