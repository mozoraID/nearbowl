"use client";

import { CoinCard } from "@/components/CoinCard";
import { Guide } from "@/components/Guide";
import { Pet } from "@/components/Pet";
import { config } from "@/lib/config";
import { countBeyondFirstPage, getConfig, getRecentTrades, getSolvency, listCoins, mapPool } from "@/lib/factory";
import { humanError } from "@/lib/errors";
import { compareBig, formatCount, formatDuration, formatUsdcStat } from "@/lib/format";
import type { CoinView, ParamsView, SolvencyView, TradeView } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Tab = "alive" | "dead";
type Sort = "time" | "pool" | "volume" | "recent";
type Count = { value: number; capped: boolean };

function Hero() {
  return (
    <section className="hero-band">
      <div className="page hero-grid">
        <div>
          <p className="eyebrow">Feed it, or it dies.</p>
          <h1>A pet that lives on USDC.</h1>
          <p className="lede">Feed it by buying. If the timer hits zero, holders split whatever USDC is left in the bowl.</p>
          <div className="hero-actions">
            <Link className="solid" href="/demo">
              Try the demo
            </Link>
            <Link className="ghost on-dark" href="/launch">
              Launch a coin
            </Link>
          </div>
          <a className="text-link" href="#how">
            How it works
          </a>
        </div>
        <div className="hero-pet">
          <Pet mood="happy" size="lg" />
        </div>
      </div>
    </section>
  );
}

function liveRemaining(coin: CoinView, syncedAt: number, now: number): bigint {
  if (coin.status === "dead") return 0n;
  const drift = BigInt(Math.max(0, now - syncedAt)) * 1_000_000n;
  const base = BigInt(coin.remaining_ns || "0");
  return base > drift ? base - drift : 0n;
}

