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
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  if (total >= 60) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  return `${total}s`;
}

export function shortAccount(account: string): string {
  const bare = account.endsWith(".testnet")
    ? account.slice(0, -".testnet".length)
    : account.endsWith(".near")
      ? account.slice(0, -".near".length)
      : account;
  if (bare.length <= 18) return bare;
  return `${bare.slice(0, 8)}…${bare.slice(-4)}`;
}

export function lifespan(launchedNs: string, deadlineNs: string): string {
  const life = BigInt(deadlineNs || "0") - BigInt(launchedNs || "0");
  return formatDuration(life > 0n ? life : 0n);
}

export function hungerPercent(wN: number): number {
  return Math.round((Math.min(64, Math.max(0, wN)) / 64) * 100);
}

export type PetMood = "happy" | "hungry" | "starving" | "dead";

export function petMood(status: string, wN: number, locallyDead = false): PetMood {
  if (locallyDead || status === "dead") return "dead";
  if (wN >= 32) return "starving";
  if (wN > 0) return "hungry";
  return "happy";
}

export function moodLabel(mood: PetMood): string {
  if (mood === "happy") return "Happy";
  if (mood === "hungry") return "Hungry";
  if (mood === "starving") return "Starving";
  return "Ghost";
}

export function compareBig(a: string, b: string): number {
  const delta = BigInt(a || "0") - BigInt(b || "0");
  if (delta > 0n) return 1;
  if (delta < 0n) return -1;
  return 0;
}

export function marketCapRaw(reserve: string): string {
  return (BigInt(reserve || "0") * 2n).toString();
}

export function lifeRatio(remaining: bigint, cap: bigint): number {
  if (cap <= 0n || remaining <= 0n) return 0;
  const scaled = Number((remaining * 10000n) / cap);
  if (!Number.isFinite(scaled)) return 0;
  return Math.min(1, Math.max(0, scaled / 10000));
}

export function formatAgo(ns: string, nowMs = Date.now()): string {
  let ms = 0;
  try {
    ms = Number(BigInt(ns || "0") / 1_000_000n);
  } catch {
    return "";
  }
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const delta = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function formatUsdcStat(raw: string): string {
  try {
    const n = BigInt(raw || "0");
    if (n > 0n && n < 10_000n) return "<0.01";
    return formatUsdc(n, 2);
  } catch {
    return "—";
  }
}

export function formatCount(value: number, capped: boolean): string {
  const text = value.toLocaleString("en-US");
  return capped ? `${text}+` : text;
}

function isqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** Matches the contract seed: supply = isqrt(reserve_raw * 2 * 10^30), price = 2R*1e18/s. */
export function seedPreview(seedRaw: string): { supplyRaw: string; priceRaw: string } | null {
  let reserve = 0n;
  try {
    reserve = BigInt(seedRaw);
  } catch {
    return null;
  }
  if (reserve <= 0n) return null;
  const supply = isqrt(reserve * 2n * 10n ** 30n);
  if (supply === 0n) return null;
  const price = (reserve * 2n * 10n ** 18n) / supply;
  return { supplyRaw: supply.toString(), priceRaw: price.toString() };
}

export function extensionPerUsdc(extNsPerRaw: string): string {
  try {
    return formatDuration(BigInt(extNsPerRaw) * 1_000_000n);
  } catch {
    return "—";
  }
}
