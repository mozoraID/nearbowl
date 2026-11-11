const RESERVED = new Set([
  "USDC",
  "USDT",
  "USDE",
  "DAI",
  "NEAR",
  "WNEAR",
  "STNEAR",
  "LINEAR",
  "ETH",
  "WETH",
  "BTC",
  "WBTC",
  "SOL",
  "AURORA",
]);

export function symbolProblem(raw: string): string | null {
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return "Choose a ticker.";
  if (!/^[A-Z0-9]{3,10}$/.test(symbol)) return "Use 3–10 letters or numbers.";
  if (symbol.startsWith("USD") || RESERVED.has(symbol)) return "That ticker is reserved.";
  return null;
}
