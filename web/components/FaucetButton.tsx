"use client";

import { useWallet } from "@/components/Wallet";
import { config, isTestnet } from "@/lib/config";
import { humanError } from "@/lib/errors";
import { useState } from "react";

export function FaucetButton() {
  const { accountId, call, connect } = useWallet();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!isTestnet) return null;

  return (
    <div>
      <button
        className="soft"
        disabled={pending}
        onClick={() => {
          if (!accountId) {
            connect();
            return;
          }
          setPending(true);
          setMessage(null);
          call(config.usdcAccountId, "faucet", {}, "0", "30000000000000")
            .then(() => setMessage("100 tUSDC is on the way. The faucet allows one mint a minute."))
            .catch((err: unknown) => setMessage(humanError(err)))
            .finally(() => setPending(false));
        }}
      >
        {pending ? "Minting…" : "Get 100 tUSDC"}
      </button>
      {message && <p className="hint" role="status">{message}</p>}
    </div>
  );
}
