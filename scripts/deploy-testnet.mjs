#!/usr/bin/env node
/**
 * Deploy tUSDC and the NearBowl factory to testnet.
 *
 * Reads the deployer account and key from the environment. Never prints the key.
 *
 *   DEPLOYER_ACCOUNT_ID=nearbowl.testnet
 *   DEPLOYER_PRIVATE_KEY=ed25519:...
 *   # or NEAR_CREDENTIALS_FILE=./credentials.json
 *
 * Default sub-account names: pet.<deployer> and tusdc.<deployer>
 * (override with FACTORY_ACCOUNT_ID and TUSDC_ACCOUNT_ID).
 * The public factory is pet.nearbowl.testnet, created from nearbowl.testnet,
 * with timer controls off. factory.nearbowl.testnet is the legacy short-timer
 * factory and is not used by the app. Timer env vars and ALLOW_DEMO_CONTROLS
 * apply only when the factory account is created.
 */
import { readFileSync } from "node:fs";
import { actions } from "near-api-js";
import { LEGACY_FACTORY_ID, PUBLIC_FACTORY_ID, account, call, demoParamsFromEnv, exists, loadSigner, near, optional, send } from "./lib.mjs";

const { rpc, accountId, key, account: deployer } = loadSigner();
const factoryId = optional("FACTORY_ACCOUNT_ID", `pet.${accountId}`);
const tusdcId = optional("TUSDC_ACCOUNT_ID", `tusdc.${accountId}`);
const root = new URL("..", import.meta.url);
const factoryWasm = readFileSync(new URL("target/wasm32-unknown-unknown/release/nearbowl_factory.wasm", root));
const tusdcWasm = readFileSync(new URL("target/wasm32-unknown-unknown/release/nearbowl_tusdc.wasm", root));

async function ensureContract(id, wasm, initActions) {
  const child = account(id, rpc, key.toString());
  if (!(await exists(id, rpc))) {
    if (!id.endsWith(`.${accountId}`)) {
      throw new Error(`${id} does not exist and is not a sub-account of ${accountId}`);
    }
    console.log(`creating ${id}`);
    await send(deployer, id, [
      actions.createAccount(),
      actions.transfer(near("8")),
      actions.addFullAccessKey(key.getPublicKey()),
      actions.deployContract(wasm),
      ...initActions,
    ]);
    return;
  }
  console.log(`updating code on ${id} (state is left as it is)`);
  await send(child, id, [actions.deployContract(wasm)]);
}

const { params: factoryParams, applied: timerOverrides } = demoParamsFromEnv();
if (factoryId === PUBLIC_FACTORY_ID && factoryParams.allow_demo_controls) {
  throw new Error(`${PUBLIC_FACTORY_ID} is the public factory. Initialize it with ALLOW_DEMO_CONTROLS=false.`);
}

console.log(`deployer ${accountId}`);
console.log(`tUSDC    ${tusdcId}`);
console.log(`factory  ${factoryId}`);
console.log(timerOverrides.length ? `timer overrides: ${timerOverrides.join(", ")}` : "timer overrides: none (demo defaults)");
console.log(`initial_life_ns=${factoryParams.initial_life_ns} t_ref_ns=${factoryParams.t_ref_ns}`);
console.log(`max_life_min_ns=${factoryParams.max_life_min_ns} max_life_max_ns=${factoryParams.max_life_max_ns}`);
console.log(`allow_demo_controls=${factoryParams.allow_demo_controls}`);
console.log("Init params apply only when the factory account is created. Updating an existing factory leaves timers unchanged.");
if (factoryId === LEGACY_FACTORY_ID) {
  console.log(`${LEGACY_FACTORY_ID} is the legacy short-timer factory. The app does not use it.`);
} else if (factoryId === PUBLIC_FACTORY_ID) {
  console.log(`${PUBLIC_FACTORY_ID} is the public factory. Timer controls must stay off.`);
}
console.log(`init params ${JSON.stringify(factoryParams)}`);

await ensureContract(tusdcId, tusdcWasm, [call("new", { owner_id: accountId }, 30)]);

await ensureContract(factoryId, factoryWasm, [
  call(
    "new",
    { owner_id: accountId, usdc_account_id: tusdcId, params: factoryParams },
    80,
    near("0.005"),
  ),
]);

const demoActors = ["alice", "bob", "carol"].map((name) => optional(`DEMO_${name.toUpperCase()}_ID`, `${name}.${accountId}`));
for (const id of demoActors) {
  if (await exists(id, rpc)) continue;
  if (!id.endsWith(`.${accountId}`)) {
    console.log(`skip ${id} (not a sub-account, create it yourself)`);
    continue;
  }
  console.log(`creating demo account ${id}`);
  await send(deployer, id, [actions.createAccount(), actions.transfer(near("3")), actions.addFullAccessKey(key.getPublicKey())]);
}

console.log("done");
console.log(`FACTORY_ACCOUNT_ID=${factoryId}`);
console.log(`TUSDC_ACCOUNT_ID=${tusdcId}`);
