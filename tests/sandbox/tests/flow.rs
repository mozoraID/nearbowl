//! Sandbox coverage for the cross-contract paths: launch, buy, feed, sell,
//! death, claim, and the refund / failed-callback cases.

use anyhow::Context;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const ONE: u128 = 1_000_000;
const REG: u128 = 1_250_000_000_000_000_000_000;

fn wasm(name: &str) -> Vec<u8> {
    let path = format!(
        "{}/../../target/wasm32-unknown-unknown/release/{name}.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&path)
        .unwrap_or_else(|_| panic!("missing {path}. Run scripts/build-contracts.sh first."))
}

fn demo_params(demo: bool) -> Value {
    json!({
        "fee_bps": 100,
        "inherit_bps": 50,
        "protocol_bps": 30,
        "creator_bps": 20,
        "creator_haircut_bps": 5000,
        "min_trade_usdc": "1000000",
        "min_seed_usdc": "1000000",
        "ext_ns_per_raw_usdc": "2000",
        "initial_life_ns": "45000000000",
        "t_ref_ns": "45000000000",
        "twilight_ns": "10000000000",
        "twilight_min_factor_bps": 2500,
        "max_life_min_ns": "180000000000",
        "max_life_max_ns": "540000000000",
        "r_small": "1000000000",
        "r_large": "100000000000",
        "tier1_ns": "60000000000",
        "tier2_ns": "60000000000",
        "leak_bps": 2500,
        "scar_step_ns": "3000000000",
        "launch_storage_min_yocto": "60000000000000000000000",
        "allow_demo_controls": demo
    })
}

async fn deploy_tusdc(
    worker: &Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
) -> anyhow::Result<Contract> {
    let contract = worker.dev_deploy(&wasm("nearbowl_tusdc")).await?;
    let res = contract
        .call("new")
        .args_json(json!({ "owner_id": owner.id() }))
        .transact()
        .await?;
    assert!(res.is_success(), "tusdc init: {res:?}");
    Ok(contract)
}

async fn deploy_factory(
    worker: &Worker<near_workspaces::network::Sandbox>,
    owner: &Account,
    tusdc: &Contract,
    demo: bool,
) -> anyhow::Result<Contract> {
    let contract = worker.dev_deploy(&wasm("nearbowl_factory")).await?;
    let res = owner
        .call(contract.id(), "new")
        .args_json(json!({
            "owner_id": owner.id(),
            "usdc_account_id": tusdc.id(),
            "params": demo_params(demo),
        }))
        .deposit(NearToken::from_millinear(5))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(res.is_success(), "factory init: {res:?}");
    Ok(contract)
}

async fn register_and_mint(
    tusdc: &Contract,
    owner: &Account,
    account: &Account,
    whole: u128,
) -> anyhow::Result<()> {
    let res = account
        .call(tusdc.id(), "storage_deposit")
        .args_json(json!({ "account_id": account.id() }))
        .deposit(NearToken::from_yoctonear(REG))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    assert!(res.is_success(), "usdc register {}: {res:?}", account.id());
    let res = owner
        .call(tusdc.id(), "mint")
        .args_json(json!({ "account_id": account.id(), "amount": (whole * ONE).to_string() }))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    assert!(res.is_success(), "mint {}: {res:?}", account.id());
    Ok(())
}

async fn factory_storage(factory: &Contract, account: &Account) -> anyhow::Result<()> {
    let res = account
        .call(factory.id(), "storage_deposit")
        .args_json(json!({}))
        .deposit(NearToken::from_near(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(
        res.is_success(),
        "factory storage {}: {res:?}",
        account.id()
    );
    Ok(())
}

async fn balance(tusdc: &Contract, account: &near_workspaces::AccountId) -> anyhow::Result<u128> {
    let view = tusdc
        .view("ft_balance_of")
        .args_json(json!({ "account_id": account }))
        .await?;
    let text: String = view.json()?;
    Ok(text.parse()?)
}

async fn transfer_call(
    tusdc: &Contract,
    sender: &Account,
    factory: &Contract,
    whole: u128,
    msg: Value,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let msg = if msg.is_string() {
        msg.as_str().unwrap().to_string()
    } else {
        msg.to_string()
    };
    Ok(sender
        .call(tusdc.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": factory.id(),
            "amount": (whole * ONE).to_string(),
            "memo": null,
            "msg": msg,
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(200))
        .transact()
        .await?)
}

fn num(v: &Value, key: &str) -> u128 {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("0")
        .parse()
        .unwrap_or(0)
}

#[tokio::test]
async fn lifecycle_refunds_and_failed_callback() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.dev_create_account().await?;
    let creator = worker.dev_create_account().await?;
    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let carol = worker.dev_create_account().await?;
    let stranger = worker.dev_create_account().await?;

    let tusdc = deploy_tusdc(&worker, &owner).await?;
    let factory = deploy_factory(&worker, &owner, &tusdc, true).await?;

    // Factory registered itself on tUSDC during init.
    let registered = tusdc
        .view("storage_balance_of")
        .args_json(json!({ "account_id": factory.id() }))
        .await?
        .json::<Option<Value>>()?;
    assert!(
        registered.is_some(),
        "factory should be registered on tUSDC"
    );

    for (account, amount) in [(&creator, 200u128), (&alice, 50), (&bob, 50), (&carol, 80)] {
        register_and_mint(&tusdc, &owner, account, amount).await?;
    }

    // Wrong token: a second fungible token is fully refunded. The factory has to be
    // registered on that token first, otherwise the token rejects the transfer
    // before `ft_on_transfer` runs.
    let other = deploy_tusdc(&worker, &owner).await?;
    let res = factory
        .as_account()
        .call(other.id(), "storage_deposit")
        .args_json(json!({ "account_id": factory.id() }))
        .deposit(NearToken::from_yoctonear(REG))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    assert!(
        res.is_success(),
        "register factory on the wrong token: {res:?}"
    );
    register_and_mint(&other, &owner, &creator, 20).await?;
    let before = balance(&other, creator.id()).await?;
    let res = transfer_call(
        &other,
        &creator,
        &factory,
        10,
        json!({"action":"launch","name":"Nope","symbol":"NOPE","image_uri":""}),
    )
    .await?;
    assert!(
        res.is_success(),
        "wrong-token call should resolve, not trap: {res:?}"
    );
    assert_eq!(
        balance(&other, creator.id()).await?,
        before,
        "wrong token must be refunded in full"
    );

    // Malformed message is refunded.
    let before = balance(&tusdc, creator.id()).await?;
    let res = transfer_call(&tusdc, &creator, &factory, 10, json!("not-json")).await?;
    assert!(res.is_success(), "{res:?}");
    assert_eq!(balance(&tusdc, creator.id()).await?, before);

    // Launch without a factory storage deposit is refunded.
    let res = transfer_call(
        &tusdc,
        &creator,
        &factory,
        10,
        json!({"action":"launch","name":"Early","symbol":"EARLY","image_uri":""}),
    )
    .await?;
    assert!(res.is_success(), "{res:?}");
    assert_eq!(balance(&tusdc, creator.id()).await?, before);
    let alive = factory
        .view("list_coins")
        .args_json(json!({"status":"alive","from_index":0,"limit":10}))
        .await?
        .json::<Vec<Value>>()?;
    assert!(alive.is_empty());

    factory_storage(&factory, &creator).await?;
    factory_storage(&factory, &alice).await?;
    factory_storage(&factory, &bob).await?;
    factory_storage(&factory, &carol).await?;

    let res = transfer_call(
        &tusdc,
        &creator,
        &factory,
        100,
        json!({"action":"launch","name":"Bowl Pup","symbol":"BOWL","image_uri":""}),
    )
    .await?;
    assert!(res.is_success(), "launch: {res:?}");
    assert!(
        format!("{res:?}").contains("coin_launched"),
        "launch should emit coin_launched"
    );

    for (account, amount) in [(&alice, 20u128), (&bob, 30u128), (&carol, 50u128)] {
        let res = transfer_call(
            &tusdc,
            account,
            &factory,
            amount,
            json!({"action":"buy","coin_id":"1","min_tokens_out":"0"}),
        )
        .await?;
        assert!(res.is_success(), "buy {}: {res:?}", account.id());
    }

    let coin = factory
        .view("get_coin")
        .args_json(json!({"coin_id": 1}))
        .await?
        .json::<Value>()?;
    assert_eq!(
        num(&coin, "reserve"),
        199_500_000,
        "pool after the three buys"
    );
    assert_eq!(num(&coin, "supply"), 19_944_142_181_087_898_101);
    assert_eq!(coin["feeders_count"], 3);
    let trades = factory
        .view("get_recent_trades")
        .args_json(json!({"coin_id": 1}))
        .await?
        .json::<Vec<Value>>()?;
    assert_eq!(trades.len(), 3);
    assert_eq!(trades[0]["ext_s"], 80, "Carol's tier-2 credit");
    assert_eq!(trades[1]["ext_s"], 60);
    assert_eq!(trades[2]["ext_s"], 40);

    // Pin the clock at 30s remaining and sell Bob's position. The scar from the
    // opening buys is below 22/64, so the exit is the demo's hungry quote.
    let res = owner
        .call(factory.id(), "demo_set_remaining")
        .args_json(json!({"coin_id": 1, "remaining_ns": "30000000000"}))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(res.is_success(), "demo_set: {res:?}");

    let bob_pos = factory
        .view("get_position")
        .args_json(json!({"coin_id": 1, "account_id": bob.id()}))
        .await?
        .json::<Value>()?;
    let bob_tokens = num(&bob_pos, "balance");
    assert_eq!(bob_tokens, 1_811_165_826_509_553_515);

    let res = bob
        .call(factory.id(), "sell")
        .args_json(json!({
            "coin_id": 1,
            "tokens_in": bob_tokens.to_string(),
            "min_usdc_out": "0",
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(80))
        .transact()
        .await?;
    assert!(res.is_success(), "sell: {res:?}");
    assert_eq!(
        balance(&tusdc, bob.id()).await?,
        50 * ONE - 30 * ONE + 28_811_504,
        "Bob's net payout"
    );

    let coin = factory
        .view("get_coin")
        .args_json(json!({"coin_id": 1}))
        .await?
        .json::<Value>()?;
    assert_eq!(num(&coin, "reserve"), 170_542_984);
    assert_eq!(coin["w_n"], 22);

    let res = owner
        .call(factory.id(), "demo_set_remaining")
        .args_json(json!({"coin_id": 1, "remaining_ns": "0"}))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(res.is_success(), "kill: {res:?}");
    let dead = factory
        .view("list_coins")
        .args_json(json!({"status":"dead","from_index":0,"limit":10}))
        .await?
        .json::<Vec<Value>>()?;
    assert_eq!(dead.len(), 1);
    assert_eq!(dead[0]["status"], "dead");

    // A buy on the dead coin is refunded.
    let before = balance(&tusdc, carol.id()).await?;
    let res = transfer_call(
        &tusdc,
        &carol,
        &factory,
        5,
        json!({"action":"buy","coin_id":"1","min_tokens_out":"0"}),
    )
    .await?;
    assert!(res.is_success(), "{res:?}");
    assert_eq!(balance(&tusdc, carol.id()).await?, before);

    // Claim to an account that is not registered on tUSDC. The callback restores state.
    let seed_before = num(
        &factory
            .view("get_coin")
            .args_json(json!({"coin_id": 1}))
            .await?
            .json::<Value>()?,
        "seed_tokens",
    );
    let res = creator
        .call(factory.id(), "claim")
        .args_json(json!({"coin_id": 1, "receiver_id": stranger.id()}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(80))
        .transact()
        .await?;
    assert!(
        res.is_success(),
        "failed payout must not trap the receipt: {res:?}"
    );
    let seed_after = num(
        &factory
            .view("get_coin")
            .args_json(json!({"coin_id": 1}))
            .await?
            .json::<Value>()?,
        "seed_tokens",
    );
    assert_eq!(seed_after, seed_before, "failed claim restores seed tokens");
    assert_eq!(balance(&tusdc, stranger.id()).await.unwrap_or(0), 0);

    // The same claim to a registered account pays the haircut split.
    let res = creator
        .call(factory.id(), "claim")
        .args_json(json!({"coin_id": 1}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(80))
        .transact()
        .await?;
    assert!(res.is_success(), "creator claim: {res:?}");
    // Creator was minted 200, seeded 100, and is paid the haircut share.
    assert_eq!(
        balance(&tusdc, creator.id()).await?,
        200 * ONE - 100 * ONE + 66_504_305
    );

    let res = alice
        .call(factory.id(), "claim")
        .args_json(json!({"coin_id": 1}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(80))
        .transact()
        .await?;
    assert!(res.is_success(), "alice claim: {res:?}");
    assert_eq!(
        balance(&tusdc, alice.id()).await?,
        50 * ONE - 20 * ONE + 12_573_551
    );

    let res = carol
        .call(factory.id(), "claim")
        .args_json(json!({"coin_id": 1}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(80))
        .transact()
        .await?;
    assert!(res.is_success(), "carol claim: {res:?}");
    assert_eq!(
        balance(&tusdc, carol.id()).await?,
        80 * ONE - 50 * ONE + 24_960_820
    );

    let solvency = factory.view("get_solvency").await?.json::<Value>()?;
    let held = num(&solvency, "usdc_held");
    let sum = num(&solvency, "reserves")
        + num(&solvency, "creator_fees")
        + num(&solvency, "protocol_fees")
        + num(&solvency, "in_flight");
    assert_eq!(held, sum, "solvency {solvency}");
    // On-chain tUSDC balance covers the factory's books. Donations would only add to it.
    let factory_usdc = balance(&tusdc, factory.id()).await?;
    assert!(
        factory_usdc >= held,
        "token balance {factory_usdc} vs books {held}"
    );

    // Faucet: 100 tUSDC, then the cooldown rejects a second call.
    register_and_mint(&tusdc, &owner, &stranger, 0).await?;
    // register_and_mint with 0 still mints 0. Call faucet.
    let res = stranger
        .call(tusdc.id(), "faucet")
        .args_json(json!({}))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    assert!(res.is_success(), "faucet: {res:?}");
    assert_eq!(balance(&tusdc, stranger.id()).await?, 100 * ONE);
    let res = stranger
        .call(tusdc.id(), "faucet")
        .args_json(json!({}))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    assert!(res.is_failure(), "faucet cooldown should reject");
    assert!(format!("{res:?}").contains("FaucetCooldown"), "{res:?}");

    Ok(())
}

#[tokio::test]
async fn demo_controls_rejected_when_disabled() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.dev_create_account().await?;
    let tusdc = deploy_tusdc(&worker, &owner).await?;
    let factory = deploy_factory(&worker, &owner, &tusdc, false)
        .await
        .context("factory")?;
    let params: Value = factory
        .view("get_params")
        .args_json(json!({}))
        .await?
        .json()?;
    assert_eq!(params["params"]["allow_demo_controls"], false);
    let quote: Value = factory
        .view("quote_launch")
        .args_json(json!({"usdc_in": (100 * ONE).to_string()}))
        .await?
        .json()?;
    assert_eq!(quote["tokens_out"], "14142135623730950488");
    assert_eq!(quote["price"], "14142135");
    assert_eq!(quote["fee_usdc"], "0");
    assert_eq!(quote["creator_haircut_bps"], 5000);
    assert_eq!(quote["initial_life_ns"], "45000000000");
    let tiny = factory
        .view("quote_launch")
        .args_json(json!({"usdc_in": "1"}))
        .await;
    assert!(
        tiny.is_err(),
        "a seed below the minimum must fail quote_launch"
    );
    let res = owner
        .call(factory.id(), "demo_set_remaining")
        .args_json(json!({"coin_id": 1, "remaining_ns": "1"}))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    assert!(res.is_failure());
    assert!(
        format!("{res:?}").contains("DemoControlsDisabled")
            || format!("{res:?}").contains("CoinNotFound"),
        "{res:?}"
    );
    // Coin 1 does not exist, so the method checks the flag first. Confirm the flag specifically
    // by the panic text. If CoinNotFound won the race, the flag check is in the wrong order.
    assert!(
        format!("{res:?}").contains("DemoControlsDisabled"),
        "flag must be checked before coin lookup: {res:?}"
    );
    Ok(())
}
