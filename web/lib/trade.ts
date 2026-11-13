/** Bound sent with buy and sell. The chain rejects a fill worse than this. */
export const SLIPPAGE_BPS = 200n;

export function applySlippage(raw: string): string {
  return ((BigInt(raw || "0") * (10_000n - SLIPPAGE_BPS)) / 10_000n).toString();
}

export function slippageLabel(): string {
  return `${Number(SLIPPAGE_BPS) / 100}%`;
}
