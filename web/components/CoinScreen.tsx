"use client";

import { FaucetButton } from "@/components/FaucetButton";
import { Pet } from "@/components/Pet";
import { useWallet } from "@/components/Wallet";
import { config, TRADE_STORAGE_YOCTO, USDC_STORAGE_YOCTO } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { formatDuration, formatTokens, formatUsdc, hungerPercent, lifespan, parseTokenFraction, parseUsdc } from "@/lib/format";
import { view } from "@/lib/near";
import type { CoinView, PositionView, QuoteBuy, QuoteClaim, QuoteSell, StorageView, TradeView } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

export function CoinScreen({ id }: { id: string }) {
  const { accountId, call, connect } = useWallet();
  const [coin, setCoin] = useState<CoinView | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [buyAmount, setBuyAmount] = useState("10");
  const [sellPercent, setSellPercent] = useState(100);
  const [buyQuote, setBuyQuote] = useState<QuoteBuy | null>(null);
  const [sellQuote, setSellQuote] = useState<QuoteSell | null>(null);
  const [claimQuote, setClaimQuote] = useState<QuoteClaim | null>(null);
  const [remaining, setRemaining] = useState(0n);
  const [pulse, setPulse] = useState(false);
  const seenDeadline = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => {
      view<CoinView>(config.factoryAccountId, "get_coin", { coin_id: Number(id) })
        .then((next) => {
          if (stop) return;
          setCoin(next);
          setError(null);
          const prev = seenDeadline.current;
          if (prev && BigInt(next.deadline_ns) > BigInt(prev)) {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 800);
          }
          seenDeadline.current = next.deadline_ns;
        })
        .catch((err: unknown) => {
          if (!stop) setError(humanError(err));
        });
      view<TradeView[]>(config.factoryAccountId, "get_recent_trades", { coin_id: Number(id) })
        .then((rows) => {
          if (!stop) setTrades(rows);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!coin) return;
    setRemaining(BigInt(coin.remaining_ns));
    const started = Date.now();
    const base = BigInt(coin.remaining_ns);
    const timer = window.setInterval(() => {
      const elapsed = BigInt(Date.now() - started) * 1_000_000n;
      setRemaining(base > elapsed ? base - elapsed : 0n);
    }, 250);
    return () => window.clearInterval(timer);
  }, [coin]);

  useEffect(() => {
    if (!accountId) {
      setPosition(null);
      return;
    }
    view<PositionView>(config.factoryAccountId, "get_position", { coin_id: Number(id), account_id: accountId })
      .then(setPosition)
      .catch(() => setPosition(null));
  }, [accountId, id, coin?.supply]);

  useEffect(() => {
    if (!coin || coin.status === "dead") {
      setBuyQuote(null);
      return;
    }
    const raw = parseUsdc(buyAmount);
    if (!raw || raw === "0") {
      setBuyQuote(null);
      return;
    }
    const handle = window.setTimeout(() => {
      view<QuoteBuy>(config.factoryAccountId, "quote_buy", {
        coin_id: Number(id),
        usdc_in: raw,
        account_id: accountId ?? config.factoryAccountId,
      })
        .then(setBuyQuote)
        .catch(() => setBuyQuote(null));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [buyAmount, coin, id, accountId]);

  useEffect(() => {
    if (!coin || coin.status === "dead" || !position || position.balance === "0") {
      setSellQuote(null);
      return;
    }
    const tokens = parseTokenFraction(position.balance, sellPercent);
    if (tokens === "0") {
      setSellQuote(null);
      return;
    }
    view<QuoteSell>(config.factoryAccountId, "quote_sell", { coin_id: Number(id), tokens_in: tokens })
      .then(setSellQuote)
      .catch(() => setSellQuote(null));
  }, [coin, id, position, sellPercent, remaining]);

  useEffect(() => {
    if (!accountId) return;
    view<QuoteClaim>(config.factoryAccountId, "quote_claim", { coin_id: Number(id), account_id: accountId })
      .then(setClaimQuote)
      .catch(() => setClaimQuote(null));
  }, [accountId, id, coin?.status, coin?.reserve]);

  async function ensureReady() {
    if (!accountId) {
      connect();
      throw new Error("Connect a wallet first.");
    }
    const usdcStorage = await view<StorageView | null>(config.usdcAccountId, "storage_balance_of", { account_id: accountId });
    if (!usdcStorage) {
      await call(config.usdcAccountId, "storage_deposit", { account_id: accountId }, USDC_STORAGE_YOCTO, "40000000000000");
      throw new Error("Registered on USDC. Try the trade again in a moment.");
    }
    const factoryStorage = await view<StorageView | null>(config.factoryAccountId, "storage_balance_of", { account_id: accountId });
    if (!factoryStorage || BigInt(factoryStorage.available) < 2_000_000_000_000_000_000_000n) {
      await call(config.factoryAccountId, "storage_deposit", {}, TRADE_STORAGE_YOCTO, "40000000000000");
      throw new Error("Deposited storage for your position. Try the trade again in a moment.");
    }
  }

  async function buy() {
    const raw = parseUsdc(buyAmount);
    if (!raw) {
      setNotice("Enter a USDC amount with up to 6 decimals.");
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      await ensureReady();
      const quote = await view<QuoteBuy>(config.factoryAccountId, "quote_buy", {
        coin_id: Number(id),
        usdc_in: raw,
        account_id: accountId,
      });
      const minOut = (BigInt(quote.tokens_out) * 98n) / 100n;
      await call(
        config.usdcAccountId,
        "ft_transfer_call",
        {
          receiver_id: config.factoryAccountId,
          amount: raw,
          memo: null,
          msg: JSON.stringify({ action: "buy", coin_id: id, min_tokens_out: minOut.toString() }),
        },
        "1",
        "200000000000000",
      );
      setNotice(`Fed. About ${formatTokens(quote.tokens_out)} tokens and ${formatDuration(BigInt(quote.extension_ns))} added, if the quote held.`);
    } catch (err) {
      setNotice(humanError(err));
    } finally {
      setPending(false);
    }
  }

  async function sell() {
    if (!position) return;
    const tokens = parseTokenFraction(position.balance, sellPercent);
    setPending(true);
    setNotice(null);
    try {
      await ensureReady();
      const quote = await view<QuoteSell>(config.factoryAccountId, "quote_sell", { coin_id: Number(id), tokens_in: tokens });
      const minOut = (BigInt(quote.usdc_out_net) * 98n) / 100n;
      await call(
        config.factoryAccountId,
        "sell",
        { coin_id: Number(id), tokens_in: tokens, min_usdc_out: minOut.toString() },
        "1",
        "80000000000000",
      );
      setNotice("Sale sent. USDC arrives after the transfer confirms.");
    } catch (err) {
      setNotice(humanError(err));
    } finally {
      setPending(false);
    }
  }

  async function claim() {
    setPending(true);
    setNotice(null);
    try {
      if (!accountId) {
        connect();
        return;
      }
      await call(config.factoryAccountId, "claim", { coin_id: Number(id) }, "1", "80000000000000");
      setNotice("Claim sent. This is a share of what is left in the pool, not a refund.");
    } catch (err) {
      setNotice(humanError(err));
    } finally {
      setPending(false);
    }
  }

  async function withdrawFees() {
    setPending(true);
    setNotice(null);
    try {
      await call(config.factoryAccountId, "withdraw_creator_fees", { coin_id: Number(id) }, "1", "80000000000000");
      setNotice("Fee withdrawal sent.");
    } catch (err) {
      setNotice(humanError(err));
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return <div className="card error" role="alert"><p>{error}</p></div>;
  }
  if (!coin) {
    return <div className="skeleton" aria-busy="true" aria-label="Loading coin" />;
  }

  const locallyDead = coin.status === "dead" || remaining === 0n;
  const mood = locallyDead ? "dead" : coin.w_n === 0 ? "fed" : "hungry";
  const fullness = locallyDead ? 0 : 100 - hungerPercent(coin.w_n);

  return (
    <div className="split">
      <section className="card">
        <div className="coin-head">
          <div>
            <div className="symbol">{coin.symbol}</div>
            <h2>{coin.name}</h2>
            <p className="hint">by {coin.creator_id}</p>
          </div>
          <Pet mood={mood} pulse={pulse} />
        </div>
        <div className="timer-row">
          <span className={`mood ${mood}`}>{mood === "fed" ? "Fed" : mood === "hungry" ? "Hungry" : "Gone"}</span>
          <strong>{locallyDead ? "0s" : formatDuration(remaining)}</strong>
        </div>
        <div className={`meter ${mood === "hungry" ? "hungry" : ""}`} role="meter" aria-valuenow={fullness} aria-valuemin={0} aria-valuemax={100} aria-label="How full the bowl is">
          <span style={{ width: `${fullness}%` }} />
        </div>
        <div className="stats" style={{ marginTop: 12 }}>
          <span>Price <b className="price">{formatUsdc(coin.price)}</b></span>
          <span>Pool <b>{formatUsdc(locallyDead ? coin.snapshot_reserve || coin.reserve : coin.reserve)} USDC</b></span>
          <span>Supply <b>{formatTokens(coin.supply)}</b></span>
          <span>Hunger <b>{locallyDead ? "100" : hungerPercent(coin.w_n)}%</b></span>
          <span>Feeders <b>{coin.feeders_count}</b></span>
          <span>Cap <b>{formatDuration(BigInt(coin.max_life_ns))}</b></span>
        </div>
        {locallyDead && (
          <p className="epitaph">Lived {lifespan(coin.launched_ns, coin.deadline_ns)}. A share of what is left in the pool, not a refund.</p>
        )}
      </section>

      <section className="trade-grid">
        {!locallyDead && (
          <form className="card form" onSubmit={(event) => { event.preventDefault(); void buy(); }}>
            <h3>Feed</h3>
            <label>
              USDC
              <input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} />
            </label>
            <div className="quote" aria-live="polite">
              {buyQuote ? (
                <>
                  <div>You receive about <b>{formatTokens(buyQuote.tokens_out)}</b> tokens</div>
                  <div>Adds <b>{formatDuration(BigInt(buyQuote.extension_ns))}</b> · timer becomes {formatDuration(BigInt(buyQuote.new_remaining_ns))}</div>
                </>
              ) : (
                <span className="hint">Enter an amount of at least 1 USDC to feed the timer.</span>
              )}
            </div>
            <FaucetButton />
            <button className="solid" disabled={pending} type="submit">{pending ? "Sending…" : accountId ? "Buy" : "Connect to buy"}</button>
          </form>
        )}

        {!locallyDead && (
          <form className="card form" onSubmit={(event) => { event.preventDefault(); void sell(); }}>
            <h3>Sell</h3>
            <p className="hint">Balance {position ? formatTokens(position.balance) : "—"}</p>
            <div className="row-buttons">
              {[25, 50, 100].map((percent) => (
                <button type="button" key={percent} className={sellPercent === percent ? "solid" : "ghost"} onClick={() => setSellPercent(percent)}>
                  {percent}%
                </button>
              ))}
            </div>
            <div className="quote" aria-live="polite">
              {sellQuote ? (
                <>
                  <div>Hunger {(sellQuote.w_n / 64).toFixed(3)} · you receive <b>{formatUsdc(sellQuote.usdc_out_net)} USDC</b></div>
                  <div className="hint">Curve {formatUsdc(sellQuote.curve_value)} · pro-rata {formatUsdc(sellQuote.prorata_value)}</div>
                </>
              ) : (
                <span className="hint">Buy some tokens before selling.</span>
              )}
            </div>
            <button className="solid" disabled={pending || !sellQuote} type="submit">Sell</button>
          </form>
        )}

        {locallyDead && (
          <div className="card form">
            <h3>Claim</h3>
            <p>A share of what is left in the pool, not a refund.</p>
            <div className="quote">
              {claimQuote ? (
                <>
                  <div>You would receive <b>{formatUsdc(claimQuote.usdc_out)} USDC</b></div>
                  {claimQuote.haircut !== "0" && <div className="hint">Haircut to the protocol {formatUsdc(claimQuote.haircut)} USDC</div>}
                </>
              ) : (
                <span className="hint">Connect to see your share.</span>
              )}
            </div>
            <button className="solid" disabled={pending} onClick={() => void claim()}>Claim</button>
          </div>
        )}

        {accountId && accountId === coin.creator_id && (
          <div className="card">
            <h3>Creator fees</h3>
            <p>{formatUsdc(coin.creator_fees_owed)} USDC ready to withdraw.</p>
            <p className="hint">Seed tokens still claim-only: {formatTokens(coin.seed_tokens)}</p>
            <button className="ghost" disabled={pending || coin.creator_fees_owed === "0"} onClick={() => void withdrawFees()}>
              Withdraw fees
            </button>
          </div>
        )}
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h3>Last trades</h3>
        {trades.length === 0 && <p className="hint">No trades yet. The first feed will show up here.</p>}
        <div className="trades">
          {trades.map((trade, index) => (
            <div className="trade" key={`${trade.ts}-${index}`}>
              <span className={`pill ${trade.side}`}>{trade.side}</span>
              <span>{trade.account_id}</span>
              <span>{formatUsdc(trade.usdc)} USDC{trade.side === "buy" && trade.ext_s > 0 ? ` · +${trade.ext_s}s` : ""}</span>
            </div>
          ))}
        </div>
        {notice && <p className="hint" role="status">{notice}</p>}
      </section>
    </div>
  );
}
