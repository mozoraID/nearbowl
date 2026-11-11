import { CoinArt } from "@/components/CoinArt";
import { TimeRing } from "@/components/TimeRing";
import { formatAgo, formatDuration, formatUsdc, marketCapRaw, moodLabel, petMood, shortAccount } from "@/lib/format";
import type { CoinView, TradeView } from "@/lib/types";
import Link from "next/link";

export function CoinCard({
  coin,
  remaining,
  last,
  nowMs,
}: {
  coin: CoinView;
  remaining: bigint;
  last: TradeView | null | undefined;
  nowMs: number;
}) {
  const dead = coin.status === "dead" || remaining === 0n;
  const mood = petMood(coin.status, coin.w_n, remaining === 0n && coin.status !== "dead");
  const pool = coin.status === "dead" ? coin.snapshot_reserve : coin.reserve;
  const cap = BigInt(coin.max_life_ns || "0");
  return (
    <Link href={`/coin/${coin.coin_id}`} className={`card coin-card${dead ? " is-dead" : ""}`}>
      <div className="coin-top">
        <CoinArt imageUri={coin.image_uri} mood={mood} size="sm" alt={coin.name} />
        <div className="coin-name">
          <div className="symbol">{coin.symbol}</div>
          <h3>{coin.name}</h3>
          <span className={`mood mood-${mood}`}>{moodLabel(mood)}</span>
        </div>
        {dead ? null : <TimeRing remaining={remaining} cap={cap} />}
      </div>
      {dead ? (
        <>
          <p className="epitaph">
            Lived {formatDuration(BigInt(coin.deadline_ns) > BigInt(coin.launched_ns) ? BigInt(coin.deadline_ns) - BigInt(coin.launched_ns) : 0n)}. Left {formatUsdc(pool, 2)} USDC. Fed by {coin.feeders_count}.
          </p>
          <p className="hint">
            {last === undefined
              ? "Loading last trade…"
              : last === null
                ? "No trades recorded"
                : `Last trade ${last.side === "buy" ? "buy" : "sell"} ${formatUsdc(last.usdc, 2)} · ${shortAccount(last.account_id)}`}
          </p>
        </>
      ) : (
        <dl className="card-stats">
          <div>
            <dt>Time left</dt>
            <dd>{formatDuration(remaining)}</dd>
          </div>
          <div>
            <dt>Reserve</dt>
            <dd>{formatUsdc(pool, 2)}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>{formatUsdc(coin.price, 4)}</dd>
          </div>
          <div>
            <dt>Mkt cap</dt>
            <dd>{formatUsdc(marketCapRaw(pool), 2)}</dd>
          </div>
          <div className="stat-wide">
            <dt>Last trade</dt>
            <dd>
              {last === undefined
                ? "Loading…"
                : last === null
                  ? "No trades yet"
                  : `${last.side === "buy" ? "Buy" : "Sell"} ${formatUsdc(last.usdc, 2)} · ${shortAccount(last.account_id)} · ${formatAgo(last.ts, nowMs) || "just now"}`}
            </dd>
          </div>
        </dl>
      )}
    </Link>
  );
}
