const USDC = 1_000_000n;
const TOKEN = 10n ** 18n;

export function formatUsdc(raw: string | bigint, digits = 6): string {
  const n = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const negative = n < 0n;
  const v = negative ? -n : n;
  const whole = v / USDC;
  const frac = (v % USDC).toString().padStart(6, "0").slice(0, digits).replace(/0+$/, "");
  const body = frac ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function formatTokens(raw: string | bigint, digits = 6): string {
  const n = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  const whole = n / TOKEN;
  const frac = (n % TOKEN).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

export function parseUsdc(input: string): string | null {
  const text = input.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const padded = (frac + "000000").slice(0, 6);
  return (BigInt(whole) * USDC + BigInt(padded)).toString();
}

export function parseTokenFraction(balanceRaw: string, percent: number): string {
  const balance = BigInt(balanceRaw || "0");
  return ((balance * BigInt(percent)) / 100n).toString();
}

export function formatDuration(ns: bigint): string {
  const total = Number(ns / 1_000_000_000n);
  if (!Number.isFinite(total) || total <= 0) return "0s";
  if (total >= 86_400) {
    const d = Math.floor(total / 86_400);
    const h = Math.floor((total % 86_400) / 3600);
    return `${d}d ${h}h`;
  }
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (total >= 60) {
    return `${Math.floor(total / 60)}m ${total % 60}s`;
  }
  return `${total}s`;
}

export function shortAccount(account: string): string {
  if (account.length <= 18) return account;
  return `${account.slice(0, 8)}…${account.slice(-6)}`;
}

export function lifespan(launchedNs: string, deadlineNs: string): string {
  const life = BigInt(deadlineNs || "0") - BigInt(launchedNs || "0");
  return formatDuration(life > 0n ? life : 0n);
}

export function hungerPercent(wN: number): number {
  return Math.round((Math.min(64, Math.max(0, wN)) / 64) * 100);
}
