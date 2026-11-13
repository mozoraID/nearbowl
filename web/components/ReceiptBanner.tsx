"use client";

import { useToast } from "@/components/Toast";
import { useWallet } from "@/components/Wallet";
import { txUrl } from "@/lib/explorer";
import { clearPending, loadReceipts, recordOutcome, useReceipts, type ReceiptKind } from "@/lib/receipts";
import { useEffect, useState } from "react";

export function RedirectReceipts() {
  const push = useToast();
  const { accountId } = useWallet();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("errorCode");
    const errorMessage = params.get("errorMessage");
    const hashes = params.get("transactionHashes");
    if (!hashes && !errorCode) return;
    if (errorCode) {
      clearPending();
      push({ tone: "err", title: "The wallet did not finish", detail: errorMessage || errorCode });
    } else if (!accountId) {
      return;
    } else {
      const hash = hashes?.split(",").find((item) => item.length > 0);
      if (hash && !loadReceipts().some((row) => row.hash === hash)) {
        recordOutcome(hash, accountId);
        push({
          tone: "ok",
          title: "Transaction sent",
          detail: "This link opens the transaction on the explorer.",
          href: txUrl(hash),
        });
      }
    }
    params.delete("transactionHashes");
    params.delete("errorCode");
    params.delete("errorMessage");
    const next = params.toString();
    const hash = window.location.hash;
    window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}${hash}`);
  }, [accountId, push]);

  return null;
}

const LABELS: Record<ReceiptKind, string> = {
  launch: "Launch",
  buy: "Feed",
  sell: "Sale",
  claim: "Claim",
  faucet: "Faucet",
  storage: "Storage deposit",
  transaction: "Transaction",
};

export function ReceiptBanner() {
  const receipts = useReceipts();
  const latest = receipts[0];
  const [hidden, setHidden] = useState<string | null>(null);
  if (!latest || hidden === latest.hash) return null;
  if (Date.now() - latest.at > 10 * 60 * 1000) return null;
  return (
    <div className="page receipt-wrap">
      <div className="card receipt-card" role="status">
        <p>
          <strong>{LABELS[latest.kind] ?? "Transaction"} sent.</strong> The explorer link is the transaction hash from your wallet.
        </p>
        <p className="receipt-actions">
          <a href={txUrl(latest.hash)} target="_blank" rel="noreferrer">
            View on NearBlocks
          </a>
          <button type="button" className="ghost" onClick={() => setHidden(latest.hash)}>
            Dismiss
          </button>
        </p>
      </div>
    </div>
  );
}
