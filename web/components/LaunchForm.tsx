"use client";

import { FaucetButton } from "@/components/FaucetButton";
import { useWallet } from "@/components/Wallet";
import { config, LAUNCH_STORAGE_YOCTO, USDC_STORAGE_YOCTO } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { parseUsdc } from "@/lib/format";
import { view } from "@/lib/near";
import { symbolProblem } from "@/lib/reserved";
import type { StorageView } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function LaunchForm() {
  const { accountId, call, connect } = useWallet();
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [image, setImage] = useState("");
  const [seed, setSeed] = useState("100");
  const [symbolNote, setSymbolNote] = useState("3–10 letters or numbers.");
  const [symbolOk, setSymbolOk] = useState(false);
  const [storage, setStorage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const problem = symbolProblem(symbol);
    if (problem) {
      setSymbolOk(false);
      setSymbolNote(problem);
      return;
    }
    let stop = false;
    view<boolean>(config.factoryAccountId, "symbol_available", { symbol })
      .then((ok) => {
        if (stop) return;
        setSymbolOk(ok);
        setSymbolNote(ok ? `${symbol.toUpperCase()} is free.` : "That ticker is already taken.");
      })
      .catch(() => {
        if (!stop) setSymbolNote("Could not check the factory. The ticker still has to pass on chain.");
      });
    return () => {
      stop = true;
    };
  }, [symbol]);

  useEffect(() => {
    if (!accountId) return;
    view<StorageView | null>(config.factoryAccountId, "storage_balance_of", { account_id: accountId })
      .then((row) => setStorage(row?.available ?? null))
      .catch(() => setStorage(null));
  }, [accountId, pending]);

  const seedRaw = parseUsdc(seed);
  const needsStorage = storage === null || BigInt(storage) < BigInt(LAUNCH_STORAGE_YOCTO);

  async function depositStorage() {
    setPending(true);
    setMessage(null);
    try {
      await call(config.factoryAccountId, "storage_deposit", {}, LAUNCH_STORAGE_YOCTO, "40000000000000");
      setMessage("Storage deposited. You can launch when it lands.");
    } catch (err) {
      setMessage(humanError(err));
    } finally {
      setPending(false);
    }
  }

  async function launch() {
    if (!accountId) {
      connect();
      return;
    }
    if (!seedRaw || !symbolOk || name.trim().length === 0) {
      setMessage("Add a name, a free ticker, and a seed of at least 1 USDC.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const usdcStorage = await view<StorageView | null>(config.usdcAccountId, "storage_balance_of", { account_id: accountId });
      if (!usdcStorage) {
        await call(config.usdcAccountId, "storage_deposit", { account_id: accountId }, USDC_STORAGE_YOCTO, "40000000000000");
        setMessage("Registered on USDC. Launch again in a moment.");
        return;
      }
      await call(
        config.usdcAccountId,
        "ft_transfer_call",
        {
          receiver_id: config.factoryAccountId,
          amount: seedRaw,
          memo: null,
          msg: JSON.stringify({ action: "launch", name: name.trim(), symbol: symbol.trim(), image_uri: image.trim() }),
        },
        "1",
        "200000000000000",
      );
      router.push("/");
    } catch (err) {
      setMessage(humanError(err));
    } finally {
      setPending(false);
    }
  }

  const supplyPreview = seedRaw ? Math.sqrt(2 * Number(seedRaw) / 1e6).toFixed(6) : "—";

  return (
    <div className="split">
      <form className="card form" onSubmit={(event) => { event.preventDefault(); void launch(); }}>
        <h2 style={{ fontFamily: "var(--font-display), serif", margin: 0 }}>Launch a coin</h2>
        <label>
          Name
          <input value={name} maxLength={48} onChange={(event) => setName(event.target.value)} placeholder="Bowl Pup" required />
        </label>
        <label>
          Symbol
          <input value={symbol} maxLength={10} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="BOWL" required />
          <span className={symbolOk ? "hint ok" : "hint warn"}>{symbolNote}</span>
        </label>
        <label>
          Image URL <span className="hint">optional</span>
          <input value={image} maxLength={200} onChange={(event) => setImage(event.target.value)} placeholder="https://" />
        </label>
        <label>
          Seed (USDC)
          <input inputMode="decimal" value={seed} onChange={(event) => setSeed(event.target.value)} required />
        </label>
        <FaucetButton />
        {needsStorage && accountId && (
          <button type="button" className="ghost" disabled={pending} onClick={() => void depositStorage()}>
            Deposit 0.06 NEAR for storage
          </button>
        )}
        <button className="solid" type="submit" disabled={pending || !symbolOk}>
          {pending ? "Sending…" : accountId ? "Launch" : "Connect to launch"}
        </button>
        {message && <p className="hint" role="alert">{message}</p>}
      </form>
      <aside className="card">
        <h3 style={{ fontFamily: "var(--font-display), serif" }}>What you are seeding</h3>
        <p>The full seed becomes the pool. There is no launch fee.</p>
        <p>Starting supply, about <b>{supplyPreview}</b> tokens. Price starts near that same number in USDC.</p>
        <p>The timer starts at 45 seconds on the demo config.</p>
        <div className="note">
          Seed tokens are claim-only. They cannot be sold. If the coin dies, the creator receives half of the seed&apos;s share and the protocol keeps the other half. A share of what is left in the pool, not a refund.
        </div>
        {storage !== null && BigInt(storage) >= BigInt(LAUNCH_STORAGE_YOCTO) && (
          <p className="hint ok">Storage deposit is in place.</p>
        )}
      </aside>
    </div>
  );
}