export function Explore() {
  const [tab, setTab] = useState<Tab>("alive");
  const [sort, setSort] = useState<Sort>("time");
  const [alive, setAlive] = useState<CoinView[] | null>(null);
  const [dead, setDead] = useState<CoinView[] | null>(null);
  const [aliveCount, setAliveCount] = useState<Count | null>(null);
  const [deadCount, setDeadCount] = useState<Count | null>(null);
  const [solvency, setSolvency] = useState<SolvencyView | null>(null);
  const [params, setParams] = useState<ParamsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [lastTrades, setLastTrades] = useState<Record<string, TradeView | null>>({});
  const rowsRef = useRef<CoinView[]>([]);
  const hasData = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const [aliveResult, deadResult, solvencyResult] = await Promise.allSettled([listCoins("alive"), listCoins("dead"), getSolvency()]);
      if (stop) return;
      const aliveOk = aliveResult.status === "fulfilled";
      const deadOk = deadResult.status === "fulfilled";
      if (!aliveOk && !deadOk) {
        const reason = aliveResult.status === "rejected" ? aliveResult.reason : deadResult.status === "rejected" ? deadResult.reason : "Network error";
        if (!hasData.current) setError(humanError(reason));
        else setStale("The latest read failed. Showing the last list.");
        return;
      }
      if (!aliveOk || !deadOk) setStale("Part of the factory list did not load.");
      const stamp = Date.now();
      if (aliveOk) setAlive(aliveResult.value);
      if (deadOk) setDead(deadResult.value);
      if (solvencyResult.status === "fulfilled") setSolvency(solvencyResult.value);
      setSyncedAt(stamp);
      setNow(stamp);
      if (aliveOk || deadOk) hasData.current = true;
      if (aliveOk && deadOk) {
        setError(null);
        setStale(null);
      } else {
        setError(null);
      }
      if (aliveOk) {
        void countBeyondFirstPage("alive", aliveResult.value.length)
          .then((count) => {
            if (!stop) setAliveCount(count);
          })
          .catch(() => {
            if (!stop) setAliveCount({ value: aliveResult.value.length, capped: aliveResult.value.length >= 50 });
          });
      }
      if (deadOk) {
        void countBeyondFirstPage("dead", deadResult.value.length)
          .then((count) => {
            if (!stop) setDeadCount(count);
          })
          .catch(() => {
            if (!stop) setDeadCount({ value: deadResult.value.length, capped: deadResult.value.length >= 50 });
          });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    getConfig()
      .then((configView) => {
        if (!stop) setParams(configView.params);
      })
      .catch(() => {
        if (!stop) setParams(null);
      });
    return () => {
      stop = true;
    };
  }, []);

  const shown = tab === "alive" ? alive : dead;
  const graveyardPreview = tab === "alive" && alive && alive.length === 0 ? (dead ?? []).slice(0, 6) : [];
  const visible = graveyardPreview.length > 0 ? graveyardPreview : (shown ?? []);
  const tradeSignature = visible.map((coin) => `${coin.coin_id}:${coin.trade_count}`).join("|");
  rowsRef.current = visible;

  useEffect(() => {
    const rows = rowsRef.current;
    if (rows.length === 0) return;
    let stop = false;
    void mapPool(rows, 6, async (coin) => {
      try {
        const trades = await getRecentTrades(coin.coin_id);
        return [coin.coin_id, trades[0] ?? null] as const;
      } catch {
        return [coin.coin_id, null] as const;
      }
    }).then((pairs) => {
      if (stop) return;
      setLastTrades((current) => {
        const next = { ...current };
        for (const [id, trade] of pairs) next[id] = trade;
        return next;
      });
    });
    return () => {
      stop = true;
    };
  }, [tradeSignature]);

  const sortOptions: [Sort, string][] =
    tab === "alive"
      ? [
          ["time", "Time left"],
          ["pool", "Reserve"],
          ["volume", "Volume"],
        ]
      : [
          ["recent", "Newest"],
          ["pool", "Reserve"],
          ["volume", "Volume"],
        ];
  const activeSort = sortOptions.some(([value]) => value === sort) ? sort : sortOptions[0][0];

  const sorted = useMemo(() => {
    const rows = [...(shown ?? [])];
    rows.sort((a, b) => {
      if (activeSort === "pool") {
        const pool = (coin: CoinView) => (coin.status === "dead" ? coin.snapshot_reserve : coin.reserve);
        return compareBig(pool(b), pool(a));
      }
      if (activeSort === "volume") return compareBig(b.volume_usdc, a.volume_usdc);
      if (activeSort === "recent") return compareBig(b.deadline_ns, a.deadline_ns);
      const left = liveRemaining(a, syncedAt, now);
      const right = liveRemaining(b, syncedAt, now);
      if (left === right) return 0;
      return left < right ? -1 : 1;
    });
    return rows;
  }, [shown, activeSort, syncedAt, now]);

  const lifeLabel = params ? formatDuration(BigInt(params.initial_life_ns)) : null;
  const loading = alive === null && dead === null && !error;

  return (
    <>
      <Hero />
      <div className="page home-rest">
        <div className="stats-wrap">
          {loading ? (
            <div className="stats-strip" aria-busy="true" aria-label="Loading factory stats">
              <div className="skeleton stat-skeleton" />
              <div className="skeleton stat-skeleton" />
              <div className="skeleton stat-skeleton" />
            </div>
          ) : (
            <dl className="stats-strip">
              <div className="stat">
                <dt>Alive</dt>
                <dd>{aliveCount ? formatCount(aliveCount.value, aliveCount.capped) : alive ? String(alive.length) : "—"}</dd>
              </div>
              <div className="stat">
                <dt>Graveyard</dt>
                <dd>{deadCount ? formatCount(deadCount.value, deadCount.capped) : dead ? String(dead.length) : "—"}</dd>
              </div>
              <div className="stat">
                <dt>USDC in bowls</dt>
                <dd>{solvency ? formatUsdcStat(solvency.reserves) : "—"}</dd>
              </div>
            </dl>
          )}
        </div>

        <section id="coins" className="section">
          <div className="section-head">
            <h2>In the bowl</h2>
            <p>Alive coins still have time. The graveyard is every coin whose timer already hit zero.</p>
          </div>
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Coin lists">
              <button type="button" role="tab" aria-selected={tab === "alive"} onClick={() => setTab("alive")}>
                Alive
              </button>
              <button type="button" role="tab" aria-selected={tab === "dead"} onClick={() => setTab("dead")}>
                Graveyard
              </button>
            </div>
            <label className="sort-label">
              Sort
              <select value={activeSort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort coins">
                {sortOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {stale ? <p className="hint warn">{stale}</p> : null}
          {error ? (
            <div className="card error-card" role="alert">
              <h3>The factory list did not load</h3>
              <p>{error}</p>
              <p className="hint">Factory account {config.factoryAccountId}. If it is not deployed yet, the list stays empty until it is.</p>
            </div>
          ) : null}
          {loading ? (
            <div className="grid" aria-busy="true" aria-label="Loading coins">
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
            </div>
          ) : null}
          {!error && tab === "alive" && alive && alive.length === 0 ? (
            <div className="card empty-hero">
              <Pet mood="hungry" size="md" />
              <div>
                <h3>Nothing is alive right now.</h3>
                <p>
                  {lifeLabel
                    ? `Each coin on this factory starts with ${lifeLabel} of life, so pets reach the graveyard quickly. Launch one and feed it before the timer runs out.`
                    : "Launch one and feed it before the timer runs out."}
                </p>
                <Link className="solid" href="/launch">
                  Launch the first one
                </Link>
              </div>
            </div>
          ) : null}
          {!error && tab === "alive" && alive && alive.length === 0 && dead && dead.length > 0 ? (
            <>
              <h3 className="subhead">Recent graveyard</h3>
              <div className="grid">
                {dead.slice(0, 6).map((coin) => (
                  <CoinCard key={coin.coin_id} coin={coin} remaining={0n} last={lastTrades[coin.coin_id]} nowMs={now} />
                ))}
              </div>
            </>
          ) : null}
          {!error && tab === "dead" && dead === null && alive !== null ? (
            <div className="card error-card" role="alert">
              <h3>The graveyard did not load</h3>
              <p>The alive list came back, but the dead-coin view did not. Try again in a moment.</p>
            </div>
          ) : null}
          {!error && tab === "dead" && dead && dead.length === 0 ? (
            <div className="card empty-hero">
              <Pet mood="dead" size="md" />
              <div>
                <h3>The yard is quiet.</h3>
                <p>Nothing has passed yet. The first coin to run out of time will rest here.</p>
                <Link className="solid" href="/launch">
                  Launch a coin
                </Link>
              </div>
            </div>
          ) : null}
          {!error && sorted.length > 0 && !(tab === "alive" && alive && alive.length === 0) ? (
            <div className="grid">
              {sorted.map((coin) => (
                <CoinCard
                  key={coin.coin_id}
                  coin={coin}
                  remaining={liveRemaining(coin, syncedAt, now)}
                  last={lastTrades[coin.coin_id]}
                  nowMs={now}
                />
              ))}
            </div>
          ) : null}
        </section>
        <Guide params={params} />
      </div>
    </>
  );
}
