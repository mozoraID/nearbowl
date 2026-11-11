import { config } from "./config";

export function explorerBase(): string {
  return config.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
}

export function accountUrl(accountId: string): string {
  return `${explorerBase()}/address/${accountId}`;
}

export function txUrl(hash: string): string {
  return `${explorerBase()}/txns/${hash}`;
}
