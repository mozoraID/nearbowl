"use client";

import { FaucetButton } from "@/components/FaucetButton";
import { Pet } from "@/components/Pet";
import { useToast } from "@/components/Toast";
import { useWallet } from "@/components/Wallet";
import { config, LAUNCH_STORAGE_YOCTO, USDC_STORAGE_YOCTO } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { txUrl } from "@/lib/explorer";
import { getConfig } from "@/lib/factory";
import { formatDuration, formatTokens, formatUsdc, parseUsdc, seedPreview } from "@/lib/format";
import { view } from "@/lib/near";
import { symbolProblem } from "@/lib/reserved";
import type { StorageView } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the pet a name.";
  if ([...trimmed].length > 48) return "Keep the name to 48 characters.";
  return null;
}

function imageProblem(image: string): string | null {
  const trimmed = image.trim();
  if (!trimmed) return null;
  if ([...trimmed].length > 200) return "Keep the image link to 200 characters.";
  if (!/^https?:\/\/\S+$/.test(trimmed)) return "Use an http or https link, or leave this blank.";
  return null;
}

export function LaunchForm() {
  const { accountId, call, connect } = useWallet();
  const push = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [seed, setSeed] = useState("100");
  const [symbolNote, setSymbolNote] = useState("3–10 letters or numbers.");
  const [symbolOk, setSymbolOk] = useState(false);
  const [storage, setStorage] = useState<string | null | undefined>(undefined);
  const [minSeed, setMinSeed] = useState(1_000_000n);
  const [initialLife, setInitialLife] = useState<bigint | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const localSymbol = symbol.trim() ? symbolProblem(symbol) : null;
  const nameError = nameProblem(name);
  const imageError = imageProblem(image);
  const parsedSeed = parseUsdc(seed);
  const seedError = parsedSeed === null ? "Use a number with up to 6 decimals." : BigInt(parsedSeed) < minSeed ? `Seed at least ${formatUsdc(minSeed.toString())} USDC.` : null;
  const preview = parsedSeed && !seedError ? seedPreview(parsedSeed) : null;
  const needsStorage = Boolean(accountId) && storage !== undefined && (storage === null || BigInt(storage) < BigInt(LAUNCH_STORAGE_YOCTO));

  useEffect(() => {
    let stop = false;
    getConfig()
      .then((row) => {
        if (stop) return;
        setMinSeed(BigInt(row.params.min_seed_usdc));
        setInitialLife(BigInt(row.params.initial_life_ns));
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (localSymbol || !symbol.trim()) {
      setSymbolOk(false);
      setSymbolNote(localSymbol ?? "3–10 letters or numbers. Names starting with USD are reserved.");
      return;
    }
    let stop = false;
    const timer = window.setTimeout(() => {
      view<boolean>(config.factoryAccountId, "symbol_available", { symbol })
        .then((ok) => {
          if (stop) return;
          setSymbolOk(ok);
          setSymbolNote(ok ? `${symbol.toUpperCase()} is free.` : "That ticker is already taken.");
        })
        .catch(() => {
          if (!stop) {
            setSymbolOk(false);
            setSymbolNote("Could not check the factory. The ticker still has to pass on chain.");
          }
        });
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [symbol, localSymbol]);

  useEffect(() => {
    if (!accountId) {
      setStorage(undefined);
      return;
    }
    setStorage(undefined);
    view<StorageView | null>(config.factoryAccountId, "storage_balance_of", { account_id: accountId })
      .then((row) => setStorage(row?.available ?? null))
      .catch(() => setStorage(null));
  }, [accountId, pending]);

  async function depositStorage() {
    if (!accountId) {
      connect();
      return;
    }
    setPending(true);
    try {
      const result = await call(config.factoryAccountId, "storage_deposit", {}, LAUNCH_STORAGE_YOCTO, "40000000000000");
      push({
        tone: "ok",
        title: "Storage deposited",
        detail: "0.06 NEAR is on the way to the factory. You can launch when it lands.",
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
    } catch (err) {
      push({ tone: "err", title: "Storage deposit failed", detail: humanError(err) });
    } finally {
      setPending(false);
    }
  }

  async function launch() {
    setSubmitted(true);
    if (!accountId) {
      connect();
      return;
    }
    if (nameError || imageError || seedError || !symbolOk || !parsedSeed) return;
    setPending(true);
    try {
      const usdcStorage = await view<StorageView | null>(config.usdcAccountId, "storage_balance_of", { account_id: accountId });
      if (!usdcStorage) {
        const result = await call(config.usdcAccountId, "storage_deposit", { account_id: accountId }, USDC_STORAGE_YOCTO, "40000000000000");
        push({
          tone: "ok",
          title: "Registered on USDC",
          detail: "Launch again in a moment, after this registration lands.",
          href: result.txHash ? txUrl(result.txHash) : undefined,
        });
        return;
      }
      if (needsStorage) {
        push({ tone: "err", title: "Storage still short", detail: "Deposit 0.06 NEAR on the factory, then launch." });
        return;
      }
      const result = await call(
        config.usdcAccountId,
        "ft_transfer_call",
        {
          receiver_id: config.factoryAccountId,
          amount: parsedSeed,
          memo: null,
          msg: JSON.stringify({ action: "launch", name: name.trim(), symbol: symbol.trim(), image_uri: image.trim() }),
        },
        "1",
        "200000000000000",
      );
      push({
        tone: "ok",
        title: "Launch sent",
        detail: `${name.trim()} (${symbol.trim()}) is on the way. The timer starts when the transaction lands.`,
        href: result.txHash ? txUrl(result.txHash) : undefined,
      });
      router.push("/");
    } catch (err) {
      push({ tone: "err", title: "Launch failed", detail: humanError(err) });
    } finally {
      setPending(false);
    }
  }

  const showName = submitted || name.length > 0;

  return (
    <div className="launch-layout">
      <aside className="launch-preview">
        <div className="card coin-card">
          <div className="coin-top">
            <Pet mood="happy" size="sm" />
            <div className="coin-name">
              <div className="symbol">{symbol.trim() || "PET"}</div>
              <p className="preview-title">{name.trim() || "Your coin"}</p>
              <span className="mood mood-happy">Happy</span>
            </div>
          </div>
          <dl className="card-stats">
            <div>
              <dt>Seed</dt>
              <dd>{parsedSeed && !seedError ? formatUsdc(parsedSeed, 2) : "—"}</dd>
            </div>
            <div>
              <dt>Start price</dt>
              <dd>{preview ? formatUsdc(preview.priceRaw, 4) : "—"}</dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>{preview ? formatTokens(preview.supplyRaw, 4) : "—"}</dd>
            </div>
            <div>
              <dt>Timer</dt>
              <dd>{initialLife !== null ? formatDuration(initialLife) : "—"}</dd>
            </div>
          </dl>
        </div>
        <div className="card note-card">
          <h2>What you are seeding</h2>
          <ul>
            <li>The full seed becomes the pool. There is no launch fee.</li>
            <li>Market cap starts at twice the seed, because price times supply is 2 × reserve.</li>
            <li>The timer starts at {initialLife !== null ? formatDuration(initialLife) : "this factory's initial life"}.</li>
            <li>Seed tokens are claim-only. If the coin dies, the creator keeps half of the seed share and the protocol keeps the other half. A share of what is left, not a refund.</li>
          </ul>
          {typeof storage === "string" && BigInt(storage) >= BigInt(LAUNCH_STORAGE_YOCTO) ? <p className="hint ok">Factory storage deposit is in place.</p> : null}
        </div>
      </aside>
      <form
        className="card form launch-form"
        onSubmit={(event) => {
          event.preventDefault();
          void launch();
        }}
      >
        <label>
          Name
          <input value={name} maxLength={48} onChange={(event) => setName(event.target.value)} placeholder="Bowl pup" required />
          {showName && nameError ? <span className="hint warn">{nameError}</span> : <span className="hint">Up to 48 characters.</span>}
        </label>
        <label>
          Symbol
          <input value={symbol} maxLength={10} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="BOWL" required autoCapitalize="characters" />
          <span className={symbolOk ? "hint ok" : symbol.trim() ? "hint warn" : "hint"}>{symbolNote}</span>
        </label>
        <label>
          Image URL <span className="hint">optional</span>
          <input value={image} maxLength={200} onChange={(event) => setImage(event.target.value)} placeholder="https://" />
          {imageError ? <span className="hint warn">{imageError}</span> : <span className="hint">Shown by indexers later. The pet on this page stays the bowl character.</span>}
        </label>
        <label>
          Seed (USDC)
          <input inputMode="decimal" value={seed} onChange={(event) => setSeed(event.target.value)} required />
          {seedError && (submitted || seed.length > 0) ? <span className="hint warn">{seedError}</span> : <span className="hint">Minimum {formatUsdc(minSeed.toString())} USDC on this factory.</span>}
        </label>
        <FaucetButton />
        {needsStorage ? (
          <button type="button" className="ghost" disabled={pending} onClick={() => void depositStorage()}>
            Deposit 0.06 NEAR for storage
          </button>
        ) : null}
        <button className="solid" type="submit" disabled={pending || (symbol.trim().length > 0 && !symbolOk)}>
          {pending ? "Sending…" : accountId ? "Launch" : "Connect to launch"}
        </button>
        {submitted && (nameError || imageError || seedError || !symbolOk) ? (
          <p className="hint warn" role="alert">
            Fix the fields above before sending the seed.
          </p>
        ) : null}
      </form>
    </div>
  );
}
