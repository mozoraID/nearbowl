#!/usr/bin/env node
/**
 * Legacy walkthrough for the short-timer factory only.
 *
 * This is not the public factory. It calls demo_set_remaining, which exists
 * only while timer controls are on. Point it at factory.nearbowl.testnet
 * (or LEGACY_FACTORY_ACCOUNT_ID). FACTORY_ACCOUNT_ID is the public factory
 * and is ignored here.
 *
 * The owner call holds the contract clock for 120 seconds so the hungry sell
 * sees exactly 30s left on the 45 second timer.
 *
 * Accounts (override with DEMO_ALICE_ID, DEMO_BOB_ID, DEMO_CAROL_ID):
 *   creator = DEPLOYER_ACCOUNT_ID
 *   alice   = alice.<deployer>
 *   bob     = bob.<deployer>
 *   carol   = carol.<deployer>
 * The deploy script creates those sub-accounts with the same key.
 */
import { LEGACY_FACTORY_ID, PUBLIC_FACTORY_ID, account, call, loadSigner, near, optional, send, view } from "./lib.mjs";

const { rpc, accountId, key, account: owner } = loadSigner();
const secret = key.toString();
const publicId = optional("FACTORY_ACCOUNT_ID", PUBLIC_FACTORY_ID);
const factoryId = optional("LEGACY_FACTORY_ACCOUNT_ID", LEGACY_FACTORY_ID);
if (factoryId === publicId) {
  console.error(`Refusing to run the legacy walkthrough on the public factory ${publicId}.`);
  console.error(`Set LEGACY_FACTORY_ACCOUNT_ID to the short-timer factory (${LEGACY_FACTORY_ID}).`);
  process.exit(1);
}
const tusdcId = optional("TUSDC_ACCOUNT_ID", `tusdc.${accountId}`);
const creator = account(optional("DEMO_CREATOR_ID", accountId), rpc, secret);
const alice = account(optional("DEMO_ALICE_ID", `alice.${accountId}`), rpc, secret);
const bob = account(optional("DEMO_BOB_ID", `bob.${accountId}`), rpc, secret);
const carol = account(optional("DEMO_CAROL_ID", `carol.${accountId}`), rpc, secret);

const ONE = 1_000_000n;
const expected = {
  seedTokens: 14_142_135_623_730_950_488n,
  aliceTokens: 1_336_882_432_980_528_133n,
  bobTokens: 1_811_165_826_509_553_515n,
  carolTokens: 2_653_958_297_866_865_965n,
  pool: 199_500_000n,
  supply: 19_944_142_181_087_898_101n,
  bobGross: 29_102_528n,
  bobNet: 28_811_504n,
  poolAfter: 170_542_984n,
  supplyAfter: 18_132_976_354_578_344_586n,
  aliceClaim: 12_573_551n,
  carolClaim: 24_960_820n,
  creatorClaim: 66_504_305n,
  haircut: 66_504_306n,
  creatorFees: 258_205n,
};

const rows = [];
function compare(label, actual, want) {
  const ok = BigInt(actual) === want;
  rows.push({ label, actual: actual.toString(), expected: want.toString(), ok });
  console.log(`${ok ? "ok " : "DIFF"} ${label.padEnd(28)} actual ${actual}  expected ${want}`);
}

async function usdcBalance(id) {
  const value = await view(rpc, tusdcId, "ft_balance_of", { account_id: id });
  return BigInt(value);
}

async function register(who) {
  const balance = await view(rpc, tusdcId, "storage_balance_of", { account_id: who.accountId }).catch(() => null);
  if (!balance) {
    await send(who, tusdcId, [call("storage_deposit", { account_id: who.accountId }, 20, near("0.00125"))]);
  }
  const factoryStorage = await view(rpc, factoryId, "storage_balance_of", { account_id: who.accountId }).catch(() => null);
  if (!factoryStorage) {
    await send(who, factoryId, [call("storage_deposit", {}, 30, near("0.2"))]);
  }
}

async function mint(who, whole) {
  await send(owner, tusdcId, [call("mint", { account_id: who.accountId, amount: (BigInt(whole) * ONE).toString() }, 20)]);
}

async function buy(who, whole) {
  await send(who, tusdcId, [
    call(
      "ft_transfer_call",
      {
        receiver_id: factoryId,
        amount: (BigInt(whole) * ONE).toString(),
        memo: null,
        msg: JSON.stringify({ action: "buy", coin_id: "1", min_tokens_out: "0" }),
      },
      200,
      1n,
    ),
  ]);
}

