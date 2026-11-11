import { readFileSync } from "node:fs";
import { Account, KeyPair, actions, parseNearAmount } from "near-api-js";

export const TGAS = 1_000_000_000_000n;

export function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing ${name}. See .env.example.`);
  }
  return value;
}

export function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export function loadSigner() {
  const network = optional("NEAR_NETWORK_ID", "testnet");
  if (network === "mainnet") {
    console.error("Refusing to run: this script targets testnet. allow_demo_controls must be false on mainnet, and this script always turns it on.");
    process.exit(1);
  }
  const rpc = optional("NEAR_RPC_URL", "https://rpc.testnet.near.org");
  const accountId = env("DEPLOYER_ACCOUNT_ID");
  let secret = optional("DEPLOYER_PRIVATE_KEY");
  if (!secret && process.env.NEAR_CREDENTIALS_FILE) {
    const file = JSON.parse(readFileSync(process.env.NEAR_CREDENTIALS_FILE, "utf8"));
    secret = file.private_key || file.secret_key;
    if (!secret) throw new Error("Credentials file has no private_key");
  }
  if (!secret) throw new Error("Set DEPLOYER_PRIVATE_KEY or NEAR_CREDENTIALS_FILE");
  if (!secret.includes(":")) secret = `ed25519:${secret}`;
  const key = KeyPair.fromString(secret);
  const account = new Account(accountId, rpc, secret);
  return { network, rpc, accountId, key, account };
}

export function account(id, rpc, secret) {
  return new Account(id, rpc, secret);
}

export async function exists(id, rpc) {
  try {
    await new Account(id, rpc).getState();
    return true;
  } catch (err) {
    const text = String(err?.message || err);
    if (text.includes("does not exist") || text.includes("UNKNOWN_ACCOUNT")) {
      return false;
    }
    throw err;
  }
}

export async function send(signer, receiverId, list) {
  return signer.signAndSendTransaction({ receiverId, actions: list, throwOnFailure: true });
}

export function call(method, args, gasTgas, depositYocto = 0n) {
  return actions.functionCall(method, args, BigInt(gasTgas) * TGAS, depositYocto);
}

export function near(amount) {
  return BigInt(parseNearAmount(String(amount)));
}

export async function view(rpc, contractId, method, args) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "nearbowl",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        finality: "optimistic",
      },
    }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.data || body.error.message || "rpc error");
  return JSON.parse(Buffer.from(body.result.result).toString("utf8"));
}

export const DEMO_PARAMS = {
  fee_bps: 100,
  inherit_bps: 50,
  protocol_bps: 30,
  creator_bps: 20,
  creator_haircut_bps: 5000,
  min_trade_usdc: "1000000",
  min_seed_usdc: "1000000",
  ext_ns_per_raw_usdc: "2000",
  initial_life_ns: "45000000000",
  t_ref_ns: "45000000000",
  twilight_ns: "10000000000",
  twilight_min_factor_bps: 2500,
  max_life_min_ns: "180000000000",
  max_life_max_ns: "540000000000",
  r_small: "1000000000",
  r_large: "100000000000",
  tier1_ns: "60000000000",
  tier2_ns: "60000000000",
  leak_bps: 2500,
  scar_step_ns: "3000000000",
  launch_storage_min_yocto: "60000000000000000000000",
  allow_demo_controls: true,
};
