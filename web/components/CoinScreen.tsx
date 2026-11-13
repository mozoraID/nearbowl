"use client";

import { FaucetButton } from "@/components/FaucetButton";
import { CoinArt } from "@/components/CoinArt";
import { ReviewCard } from "@/components/ReviewCard";
import { TimeRing } from "@/components/TimeRing";
import { useToast } from "@/components/Toast";
import { useWallet } from "@/components/Wallet";
import { config, TRADE_STORAGE_YOCTO, USDC_STORAGE_YOCTO } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { accountUrl, txUrl } from "@/lib/explorer";
import {
  formatAgo,
  formatDuration,
  formatTokens,
  formatUsdc,
  hungerPercent,
  lifespan,
  marketCapRaw,
  moodLabel,
  parseTokenFraction,
  parseUsdc,
  petMood,
  shortAccount,
} from "@/lib/format";
import { view } from "@/lib/near";
import { matchTrade, useReceipts } from "@/lib/receipts";
import { applySlippage, slippageLabel } from "@/lib/trade";
import type { CoinView, PositionView, QuoteBuy, QuoteClaim, QuoteSell, StorageView, TradeView } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export function CoinScreen({ id }: { id: string }) {
  const coinId = Number(id);
  const validId = Number.isInteger(coinId) && coinId >= 0;
  const { accountId, call, connect } = useWallet();
  const push = useToast();
  const receipts = useReceipts();
  const [coin, setCoin] = useState<CoinView | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [buyAmount, setBuyAmount] = useState("10");
  const [sellPercent, setSellPercent] = useState(100);
  const [buyQuote, setBuyQuote] = useState<QuoteBuy | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [sellQuote, setSellQuote] = useState<QuoteSell | null>(null);
  const [sellError, setSellError] = useState<string | null>(null);
  const [claimQuote, setClaimQuote] = useState<QuoteClaim | null>(null);
  const [remaining, setRemaining] = useState(0n);
  const [pulse, setPulse] = useState(false);
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState<null | "buy" | "sell" | "claim">(null);

  useEffect(() => {
    if (!validId) return;
    let stop = false;
    const load = () => {
      view<CoinView>(config.factoryAccountId, "get_coin", { coin_id: coinId })
        .then((next) => {
          if (stop) return;
          setCoin((prev) => {
            if (prev && BigInt(next.deadline_ns) > BigInt(prev.deadline_ns)) {
              window.setTimeout(() => setPulse(true), 0);
              window.setTimeout(() => setPulse(false), 800);
            }
            return next;
          });
          setError(null);
        })
        .catch((err: unknown) => {
          if (!stop) setError(humanError(err));
        });
      view<TradeView[]>(config.factoryAccountId, "get_recent_trades", { coin_id: coinId })
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
  }, [coinId, revision, validId]);

  useEffect(() => {
    if (!coin) return;
    const base = BigInt(coin.remaining_ns);
    const started = Date.now();
    setRemaining(base);
    const timer = window.setInterval(() => {
      const elapsed = BigInt(Date.now() - started) * 1_000_000n;
      setRemaining(base > elapsed ? base - elapsed : 0n);
    }, 250);
    return () => window.clearInterval(timer);
  }, [coin]);

  useEffect(() => {
    if (!coin) return;
    document.title = `${coin.name} (${coin.symbol}) · NearBowl`;
    return () => {
      document.title = "NearBowl";
    };
  }, [coin]);

  useEffect(() => {
    if (!accountId || !validId) {
      setPosition(null);
      return;
    }
    let stop = false;
    view<PositionView>(config.factoryAccountId, "get_position", { coin_id: coinId, account_id: accountId })
      .then((row) => {
        if (!stop) setPosition(row);
      })
      .catch(() => {
        if (!stop) setPosition(null);
      });
    return () => {
      stop = true;
    };
  }, [accountId, coinId, coin?.supply, coin?.seed_tokens, validId, revision]);

  const clockDead = remaining === 0n;

  useEffect(() => {
    if (!coin || coin.status === "dead" || clockDead) {
      setBuyQuote(null);
      setBuyError(null);
      return;
    }
    const raw = parseUsdc(buyAmount);
    if (raw === null) {
      setBuyQuote(null);
      setBuyError(buyAmount.trim() ? "Use a USDC amount with up to 6 decimals." : null);
      return;
    }
    if (raw === "0") {
      setBuyQuote(null);
      setBuyError(null);
      return;
    }
    let stop = false;
    const handle = window.setTimeout(() => {
      view<QuoteBuy>(config.factoryAccountId, "quote_buy", {
        coin_id: coinId,
        usdc_in: raw,
        account_id: accountId ?? config.factoryAccountId,
      })
        .then((quote) => {
          if (stop) return;
          setBuyQuote(quote);
          setBuyError(null);
        })
        .catch((err: unknown) => {
          if (stop) return;
          setBuyQuote(null);
          setBuyError(humanError(err));
        });
    }, 300);
    return () => {
      stop = true;
      window.clearTimeout(handle);
    };
  }, [buyAmount, coin, coinId, accountId, clockDead]);

  useEffect(() => {
    if (!coin || coin.status === "dead" || clockDead || !position || position.balance === "0") {
      setSellQuote(null);
      setSellError(null);
      return;
    }
    const tokens = parseTokenFraction(position.balance, sellPercent);
    if (tokens === "0") {
      setSellQuote(null);
      setSellError(null);
      return;
    }
    let stop = false;
    const handle = window.setTimeout(() => {
      view<QuoteSell>(config.factoryAccountId, "quote_sell", { coin_id: coinId, tokens_in: tokens })
        .then((quote) => {
          if (stop) return;
          setSellQuote(quote);
          setSellError(null);
        })
        .catch((err: unknown) => {
          if (stop) return;
          setSellQuote(null);
          setSellError(humanError(err));
        });
    }, 300);
    return () => {
      stop = true;
      window.clearTimeout(handle);
    };
  }, [coin, coinId, position, sellPercent, clockDead]);

  useEffect(() => {
    if (!accountId || !validId) {
      setClaimQuote(null);
      return;
    }
    let stop = false;
    view<QuoteClaim>(config.factoryAccountId, "quote_claim", { coin_id: coinId, account_id: accountId })
      .then((quote) => {
        if (!stop) setClaimQuote(quote);
      })
      .catch(() => {
        if (!stop) setClaimQuote(null);
      });
    return () => {
      stop = true;
    };
  }, [accountId, coinId, coin?.status, coin?.reserve, validId, revision]);

  async function ensureReady(): Promise<boolean> {
    if (!accountId) {
      connect();
      return false;
    }
    const usdcStorage = await view<StorageView | null>(config.usdcAccountId, "storage_balance_of", { account_id: accountId });
    if (!usdcStorage) {
      const result = await call(config.usdcAccountId, "storage_deposit", { account_id: accountId }, USDC_STORAGE_YOCTO, "40000000000000", { kind: "storage" });
      push({
        tone: "ok",
        title: "Registered on USDC",
        detail: "Try the trade again in a moment.",
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
      return false;
    }
    const factoryStorage = await view<StorageView | null>(config.factoryAccountId, "storage_balance_of", { account_id: accountId });
    if (!factoryStorage || BigInt(factoryStorage.available) < 2_000_000_000_000_000_000_000n) {
      const result = await call(config.factoryAccountId, "storage_deposit", {}, TRADE_STORAGE_YOCTO, "40000000000000", { kind: "storage" });
      push({
        tone: "ok",
        title: "Storage deposited",
        detail: "Your position has room now. Try the trade again in a moment.",
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
      return false;
    }
    return true;
  }

  async function buy() {
    const raw = parseUsdc(buyAmount);
    if (!raw) {
      setBuyError("Enter a USDC amount with up to 6 decimals.");
      return;
    }
    setPending(true);
    try {
      if (!(await ensureReady())) return;
      const quote =
        buyQuote ??
        (await view<QuoteBuy>(config.factoryAccountId, "quote_buy", {
          coin_id: coinId,
          usdc_in: raw,
          account_id: accountId,
        }));
      const minOut = applySlippage(quote.tokens_out);
      const result = await call(
        config.usdcAccountId,
        "ft_transfer_call",
        {
          receiver_id: config.factoryAccountId,
          amount: raw,
          memo: null,
          msg: JSON.stringify({ action: "buy", coin_id: id, min_tokens_out: minOut }),
        },
        "1",
        "200000000000000",
        { kind: "buy", coinId: id, usdc: raw, tokens: quote.tokens_out },
      );
      push({
        tone: "ok",
        title: "Feed sent",
        detail: `About ${formatTokens(quote.tokens_out)} tokens and ${formatDuration(BigInt(quote.extension_ns))} added, if the quote held.`,
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
      setRevision((value) => value + 1);
    } catch (err) {
      push({ tone: "err", title: "Buy failed", detail: humanError(err) });
    } finally {
      setPending(false);
    }
  }

  async function sell() {
    if (!position) return;
    const tokens = parseTokenFraction(position.balance, sellPercent);
    setPending(true);
    try {
      if (!(await ensureReady())) return;
      const quote = sellQuote ?? (await view<QuoteSell>(config.factoryAccountId, "quote_sell", { coin_id: coinId, tokens_in: tokens }));
      const minOut = applySlippage(quote.usdc_out_net);
      const result = await call(
        config.factoryAccountId,
        "sell",
        { coin_id: coinId, tokens_in: tokens, min_usdc_out: minOut },
        "1",
        "80000000000000",
        { kind: "sell", coinId: id, usdc: quote.usdc_out_gross, tokens },
      );
      push({
        tone: "ok",
        title: "Sale sent",
        detail: "USDC arrives after the transfer confirms.",
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
      setRevision((value) => value + 1);
    } catch (err) {
      push({ tone: "err", title: "Sell failed", detail: humanError(err) });
    } finally {
      setPending(false);
    }
  }

  async function claim() {
    if (!accountId) {
      connect();
      return;
    }
    setPending(true);
    try {
      const result = await call(config.factoryAccountId, "claim", { coin_id: coinId }, "1", "80000000000000", {
        kind: "claim",
        coinId: id,
        usdc: claimQuote?.usdc_out,
      });
      push({
        tone: "ok",
        title: "Claim sent",
        detail: "This is a share of what is left in the pool, not a refund.",
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
      setRevision((value) => value + 1);
    } catch (err) {
      push({ tone: "err", title: "Claim failed", detail: humanError(err) });
    } finally {
      setPending(false);
    }
  }

  async function withdrawFees() {
    setPending(true);
    try {
      const result = await call(config.factoryAccountId, "withdraw_creator_fees", { coin_id: coinId }, "1", "80000000000000", { kind: "transaction", coinId: id });
      push({
        tone: "ok",
        title: "Fee withdrawal sent",
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
      setRevision((value) => value + 1);
    } catch (err) {
      push({ tone: "err", title: "Withdrawal failed", detail: humanError(err) });
    } finally {
      setPending(false);
    }
  }

  if (!validId) {
    return (
      <div className="page page-pad">
        <div className="card error-card" role="alert">
          <h1>That coin link does not look right</h1>
          <Link className="solid" href="/">
            Back to the bowl
          </Link>
        </div>
      </div>
    );
  }

  if (error && !coin) {
    return (
      <div className="page page-pad">
        <div className="card error-card" role="alert">
          <h1>Could not load this coin</h1>
          <p>{error}</p>
          <Link className="solid" href="/">
            Back to the bowl
          </Link>
        </div>
      </div>
    );
  }

  if (!coin) {
    return (
      <div className="page page-pad" aria-busy="true" aria-label="Loading coin">
        <div className="skeleton skeleton-hero" />
        <div className="skeleton-row">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </div>
    );
  }

  const locallyDead = coin.status === "dead" || clockDead;
  const mood = petMood(coin.status, coin.w_n, clockDead);
  const fullness = locallyDead ? 0 : 100 - hungerPercent(coin.w_n);
  const pool = coin.status === "dead" ? coin.snapshot_reserve : coin.reserve;
  const cap = BigInt(coin.max_life_ns || "0");

  return (
    <div className="page page-pad">
      <p className="back-link">
        <Link className="text-link" href="/">
          All coins
        </Link>
      </p>
      <div className="coin-layout">
        <section className="card coin-stage">
          <CoinArt imageUri={coin.image_uri} mood={mood} size="lg" pulse={pulse} alt={coin.name} />
          <div>
            <div className="symbol">{coin.symbol}</div>
            <h1>{coin.name}</h1>
            <p className="hint">
              by{" "}
              <a href={accountUrl(coin.creator_id)} target="_blank" rel="noreferrer">
                {coin.creator_id}
              </a>
            </p>
            <span className={`mood mood-${mood}`}>{moodLabel(mood)}</span>
            <div className="timer-block">
              <TimeRing remaining={remaining} cap={cap} dead={locallyDead} />
              <div>
                <p className="timer-kicker">{locallyDead ? "Timer finished" : "Time left"}</p>
                <p className="timer-value">{locallyDead ? "0s" : formatDuration(remaining)}</p>
                <p className="hint">Life cap {formatDuration(cap)}</p>
              </div>
            </div>
            <div
              className={`meter${mood === "hungry" || mood === "starving" ? " is-low" : ""}`}
              role="meter"
              aria-valuenow={fullness}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="How full the bowl is"
            >
              <span style={{ width: `${fullness}%` }} />
            </div>
            <p className="hint">Hunger {locallyDead ? 100 : hungerPercent(coin.w_n)}%. Selling pays closer to a pro-rata share as this rises.</p>
            {locallyDead ? <p className="epitaph">Lived {lifespan(coin.launched_ns, coin.deadline_ns)}. A share of what is left, not a refund.</p> : null}
          </div>
        </section>

        <section className="card position-card">
          <h2>Your position</h2>
          {accountId ? (
            <>
              <dl className="metric-grid">
                <div>
                  <dt>Tradable</dt>
                  <dd>{position ? formatTokens(position.balance) : "—"}</dd>
                </div>
                <div>
                  <dt>Seed</dt>
                  <dd>{position?.is_creator ? formatTokens(position.seed_tokens) : "0"}</dd>
                </div>
                <div>
                  <dt>Selling now</dt>
                  <dd>{locallyDead ? "Closed" : sellQuote ? `${formatUsdc(sellQuote.usdc_out_net)} USDC` : position && position.balance !== "0" ? "…" : "—"}</dd>
                </div>
                <div>
                  <dt>{locallyDead ? "Claim now" : "If it died now"}</dt>
                  <dd>{claimQuote ? `${formatUsdc(claimQuote.usdc_out)} USDC` : "—"}</dd>
                </div>
              </dl>
              {claimQuote && claimQuote.haircut !== "0" ? <p className="hint">Haircut to the protocol {formatUsdc(claimQuote.haircut)} USDC. Seed tokens cannot be sold.</p> : null}
              {!locallyDead && sellQuote ? (
                <p className="hint">
                  Curve would pay {formatUsdc(sellQuote.curve_value)} before fees. Pro-rata is {formatUsdc(sellQuote.prorata_value)}. Hunger is {(sellQuote.w_n / 64).toFixed(3)}.
                </p>
              ) : null}
              {position && position.balance === "0" && !position.is_creator ? <p className="hint">You do not hold this coin yet. A buy of at least 1 USDC feeds the timer.</p> : null}
              {position && BigInt(position.bucket_ns || "0") > 0n ? <p className="hint">Feeding bucket still holds {formatDuration(BigInt(position.bucket_ns))}, so the next buy may add less time.</p> : null}
            </>
          ) : (
            <p>Connect a wallet to see your tokens, what selling would pay, and what a death claim would pay.</p>
          )}
        </section>

        <div className="trade-stack">
          {!locallyDead ? (
            <form
              className="card form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!accountId) {
                  connect();
                  return;
                }
                if (!buyQuote) return;
                setReview("buy");
              }}
            >
              <h2>Feed</h2>
              <label>
                USDC
                <input inputMode="decimal" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} />
              </label>
              <div className="quote" aria-live="polite">
                {buyError ? <p className="hint warn">{buyError}</p> : null}
                {buyQuote ? (
                  <>
                    <p>
                      You receive about <b>{formatTokens(buyQuote.tokens_out)}</b> tokens
                    </p>
                    <p>
                      Adds <b>{formatDuration(BigInt(buyQuote.extension_ns))}</b> · timer becomes {formatDuration(BigInt(buyQuote.new_remaining_ns))}
                    </p>
                    <p className="hint">
                      Fee split: bowl {formatUsdc(buyQuote.fee_split.inherit)}, protocol {formatUsdc(buyQuote.fee_split.protocol)}, creator {formatUsdc(buyQuote.fee_split.creator)}. To the curve {formatUsdc(buyQuote.fee_split.to_curve)}.
                    </p>
                    {buyQuote.extension_ns === "0" ? <p className="hint">This buy does not add time. Buys under 1 USDC never feed the timer, and a full feeding bucket adds none.</p> : null}
                    {!accountId ? <p className="hint">Connect to preview your own feeding cap. This preview uses a fresh bucket.</p> : null}
                  </>
                ) : !buyError ? (
                  <p className="hint">Enter an amount. At least 1 USDC feeds the timer.</p>
                ) : null}
              </div>
              <FaucetButton />
              {review === "buy" && buyQuote ? (
                <ReviewCard
                  title="Confirm feed"
                  confirmLabel="Confirm feed"
                  pending={pending}
                  onBack={() => setReview(null)}
                  onConfirm={() => void buy()}
                  lines={[
                    { k: "You pay", v: `${formatUsdc(parseUsdc(buyAmount) ?? "0")} tUSDC` },
                    { k: "You receive", v: `about ${formatTokens(buyQuote.tokens_out)} tokens` },
                    { k: "Fee, stays in the bowl", v: `${formatUsdc(buyQuote.fee_split.inherit)} tUSDC` },
                    { k: "Protocol fee", v: `${formatUsdc(buyQuote.fee_split.protocol)} tUSDC` },
                    { k: "Creator fee", v: `${formatUsdc(buyQuote.fee_split.creator)} tUSDC` },
                    { k: "To the curve", v: `${formatUsdc(buyQuote.fee_split.to_curve)} tUSDC` },
                    { k: "Time added", v: formatDuration(BigInt(buyQuote.extension_ns)) },
                    { k: "Timer after", v: formatDuration(BigInt(buyQuote.new_remaining_ns)) },
                    { k: "Creator haircut", v: "None on a buy. The 50% cut applies only to the creator seed at death." },
                    { k: `Minimum tokens (${slippageLabel()})`, v: formatTokens(applySlippage(buyQuote.tokens_out)) },
                  ]}
                />
              ) : (
                <button className="solid" disabled={pending || !buyQuote} type="submit">
                  {pending ? "Sending…" : accountId ? "Review feed" : "Connect to buy"}
                </button>
              )}
              <p className="hint">Confirm shows the quote, the fee split, and the {slippageLabel()} minimum. A worse fill is rejected.</p>
            </form>
          ) : null}

          {!locallyDead ? (
            <form
              className="card form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!sellQuote) return;
                setReview("sell");
              }}
            >
              <h2>Sell</h2>
              <p className="hint">Tradable balance {position ? formatTokens(position.balance) : "—"}</p>
              <div className="row-buttons">
                {[25, 50, 100].map((percent) => (
                  <button type="button" key={percent} className={sellPercent === percent ? "solid" : "ghost"} aria-pressed={sellPercent === percent} onClick={() => setSellPercent(percent)}>
                    {percent}%
                  </button>
                ))}
              </div>
              <div className="quote" aria-live="polite">
                {sellError ? <p className="hint warn">{sellError}</p> : null}
                {sellQuote ? (
                  <p>
                    You receive <b>{formatUsdc(sellQuote.usdc_out_net)} USDC</b>
                  </p>
                ) : !sellError ? (
                  <p className="hint">Buy some tokens before selling. Seed tokens cannot be sold.</p>
                ) : null}
              </div>
              {review === "sell" && sellQuote && position ? (
                <ReviewCard
                  title="Confirm sale"
                  confirmLabel="Confirm sale"
                  pending={pending}
                  onBack={() => setReview(null)}
                  onConfirm={() => void sell()}
                  lines={[
                    { k: "Tokens sold", v: formatTokens(parseTokenFraction(position.balance, sellPercent)) },
                    { k: "Hunger", v: `${sellQuote.w_n}/64 (${hungerPercent(sellQuote.w_n)}%)` },
                    { k: "Curve value, before fees", v: `${formatUsdc(sellQuote.curve_value)} tUSDC` },
                    { k: "Pro-rata, before fees", v: `${formatUsdc(sellQuote.prorata_value)} tUSDC` },
                    { k: "Hunger-adjusted gross", v: `${formatUsdc(sellQuote.usdc_out_gross)} tUSDC` },
                    { k: "Fee, stays in the bowl", v: `${formatUsdc(sellQuote.fee_split.inherit)} tUSDC` },
                    { k: "Protocol fee", v: `${formatUsdc(sellQuote.fee_split.protocol)} tUSDC` },
                    { k: "Creator fee", v: `${formatUsdc(sellQuote.fee_split.creator)} tUSDC` },
                    { k: "You receive", v: `${formatUsdc(sellQuote.usdc_out_net)} tUSDC` },
                    { k: "Creator haircut", v: "None on a sale. Seed tokens cannot be sold." },
                    { k: `Minimum USDC (${slippageLabel()})`, v: formatUsdc(applySlippage(sellQuote.usdc_out_net)) },
                  ]}
                />
              ) : (
                <button className="ghost sell-btn" disabled={pending || !sellQuote} type="submit">
                  {pending ? "Sending…" : "Review sale"}
                </button>
              )}
            </form>
          ) : (
            <div className="card form">
              <h2>Claim</h2>
              <p>Trading is closed. A claim pays your share of what is left, not a refund of what you spent.</p>
              <div className="quote">
                {claimQuote ? (
                  <>
                    <p>
                      You would receive <b>{formatUsdc(claimQuote.usdc_out)} USDC</b>
                    </p>
                    {claimQuote.haircut !== "0" ? <p className="hint">Haircut to the protocol {formatUsdc(claimQuote.haircut)} USDC</p> : null}
                  </>
                ) : (
                  <p className="hint">Connect to see your share.</p>
                )}
              </div>
              {review === "claim" && claimQuote ? (
                <ReviewCard
                  title="Confirm claim"
                  confirmLabel="Confirm claim"
                  pending={pending}
                  onBack={() => setReview(null)}
                  onConfirm={() => void claim()}
                  lines={[
                    { k: "You receive", v: `${formatUsdc(claimQuote.usdc_out)} tUSDC` },
                    { k: "Protocol haircut", v: `${formatUsdc(claimQuote.haircut)} tUSDC` },
                    {
                      k: "Creator seed",
                      v:
                        claimQuote.haircut !== "0" || position?.is_creator
                          ? "The seed share is cut in half. Bought tokens are paid in full."
                          : "No seed on this account. Bought tokens are paid in full, with no haircut.",
                    },
                    { k: "Minimum output", v: "No slippage. The claim is your share of the death snapshot." },
                  ]}
                />
              ) : (
                <button
                  type="button"
                  className="solid"
                  disabled={pending || (Boolean(accountId) && !claimQuote)}
                  onClick={() => {
                    if (!accountId) {
                      connect();
                      return;
                    }
                    if (!claimQuote) return;
                    setReview("claim");
                  }}
                >
                  {pending ? "Sending…" : accountId ? "Review claim" : "Connect to claim"}
                </button>
              )}
            </div>
          )}

          {accountId && accountId === coin.creator_id ? (
            <div className="card">
              <h2>Creator fees</h2>
              <p>{formatUsdc(coin.creator_fees_owed)} USDC ready to withdraw.</p>
              <p className="hint">Seed still claim-only: {formatTokens(coin.seed_tokens)}</p>
              <button type="button" className="ghost" disabled={pending || coin.creator_fees_owed === "0"} onClick={() => void withdrawFees()}>
                Withdraw fees
              </button>
            </div>
          ) : null}
        </div>

        <section className="card metrics-card">
          <h2>Market</h2>
          <dl className="metric-grid">
            {locallyDead ? (
              <div>
                <dt>Left in the bowl</dt>
                <dd>{formatUsdc(pool, 2)} USDC</dd>
              </div>
            ) : (
              <div>
                <dt>Reserve</dt>
                <dd>{formatUsdc(coin.reserve, 2)} USDC</dd>
              </div>
            )}
            {locallyDead ? null : (
              <div>
                <dt>Market cap</dt>
                <dd>{formatUsdc(marketCapRaw(coin.reserve), 2)} USDC</dd>
              </div>
            )}
            <div>
              <dt>{locallyDead ? "Last price" : "Price"}</dt>
              <dd>{formatUsdc(coin.price, 4)} USDC</dd>
            </div>
            <div>
              <dt>{locallyDead ? "Supply at death" : "Supply"}</dt>
              <dd>{formatTokens(locallyDead ? coin.snapshot_supply : coin.supply)}</dd>
            </div>
            <div>
              <dt>Feeders</dt>
              <dd>{coin.feeders_count}</dd>
            </div>
            <div>
              <dt>Volume</dt>
              <dd>{formatUsdc(coin.volume_usdc, 2)} USDC</dd>
            </div>
          </dl>
        </section>

        <section className="card span-2">
          <h2>Recent trades</h2>
          {trades.length === 0 ? <p className="hint">No trades yet. The first feed shows up here. The contract keeps a ring of the latest 30.</p> : null}
          <p className="hint">
            {receipts.some((row) => row.coinId === id)
              ? "Trades you sent from this browser link to the transaction when the amounts match."
              : "The factory does not store transaction hashes. Trades link to the account and the factory on the explorer. After you buy, sell, or claim here, this browser keeps the hash."}
          </p>
          <ul className="trades">
            {trades.map((trade, index) => {
              const saved = matchTrade(coin.coin_id, trade);
              return (
                <li className="trade" key={`${trade.ts}-${trade.account_id}-${index}`}>
                  <span className={`pill pill-${trade.side}`}>{trade.side}</span>
                  <a href={accountUrl(trade.account_id)} target="_blank" rel="noreferrer">
                    {shortAccount(trade.account_id)}
                  </a>
                  <span>
                    {formatUsdc(trade.usdc)} USDC · {formatTokens(trade.tokens, 4)} tokens
                    {trade.side === "buy" && trade.ext_s > 0 ? ` · +${trade.ext_s}s` : ""}
                  </span>
                  <time>{formatAgo(trade.ts)}</time>
                  {saved ? (
                    <a href={txUrl(saved.hash)} target="_blank" rel="noreferrer">
                      Transaction
                    </a>
                  ) : (
                    <span className="trade-links">
                      <a href={accountUrl(trade.account_id)} target="_blank" rel="noreferrer">
                        Account activity
                      </a>
                      <a href={accountUrl(config.factoryAccountId)} target="_blank" rel="noreferrer">
                        Factory activity
                      </a>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
