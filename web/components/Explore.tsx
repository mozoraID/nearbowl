"use client";

import { Pet } from "@/components/Pet";
import { config } from "@/lib/config";
import { formatDuration, formatUsdc, hungerPercent, lifespan } from "@/lib/format";
import { humanError } from "@/lib/errors";
import { view } from "@/lib/near";
import type { CoinView } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Tab = "alive" | "dead";
type Sort = "time" | "pool" | "volume";

export function Explore() {
  const [tab, setTab] = useState<Tab>("alive");
  const [sort, setSort] = useState<Sort>("time");
  const [coins, setCoins] = useState<CoinView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => {
      view<CoinView[]>(config.factoryAccountId, "list_coins", { status: tab, from_index: 0, limit: 50 })
        .then((rows) => {
          if (!stop) {
            setCoins(rows);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!stop) setError(humanError(err));
        });
    };
    setCoins(null);
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [tab]);

  const sorted = useMemo(() => {
    const rows = [...(coins ?? [])];
    rows.sort((a, b) => {
      if (sort === "pool") return Number(BigInt(b.reserve) - BigInt(a.reserve));
      if (sort === "volume") return Number(BigInt(b.volume_usdc) - BigInt(a.volume_usdc));
      return Number(BigInt(a.remaining_ns) - BigInt(b.remaining_ns));
    });
    return rows;
  }, [coins, sort]);

  return (
    <>
      <section className="hero">
        <div>
          <h2>A pet that lives on USDC.</h2>
          <p className="lede">Feed it or it dies; when it dies, the pool is split. Buying feeds the timer. Selling gets harder as the bowl runs empty.</p>
        </div>
        <div className="card" style={{ display: "flex", justifyContent: "center" }}>
          <Pet mood="fed" />
        </div>
      </section>
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Coin lists">
          <button role="tab" aria-selected={tab === "alive"} onClick={() => setTab("alive")}>Alive</button>
          <button role="tab" aria-selected={tab === "dead"} onClick={() => setTab("dead")}>Graveyard</button>
        </div>
        {tab === "alive" && (
          <label>
            <span className="hint">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort coins">
              <option value="time">Time left</option>
              <option value="pool">Pool</option>
              <option value="volume">Recent volume</option>
            </select>
          </label>
        )}
      </div>
      {error && (
        <div className="card error" role="alert">
          <p>{error}</p>
          <p className="hint">If the factory is not deployed yet, the list stays empty until it is.</p>
        </div>
      )}
      {!error && coins === null && (
        <div className="grid" aria-busy="true" aria-label="Loading coins">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {!error && coins && sorted.length === 0 && (
        <div className="card empty">
          <Pet mood={tab === "dead" ? "dead" : "hungry"} />
          <h3>{tab === "dead" ? "The yard is quiet." : "No pets in the bowl yet."}</h3>
          <p className="hint">{tab === "dead" ? "Nothing has passed." : "Launch the first coin and give it a name."}</p>
        </div>
      )}
      <div className="grid">
        {sorted.map((coin) => (
          <Link key={coin.coin_id} href={`/coin/${coin.coin_id}`} className={`card pet-card ${coin.status === "dead" ? "tomb" : ""}`}>
            <header>
              <div>
                <div className="symbol">{coin.symbol}</div>
                <h3>{coin.name}</h3>
              </div>
              <span className={`mood ${coin.status}`}>{coin.status === "fed" ? "Fed" : coin.status === "hungry" ? "Hungry" : "Gone"}</span>
            </header>
            <Pet mood={coin.status} />
            {coin.status === "dead" ? (
              <p className="epitaph">Lived {lifespan(coin.launched_ns, coin.deadline_ns)}. Left {formatUsdc(coin.snapshot_reserve || coin.reserve)} USDC. Fed by {coin.feeders_count}.</p>
            ) : (
              <>
                <div className={`meter ${coin.status === "hungry" ? "hungry" : ""}`} aria-hidden="true">
                  <span style={{ width: `${100 - hungerPercent(coin.w_n)}%` }} />
                </div>
                <div className="stats">
                  <span>Time left <b>{formatDuration(BigInt(coin.remaining_ns))}</b></span>
                  <span>Hunger <b>{hungerPercent(coin.w_n)}%</b></span>
                  <span>Pool <b>{formatUsdc(coin.reserve)}</b></span>
                  <span>Feeders <b>{coin.feeders_count}</b></span>
                </div>
              </>
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
