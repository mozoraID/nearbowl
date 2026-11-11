"use client";

import { BowlMark } from "@/components/Pet";
import { ToastProvider } from "@/components/Toast";
import { WalletButton, WalletProvider } from "@/components/Wallet";
import { config, GITHUB_URL, isTestnet } from "@/lib/config";
import { accountUrl } from "@/lib/explorer";
import Link from "next/link";
import { usePathname } from "next/navigation";

function IconHome() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function IconDemo() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function IconLaunch() {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V6M12 6l-5 5M12 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const explore = path === "/" || path.startsWith("/coin");
  const launch = path.startsWith("/launch");
  const demo = path.startsWith("/demo");
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <div className="topbar">
          <div className="page topbar-inner">
            <Link href="/" className="brand">
              <BowlMark />
              <span>
                <strong>NearBowl</strong>
                <small>Feed it, or it dies.</small>
              </span>
            </Link>
            <nav className="desktop-nav" aria-label="Primary">
              <Link href="/" aria-current={explore ? "page" : undefined}>
                Explore
              </Link>
              <Link href="/demo" aria-current={demo ? "page" : undefined}>
                Demo
              </Link>
              <Link href="/launch" aria-current={launch ? "page" : undefined}>
                Launch
              </Link>
            </nav>
            <WalletButton />
          </div>
        </div>
        <div className="banner">
          <p className="page" role="note">
            <strong>{isTestnet ? "Testnet only." : "Mainnet."}</strong>{" "}
            {isTestnet
              ? "These coins are play money. tUSDC is not a real dollar, and a dead coin pays a share of what is left, not a refund."
              : "This factory settles the configured USDC. Demo controls must be off."}
          </p>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="page footer-grid">
          <div>
            <strong>NearBowl</strong>
            <p>A USDC launchpad on NEAR. Buying feeds the timer. If it hits zero, holders split what is left.</p>
          </div>
          <div className="footer-links">
            <a href={accountUrl(config.factoryAccountId)} target="_blank" rel="noreferrer">
              Factory contract
            </a>
            <a href={accountUrl(config.usdcAccountId)} target="_blank" rel="noreferrer">
              USDC contract
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <p className="footer-meta">
            <a href={accountUrl(config.factoryAccountId)} target="_blank" rel="noreferrer">
              {config.factoryAccountId}
            </a>
            <span aria-hidden="true"> · </span>
            <a href={accountUrl(config.usdcAccountId)} target="_blank" rel="noreferrer">
              {config.usdcAccountId}
            </a>
            <span aria-hidden="true"> · </span>
            <span>{config.network}</span>
          </p>
          <p className="footer-meta">Not an offer or investment advice.</p>
        </div>
      </footer>
      <nav className="tabbar" aria-label="Primary">
        <Link href="/" className="tab" aria-current={explore ? "page" : undefined}>
          <IconHome />
          Explore
        </Link>
        <Link href="/demo" className="tab" aria-current={demo ? "page" : undefined}>
          <IconDemo />
          Demo
        </Link>
        <Link href="/launch" className="tab" aria-current={launch ? "page" : undefined}>
          <IconLaunch />
          Launch
        </Link>
      </nav>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ToastProvider>
        <Frame>{children}</Frame>
      </ToastProvider>
    </WalletProvider>
  );
}