console.log("NearBowl legacy walkthrough (not the public factory)");
console.log(`legacy factory ${factoryId}`);
console.log(`public factory ${publicId} is left alone`);
const legacyParams = await view(rpc, factoryId, "get_params", {});
if (!legacyParams?.params?.allow_demo_controls) {
  console.error(`${factoryId} has timer controls off. This walkthrough needs the legacy factory.`);
  process.exit(1);
}
if (legacyParams.params.initial_life_ns !== "45000000000") {
  console.error(`${factoryId} initial life is ${legacyParams.params.initial_life_ns}, not the 45s legacy timer. The printed numbers would not match.`);
  process.exit(1);
}
await register(creator);
await register(alice);
await register(bob);
await register(carol);
await mint(creator, 200);
await mint(alice, 50);
await mint(bob, 50);
await mint(carol, 80);

await send(creator, tusdcId, [
  call(
    "ft_transfer_call",
    {
      receiver_id: factoryId,
      amount: (100n * ONE).toString(),
      memo: null,
      msg: JSON.stringify({ action: "launch", name: "Bowl Pup", symbol: `B${Date.now().toString(36).slice(-6).toUpperCase()}`, image_uri: "" }),
    },
    200,
    1n,
  ),
]);

const coins = await view(rpc, factoryId, "list_coins", { status: "alive", from_index: 0, limit: 50 });
const coinId = Number(coins[coins.length - 1].coin_id);
console.log(`launched coin ${coinId} (${coins[coins.length - 1].symbol})`);
let coin = await view(rpc, factoryId, "get_coin", { coin_id: coinId });
compare("seed tokens", coin.seed_tokens, expected.seedTokens);

await buy(alice, 20);
await buy(bob, 30);
await buy(carol, 50);
coin = await view(rpc, factoryId, "get_coin", { coin_id: coinId });
const alicePos = await view(rpc, factoryId, "get_position", { coin_id: coinId, account_id: alice.accountId });
const bobPos = await view(rpc, factoryId, "get_position", { coin_id: coinId, account_id: bob.accountId });
const carolPos = await view(rpc, factoryId, "get_position", { coin_id: coinId, account_id: carol.accountId });
compare("alice tokens", alicePos.balance, expected.aliceTokens);
compare("bob tokens", bobPos.balance, expected.bobTokens);
compare("carol tokens", carolPos.balance, expected.carolTokens);
compare("pool", coin.reserve, expected.pool);
compare("supply", coin.supply, expected.supply);
const trades = await view(rpc, factoryId, "get_recent_trades", { coin_id: coinId });
console.log(`extensions (s) newest first: ${trades.map((trade) => trade.ext_s).join(", ")}  expected 80, 60, 40`);

await send(owner, factoryId, [call("demo_set_remaining", { coin_id: coinId, remaining_ns: "30000000000" }, 30)]);
const beforeBob = await usdcBalance(bob.accountId);
await send(bob, factoryId, [call("sell", { coin_id: coinId, tokens_in: bobPos.balance, min_usdc_out: "0" }, 80, 1n)]);
const bobReceived = (await usdcBalance(bob.accountId)) - beforeBob;
compare("bob net", bobReceived, expected.bobNet);
coin = await view(rpc, factoryId, "get_coin", { coin_id: coinId });
compare("pool after sell", coin.reserve, expected.poolAfter);
compare("supply after sell", coin.supply, expected.supplyAfter);
console.log(`hunger step w_n=${coin.w_n}  expected 22`);

await send(owner, factoryId, [call("demo_set_remaining", { coin_id: coinId, remaining_ns: "0" }, 30)]);
const creatorQuote = await view(rpc, factoryId, "quote_claim", { coin_id: coinId, account_id: creator.accountId });
compare("haircut", creatorQuote.haircut, expected.haircut);
const claim = async (who) => {
  const before = await usdcBalance(who.accountId);
  await send(who, factoryId, [call("claim", { coin_id: coinId }, 80, 1n)]);
  return (await usdcBalance(who.accountId)) - before;
};
compare("alice claim", await claim(alice), expected.aliceClaim);
compare("carol claim", await claim(carol), expected.carolClaim);
compare("creator claim", await claim(creator), expected.creatorClaim);
coin = await view(rpc, factoryId, "get_coin", { coin_id: coinId });
compare("creator fees", coin.creator_fees_owed, expected.creatorFees);

const failed = rows.filter((row) => !row.ok);
console.log("");
if (failed.length === 0) {
  console.log("demo numbers match the integer model");
  console.log(`creator spent 100 USDC and received ${expected.creatorClaim} plus ${expected.creatorFees} fees`);
} else {
  console.log(`${failed.length} number(s) differed`);
  process.exit(1);
}
