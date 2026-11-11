export type CoinStatus = "fed" | "hungry" | "dead";

export type CoinView = {
  coin_id: string;
  creator_id: string;
  name: string;
  symbol: string;
  image_uri: string;
  reserve: string;
  supply: string;
  seed_tokens: string;
  price: string;
  deadline_ns: string;
  remaining_ns: string;
  max_life_ns: string;
  w_n: number;
  w_bps: number;
  scar_n: number;
  status: CoinStatus;
  snapshot_reserve: string;
  snapshot_supply: string;
  volume_usdc: string;
  trade_count: number;
  feeders_count: number;
  creator_fees_owed: string;
  launched_ns: string;
};

export type FeeSplit = {
  inherit: string;
  protocol: string;
  creator: string;
  to_curve: string;
};

export type QuoteBuy = {
  tokens_out: string;
  fee_split: FeeSplit;
  extension_ns: string;
  new_remaining_ns: string;
  price_after: string;
};

export type QuoteSell = {
  w_n: number;
  w_bps: number;
  usdc_out_gross: string;
  usdc_out_net: string;
  curve_value: string;
  prorata_value: string;
  fee_split: FeeSplit;
};

export type QuoteClaim = {
  usdc_out: string;
  haircut: string;
  status: string;
};

export type TradeView = {
  account_id: string;
  side: "buy" | "sell";
  usdc: string;
  tokens: string;
  ts: string;
  w_bps: number;
  ext_s: number;
};

export type PositionView = {
  balance: string;
  bucket_ns: string;
  is_creator: boolean;
  seed_tokens: string;
};

export type StorageView = {
  total: string;
  available: string;
};
