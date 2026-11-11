"use client";

import { WalletButton, WalletProvider } from "@/components/Wallet";
import { config, isTestnet } from "@/lib/config";
import Link from "next/link";
import { usePathname } from "next/navigation";

function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="shell">
      <div className="banner" role="status">
        <span>
          <strong>{isTestnet ? "Testnet only." : "Mainnet."}</strong>{" "}
          {isTestnet
            ? "These coins are play money. tUSDC is not a real dollar, and a dead coin pays a share of what is left, not a refund."
            : "This factory settles the configured USDC. Demo controls must be off."}
        </span>
      </div>
      <header className="topbar">
        <Link href="/" className="brand">
          <span aria-hidden="true" style={{ fontSize: 28 }}>🥣</span>
          <span>
            <h1>NearBowl</h1>
            <p>Feed it, or it dies.</p>
          </span>
        </Link>
        <nav className="nav" aria-label="Primary">
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>Explore</Link>
          <Link href="/launch" aria-current={path === "/launch" ? "page" : undefined}>Launch</Link>
          <WalletButton />
        </nav>
      </header>
      {children}
      <footer className="footer">
        Factory <code>{config.factoryAccountId}</code> · USDC <code>{config.usdcAccountId}</code> · {config.network}
      </footer>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <Frame>{children}</Frame>
    </WalletProvider>
  );
}
