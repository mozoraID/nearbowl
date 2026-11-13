const factoryFromEnv =
  process.env.NEXT_PUBLIC_FACTORY_ID?.trim() ||
  process.env.NEXT_PUBLIC_FACTORY_ACCOUNT_ID?.trim() ||
  "pet.nearbowl.testnet";

export const config = {
  network: process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://test.rpc.fastnear.com",
  /** Public factory. `NEXT_PUBLIC_FACTORY_ID` wins over `NEXT_PUBLIC_FACTORY_ACCOUNT_ID`. */
  factoryAccountId: factoryFromEnv,
  usdcAccountId: process.env.NEXT_PUBLIC_USDC_ACCOUNT_ID ?? "tusdc.nearbowl.testnet",
};

export const isTestnet = config.network !== "mainnet";

/** Circle testnet USDC. The factory treats it the same as tUSDC; only init config changes. */
export const CIRCLE_TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

export const USDC_STORAGE_YOCTO = "1250000000000000000000";
export const LAUNCH_STORAGE_YOCTO = "60000000000000000000000";
export const TRADE_STORAGE_YOCTO = "20000000000000000000000";

/** Suggested amounts for the one-cycle walkthrough on /start. */
export const CYCLE_SEED_USDC = "10";
export const CYCLE_FEED_USDC = "1";
export const FAUCET_USDC = "100";

export const GITHUB_URL = "https://github.com/mozoraID/nearbowl";
