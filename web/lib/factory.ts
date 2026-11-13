import { config } from "./config";
import { view } from "./near";
import type { CoinView, ConfigView, QuoteLaunch, SolvencyView, TradeView } from "./types";

export function listCoins(status: "alive" | "dead", fromIndex = 0, limit = 50): Promise<CoinView[]> {
  return view<CoinView[]>(config.factoryAccountId, "list_coins", {
    status,
    from_index: fromIndex,
    limit,
  });
}

export function getSolvency(): Promise<SolvencyView> {
  return view<SolvencyView>(config.factoryAccountId, "get_solvency", {});
}

export function getConfig(): Promise<ConfigView> {
  return view<ConfigView>(config.factoryAccountId, "get_params", {});
}

export function quoteLaunch(usdcIn: string): Promise<QuoteLaunch> {
  return view<QuoteLaunch>(config.factoryAccountId, "quote_launch", { usdc_in: usdcIn });
}

export function getRecentTrades(coinId: string): Promise<TradeView[]> {
  return view<TradeView[]>(config.factoryAccountId, "get_recent_trades", { coin_id: Number(coinId) });
}

export async function countBeyondFirstPage(status: "alive" | "dead", firstPageLength: number): Promise<{ value: number; capped: boolean }> {
  if (firstPageLength < 50) return { value: firstPageLength, capped: false };
  let total = firstPageLength;
  for (let from = 50; from < 1000; from += 50) {
    const page = await listCoins(status, from, 50);
    total += page.length;
    if (page.length < 50) return { value: total, capped: false };
  }
  return { value: total, capped: true };
}

export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(Math.max(limit, 0), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}
