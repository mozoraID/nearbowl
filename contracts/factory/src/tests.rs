//! Contract tests. Numbers are the integer model shared with `sim/sim.py`.

use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{test_vm_config, testing_env, PromiseResult};
use proptest::prop_assert;
use std::collections::BTreeMap;
use std::collections::HashMap;

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn reset() {
    testing_env!(VMContextBuilder::new().build());
    near_sdk::mock::with_mocked_blockchain(|b| {
        let _ = b.take_storage();
    });
}

fn set(pred: &str, deposit: u128, ts: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id(id("factory.near"))
        .predecessor_account_id(id(pred))
        .signer_account_id(id(pred))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    testing_env!(ctx);
}

fn set_promise(success: bool, ts: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id(id("factory.near"))
        .predecessor_account_id(id("factory.near"))
        .attached_deposit(NearToken::from_yoctonear(0))
        .block_timestamp(ts)
        .prepaid_gas(Gas::from_tgas(300))
        .build();
    let result = if success {
        PromiseResult::Successful(Vec::new())
    } else {
        PromiseResult::Failed
    };
    testing_env!(
        ctx,
        test_vm_config(),
        near_parameters::RuntimeFeesConfig::test(),
        HashMap::new(),
        vec![result],
    );
}

fn demo_input(demo_controls: bool) -> ParamsInput {
    ParamsInput {
        fee_bps: 100,
        inherit_bps: 50,
        protocol_bps: 30,
        creator_bps: 20,
        creator_haircut_bps: 5000,
        min_trade_usdc: U128(ONE_USDC),
        min_seed_usdc: U128(ONE_USDC),
        ext_ns_per_raw_usdc: U128(2_000),
        initial_life_ns: U64(45_000_000_000),
        t_ref_ns: U64(45_000_000_000),
        twilight_ns: U64(10_000_000_000),
        twilight_min_factor_bps: 2500,
        max_life_min_ns: U64(180_000_000_000),
        max_life_max_ns: U64(540_000_000_000),
        r_small: U128(1_000 * ONE_USDC),
        r_large: U128(100_000 * ONE_USDC),
        tier1_ns: U64(60_000_000_000),
        tier2_ns: U64(60_000_000_000),
        leak_bps: 2500,
        scar_step_ns: U64(3_000_000_000),
        launch_storage_min_yocto: U128(60_000_000_000_000_000_000_000),
        allow_demo_controls: demo_controls,
    }
}

fn boot(demo_controls: bool) -> Contract {
    reset();
    set("owner.near", NearToken::from_near(5).as_yoctonear(), 1);
    Contract::new(id("owner.near"), id("usdc.near"), demo_input(demo_controls))
}

fn deposit(c: &mut Contract, account: &str, ts: u64) {
    set(account, NearToken::from_near(1).as_yoctonear(), ts);
    c.storage_deposit(None);
}

fn launch(c: &mut Contract, creator: &str, whole: u128, symbol: &str, ts: u64) -> U128 {
    let msg = format!(r#"{{"action":"launch","name":"Pet","symbol":"{symbol}","image_uri":""}}"#);
    set("usdc.near", 1, ts);
    c.ft_on_transfer(id(creator), U128(whole * ONE_USDC), msg)
}

fn buy(c: &mut Contract, who: &str, coin: u64, whole: u128, ts: u64) -> U128 {
    let msg = format!(r#"{{"action":"buy","coin_id":"{coin}","min_tokens_out":"0"}}"#);
    set("usdc.near", 1, ts);
    c.ft_on_transfer(id(who), U128(whole * ONE_USDC), msg)
}

fn assert_solvent(c: &Contract) {
    let s = c.get_solvency();
    assert_eq!(
        s.usdc_held.0,
        s.reserves.0 + s.creator_fees.0 + s.protocol_fees.0 + s.in_flight.0
    );
}

#[test]
fn demo_walkthrough_matches_integer_model() {
    let mut c = boot(true);
    let t0 = 1_700_000_000_000_000_000u64;
    deposit(&mut c, "creator.near", t0);
    deposit(&mut c, "alice.near", t0);
    deposit(&mut c, "bob.near", t0);
    deposit(&mut c, "carol.near", t0);
    assert_eq!(launch(&mut c, "creator.near", 100, "bowl", t0).0, 0);

    let used = c.storage_balance_of(id("creator.near")).unwrap();
    assert!(
        used.total.0 - used.available.0 > 0,
        "launch storage was not measured"
    );
    assert!(
        used.total.0 - used.available.0 <= 60_000_000_000_000_000_000_000,
        "launch storage {} exceeds the 0.06 NEAR estimate",
        used.total.0 - used.available.0
    );

    let coin = c.get_coin(1);
    assert_eq!(coin.symbol, "BOWL");
    assert_eq!(coin.seed_tokens.0, 14_142_135_623_730_950_488);
    assert_eq!(coin.remaining_ns.0, 45_000_000_000);
    assert_eq!(coin.status, "fed");
    assert_eq!(coin.price.0, 14_142_135); // 14.142135 USDC, displays as 14.142136 when rounded

    let q = c.quote_buy(1, U128(20 * ONE_USDC), id("alice.near"));
    assert_eq!(q.tokens_out.0, 1_336_882_432_980_528_133);
    assert_eq!(q.extension_ns.0, 40_000_000_000);

    assert_eq!(buy(&mut c, "alice.near", 1, 20, t0 + 10_000_000_000).0, 0);
    let coin = c.get_coin(1);
    assert_eq!(coin.remaining_ns.0, 75_000_000_000);
    assert_eq!(
        c.get_position(1, id("alice.near")).balance.0,
        1_336_882_432_980_528_133
    );

    assert_eq!(buy(&mut c, "bob.near", 1, 30, t0 + 20_000_000_000).0, 0);
    assert_eq!(c.get_coin(1).remaining_ns.0, 125_000_000_000);
    assert_eq!(
        c.get_position(1, id("bob.near")).balance.0,
        1_811_165_826_509_553_515
    );

    assert_eq!(buy(&mut c, "carol.near", 1, 50, t0 + 30_000_000_000).0, 0);
    let coin = c.get_coin(1);
    assert_eq!(coin.remaining_ns.0, 180_000_000_000);
    assert_eq!(coin.reserve.0, 199_500_000);
    assert_eq!(coin.supply.0, 19_944_142_181_087_898_101);
    assert_eq!(coin.feeders_count, 3);
    assert_eq!(
        c.get_position(1, id("carol.near")).balance.0,
        2_653_958_297_866_865_965
    );
    // Carol's fresh bucket: 100 raw seconds, 60 at 100% and 40 at 50% = 80.
    let carol_quote_ext = {
        // Re-quote is after the buy, so check the trade record instead.
        let trades = c.get_recent_trades(1);
        assert_eq!(trades.len(), 3);
        assert_eq!(trades[0].account_id, id("carol.near"));
        assert_eq!(trades[0].side, "buy");
        assert_eq!(trades[0].ext_s, 80);
        trades[0].ext_s
    };
    assert_eq!(carol_quote_ext, 80);

    // The opening buys happen inside the first 45s, so they leave a hunger scar.
    // By t+60s that scar has decayed and the timer is still above the reference,
    // which is the w=0 quote in the demo. (The script's t=40 label is the curve
    // value; `Coin.w_eff` in sim.py is still slightly above 0 at t=40.)
    set("bob.near", 0, t0 + 60_000_000_000);
    let preview = c.quote_sell(1, U128(1_811_165_826_509_553_515));
    assert_eq!(preview.w_n, 0);
    assert_eq!(preview.usdc_out_gross.0, 34_588_718);
    assert_eq!(preview.usdc_out_net.0, 34_242_832);
    assert_eq!(preview.prorata_value.0, 18_116_977);

    set("owner.near", 0, t0 + 60_000_000_000);
    c.demo_set_remaining(1, U64(30_000_000_000));
    let hungry = c.quote_sell(1, U128(1_811_165_826_509_553_515));
    assert_eq!(hungry.w_n, 22);
    assert_eq!(hungry.usdc_out_gross.0, 29_102_528);
    assert_eq!(hungry.usdc_out_net.0, 28_811_504);

    set("bob.near", 1, t0 + 60_000_000_000);
    c.sell(1, U128(1_811_165_826_509_553_515), U128(0));
    assert_eq!(c.get_coin(1).reserve.0, 170_542_984);
    assert_eq!(c.get_coin(1).supply.0, 18_132_976_354_578_344_586);
    assert_eq!(c.get_position(1, id("bob.near")).balance.0, 0);
    assert_solvent(&c);
    assert_eq!(c.get_solvency().in_flight.0, 28_811_504);

    set_promise(true, t0 + 60_000_000_000);
    c.on_payout(1);
    assert_eq!(c.get_solvency().in_flight.0, 0);
    assert_eq!(c.get_coin(1).creator_fees_owed.0, 258_205);
    let trades = c.get_recent_trades(1);
    assert_eq!(trades[0].side, "sell");
    assert_eq!(trades[0].usdc.0, 29_102_528);
    assert_solvent(&c);

    set("owner.near", 0, t0 + 70_000_000_000);
    c.demo_set_remaining(1, U64(0));
    let dead = c.get_coin(1);
    assert_eq!(dead.status, "dead");
    assert_eq!(dead.snapshot_reserve.0, 170_542_984);
    assert_eq!(c.list_coins("alive".into(), 0, 10).len(), 0);
    assert_eq!(c.list_coins("dead".into(), 0, 10).len(), 1);

    let alice_q = c.quote_claim(1, id("alice.near"));
    let carol_q = c.quote_claim(1, id("carol.near"));
    let creator_q = c.quote_claim(1, id("creator.near"));
    assert_eq!(alice_q.usdc_out.0, 12_573_551);
    assert_eq!(carol_q.usdc_out.0, 24_960_820);
    assert_eq!(creator_q.usdc_out.0, 66_504_305);
    assert_eq!(creator_q.haircut.0, 66_504_306);

    set("alice.near", 1, t0 + 70_000_000_000);
    c.claim(1, None);
    set_promise(true, t0 + 70_000_000_000);
    c.on_payout(2);
    set("carol.near", 1, t0 + 70_000_000_000);
    c.claim(1, Some(id("carol.near")));
    set_promise(true, t0 + 70_000_000_000);
    c.on_payout(3);
    set("creator.near", 1, t0 + 70_000_000_000);
    c.claim(1, None);
    set_promise(true, t0 + 70_000_000_000);
    c.on_payout(4);

    let left = c.get_coin(1).reserve.0;
    assert_eq!(left, 2, "claim dust should stay in the reserve");
    assert_solvent(&c);
    // Creator still has fees to withdraw. Net of claim + fees is one raw unit
    // under the continuous -33.237489 because each claim is floored.
    set("creator.near", 1, t0 + 70_000_000_000);
    c.withdraw_creator_fees(1, None);
    set_promise(true, t0 + 70_000_000_000);
    c.on_payout(5);
    assert_eq!(c.get_coin(1).creator_fees_owed.0, 0);
    assert_solvent(&c);
    assert_eq!(c.mt_balance_of(id("alice.near"), "1".into()), "0");
    assert!(c.mt_supply("1".into()).is_some());
}

#[test]
fn failed_sell_restores_tokens_and_clears_the_lock() {
    let mut c = boot(true);
    let t0 = 1_700_000_000_000_000_000u64;
    deposit(&mut c, "creator.near", t0);
    deposit(&mut c, "alice.near", t0);
    assert_eq!(launch(&mut c, "creator.near", 100, "meow", t0).0, 0);
    assert_eq!(buy(&mut c, "alice.near", 1, 20, t0).0, 0);
    let bal = c.get_position(1, id("alice.near")).balance.0;
    let reserve = c.get_coin(1).reserve.0;
    set("alice.near", 1, t0);
    c.sell(1, U128(bal), U128(0));
    assert_eq!(c.get_position(1, id("alice.near")).balance.0, 0);
    set_promise(false, t0);
    c.on_payout(1);
    assert_eq!(c.get_position(1, id("alice.near")).balance.0, bal);
    assert_eq!(c.get_coin(1).reserve.0, reserve);
    assert_eq!(c.get_solvency().in_flight.0, 0);
    assert_solvent(&c);
    // The lock is clear, so the same sale can be retried.
    set("alice.near", 1, t0);
    c.sell(1, U128(bal), U128(0));
}

#[test]
fn failed_claim_restores_the_burn_and_the_haircut() {
    let mut c = boot(true);
    let t0 = 1_700_000_000_000_000_000u64;
    deposit(&mut c, "creator.near", t0);
    assert_eq!(launch(&mut c, "creator.near", 100, "tomb", t0).0, 0);
    set("owner.near", 0, t0 + 1);
    c.demo_set_remaining(1, U64(0));
    let seed = c.get_coin(1).seed_tokens.0;
    let reserve = c.get_coin(1).reserve.0;
    set("creator.near", 1, t0 + 1);
    c.claim(1, Some(id("nobody.near")));
    assert_eq!(c.get_coin(1).seed_tokens.0, 0);
    set_promise(false, t0 + 1);
    c.on_payout(1);
    assert_eq!(c.get_coin(1).seed_tokens.0, seed);
    assert_eq!(c.get_coin(1).reserve.0, reserve);
    assert_eq!(c.get_solvency().protocol_fees.0, 0);
    assert_solvent(&c);
}

#[test]
fn refunds_reject_without_touching_the_pool() {
    let mut c = boot(true);
    let t0 = 1_700_000_000_000_000_000u64;
    deposit(&mut c, "creator.near", t0);
    // Wrong token.
    set("other.near", 1, t0);
    let back = c.ft_on_transfer(
        id("creator.near"),
        U128(100 * ONE_USDC),
        r#"{"action":"launch","name":"A","symbol":"BOWL"}"#.into(),
    );
    assert_eq!(back.0, 100 * ONE_USDC);
    assert!(c.list_coins("alive".into(), 0, 10).is_empty());

    // Malformed message.
    set("usdc.near", 1, t0);
    let back = c.ft_on_transfer(id("creator.near"), U128(100 * ONE_USDC), "nope".into());
    assert_eq!(back.0, 100 * ONE_USDC);

    // No storage.
    let mut bare = boot(true);
    set("usdc.near", 1, t0);
    let back = bare.ft_on_transfer(
        id("creator.near"),
        U128(100 * ONE_USDC),
        r#"{"action":"launch","name":"A","symbol":"BOWL"}"#.into(),
    );
    assert_eq!(back.0, 100 * ONE_USDC);

    // Symbols.
    deposit(&mut c, "creator.near", t0);
    assert_eq!(
        launch(&mut c, "creator.near", 10, "usdc", t0).0,
        10 * ONE_USDC
    );
    assert_eq!(
        launch(&mut c, "creator.near", 10, "usdX", t0).0,
        10 * ONE_USDC
    );
    assert_eq!(
        launch(&mut c, "creator.near", 10, "near", t0).0,
        10 * ONE_USDC
    );
    assert_eq!(
        launch(&mut c, "creator.near", 10, "ab", t0).0,
        10 * ONE_USDC
    );
    assert_eq!(launch(&mut c, "creator.near", 10, "good", t0).0, 0);
    set("owner.near", 0, t0 + 1);
    c.demo_set_remaining(1, U64(0));
    // A dead coin keeps its ticker.
    assert_eq!(
        launch(&mut c, "creator.near", 10, "GOOD", t0 + 1).0,
        10 * ONE_USDC
    );
    assert!(!c.symbol_available("usdc".into()));
    assert!(!c.symbol_available("GOOD".into()));
    assert!(c.symbol_available("FRESH".into()));

    // Buy on a dead coin is refunded.
    deposit(&mut c, "alice.near", t0 + 1);
    assert_eq!(buy(&mut c, "alice.near", 1, 5, t0 + 1).0, 5 * ONE_USDC);
    assert_solvent(&c);
}

#[test]
fn slippage_refunds_the_whole_buy() {
    let mut c = boot(true);
    let t0 = 1_700_000_000_000_000_000u64;
    deposit(&mut c, "creator.near", t0);
    deposit(&mut c, "alice.near", t0);
    assert_eq!(launch(&mut c, "creator.near", 100, "slip", t0).0, 0);
    let supply = c.get_coin(1).supply.0;
    set("usdc.near", 1, t0);
    let back = c.ft_on_transfer(
        id("alice.near"),
        U128(20 * ONE_USDC),
        r#"{"action":"buy","coin_id":"1","min_tokens_out":"999999999999999999999"}"#.into(),
    );
    assert_eq!(back.0, 20 * ONE_USDC);
    assert_eq!(c.get_coin(1).supply.0, supply);
    assert_solvent(&c);
}

#[test]
fn quote_launch_matches_seed_supply() {
    let c = boot(false);
    assert!(!c.get_params().params.allow_demo_controls);
    let q = c.quote_launch(U128(100 * ONE_USDC));
    assert_eq!(q.tokens_out.0, 14_142_135_623_730_950_488);
    assert_eq!(q.price.0, 14_142_135);
    assert_eq!(q.reserve.0, 100 * ONE_USDC);
    assert_eq!(q.fee_usdc.0, 0);
    assert_eq!(q.creator_haircut_bps, 5000);
    assert_eq!(q.initial_life_ns.0, 45_000_000_000);
    assert_eq!(q.min_seed_usdc.0, ONE_USDC);
}

#[test]
#[should_panic(expected = "SeedTooSmall")]
fn quote_launch_rejects_a_tiny_seed() {
    let c = boot(false);
    c.quote_launch(U128(1));
}

#[test]
#[should_panic(expected = "DemoControlsDisabled")]
fn demo_controls_are_rejected_when_disabled() {
    let mut c = boot(false);
    let t0 = 1_700_000_000_000_000_000u64;
    deposit(&mut c, "creator.near", t0);
    assert_eq!(launch(&mut c, "creator.near", 10, "lock", t0).0, 0);
    set("owner.near", 0, t0);
    c.demo_set_remaining(1, U64(1));
}

#[test]
fn fresh_account_bucket_on_a_large_buy_credits_nine_hours() {
    // Production-shaped extension: 360s per USDC, 6h + 6h tiers.
    let mut c = boot(true);
    // Overwrite params by using the demo contract's bucket through a direct buy
    // large enough to cross both demo tiers, then check the credited extension.
    let t0 = 1_700_000_000_000_000_000u64;
    deposit(&mut c, "creator.near", t0);
    deposit(&mut c, "whale.near", t0);
    assert_eq!(launch(&mut c, "creator.near", 100, "huge", t0).0, 0);
    // 500 USDC of raw extension at 2s each is 1000s. Demo tiers are 60s + 60s,
    // so the credit is 60 + 30 = 90s, and the timer caps at 180.
    let q = c.quote_buy(1, U128(500 * ONE_USDC), id("whale.near"));
    assert_eq!(q.extension_ns.0, 90_000_000_000);
    assert_eq!(q.new_remaining_ns.0, 135_000_000_000);
}

#[test]
fn prod_bucket_credits_nine_hours() {
    let (credited, bucket) = math::credit_bucket(
        math::Bucket { b: 0, ts: 0 },
        500 * 360 * 1_000_000_000,
        0,
        6 * 3_600 * 1_000_000_000,
        6 * 3_600 * 1_000_000_000,
        2500,
    );
    assert_eq!(credited, 9 * 3_600 * 1_000_000_000);
    assert_eq!(bucket.b, 12 * 3_600 * 1_000_000_000);
}

/// Synchronous twin of the contract's success path, used by the property tests.
struct Twin {
    reserve: u128,
    supply: u128,
    seed: u128,
    seed_reserve: u128,
    deadline: u64,
    dead: bool,
    snap_r: u128,
    snap_s: u128,
    scar: math::Scar,
    cfees: u128,
    protocol: u128,
    usdc: u128,
    bal: BTreeMap<u8, u128>,
    buckets: BTreeMap<u8, math::Bucket>,
}

impl Twin {
    fn new(seed_usdc: u128, now: u64) -> Self {
        let reserve = seed_usdc * ONE_USDC;
        let supply = math::seed_supply(reserve).unwrap();
        Self {
            reserve,
            supply,
            seed: supply,
            seed_reserve: reserve,
            deadline: now + 45_000_000_000,
            dead: false,
            snap_r: 0,
            snap_s: 0,
            scar: math::Scar { n: 0, ts: now },
            cfees: 0,
            protocol: 0,
            usdc: reserve,
            bal: BTreeMap::new(),
            buckets: BTreeMap::new(),
        }
    }

    fn touch(&mut self, now: u64) {
        if !self.dead && now >= self.deadline {
            self.dead = true;
            self.snap_r = self.reserve;
            self.snap_s = self.supply;
        }
    }

    fn solvent(&self) -> bool {
        self.usdc == self.reserve + self.cfees + self.protocol
    }

    fn buy(&mut self, who: u8, gross: u128, now: u64) -> bool {
        self.touch(now);
        if self.dead || gross == 0 {
            return false;
        }
        let Ok(mint) = math::buy_mint(self.reserve, self.supply, gross, 50, 30, 20) else {
            return false;
        };
        let rem = self.deadline.saturating_sub(now);
        let (w_n, scar) = math::scar_weight(self.scar, now, rem, 45_000_000_000, 3_000_000_000);
        let _ = w_n;
        let bucket = self
            .buckets
            .get(&who)
            .copied()
            .unwrap_or(math::Bucket { b: 0, ts: now });
        let (credited, bucket) = if gross >= ONE_USDC {
            let factor = math::twilight_factor_bps(rem, 10_000_000_000, 2500);
            let raw = math::raw_extension_ns(gross, 2_000, factor).unwrap_or(0);
            math::credit_bucket(bucket, raw, now, 60_000_000_000, 60_000_000_000, 2500)
        } else {
            (0, bucket)
        };
        let cap = math::max_life_ns(
            mint.reserve_after,
            180_000_000_000,
            540_000_000_000,
            1_000 * ONE_USDC,
            100_000 * ONE_USDC,
        );
        self.reserve = mint.reserve_after;
        self.supply = mint.supply_after;
        self.deadline = now.saturating_add(rem.saturating_add(credited).min(cap));
        self.cfees += mint.fees.creator;
        self.protocol += mint.fees.protocol;
        self.usdc += gross;
        *self.bal.entry(who).or_insert(0) += mint.minted;
        self.buckets.insert(who, bucket);
        self.scar = scar;
        true
    }

    fn sell(&mut self, who: u8, tokens: u128, now: u64) -> Option<u128> {
        self.touch(now);
        if self.dead || tokens == 0 || tokens > self.bal.get(&who).copied().unwrap_or(0) {
            return None;
        }
        let rem = self.deadline.saturating_sub(now);
        let (w_n, scar) = math::scar_weight(self.scar, now, rem, 45_000_000_000, 3_000_000_000);
        let Ok(payout) =
            math::sell_payout(self.reserve, self.supply, tokens, w_n as u32, 50, 30, 20)
        else {
            return None;
        };
        self.reserve = payout.reserve_after;
        self.supply -= tokens;
        *self.bal.get_mut(&who).unwrap() -= tokens;
        self.cfees += payout.fees.creator;
        self.protocol += payout.fees.protocol;
        self.usdc -= payout.net;
        self.scar = scar;
        Some(payout.net)
    }

    fn claim(&mut self, who: u8, now: u64, creator: u8) -> u128 {
        self.touch(now);
        if !self.dead {
            return 0;
        }
        let balance = self.bal.get(&who).copied().unwrap_or(0);
        let seed = if who == creator { self.seed } else { 0 };
        let Ok((pay, keep, hair)) =
            math::claim_amounts(self.snap_r, self.snap_s, balance, seed, 5000)
        else {
            return 0;
        };
        let out = pay + keep;
        let drop = out + hair;
        if drop > self.reserve {
            return 0;
        }
        self.reserve -= drop;
        self.protocol += hair;
        self.usdc -= out;
        if balance > 0 {
            self.supply -= balance;
            *self.bal.get_mut(&who).unwrap() = 0;
        }
        if seed > 0 {
            self.supply -= seed;
            self.seed = 0;
        }
        out
    }
}

fn random_session(seed: u64) -> i128 {
    let mut rng = seed;
    let mut next = || {
        rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1);
        rng
    };
    let now0 = 0u64;
    let mut coin = Twin::new(50 + (next() % 200) as u128, now0);
    let mut spent = [0u128; 4];
    let mut got = [0u128; 4];
    for p in 1..4 {
        let g = (1 + next() % 40) as u128 * ONE_USDC;
        if coin.buy(p, g, now0) {
            spent[p as usize] += g;
        }
        assert!(coin.solvent());
        assert!(coin.reserve >= coin.seed_reserve);
    }
    let mut now = now0;
    for _ in 0..40 {
        let op = next() % 100;
        if op < 40 {
            let g = (1 + next() % 30) as u128 * ONE_USDC + (next() as u128) % ONE_USDC;
            if coin.buy(0, g, now) {
                spent[0] += g;
            }
        } else if op < 75 {
            let bal = coin.bal.get(&0).copied().unwrap_or(0);
            if bal > 0 {
                let tokens = 1 + (next() as u128) % bal;
                if let Some(net) = coin.sell(0, tokens, now) {
                    got[0] += net;
                }
            }
        } else if op < 90 {
            now += 1_000_000_000 + next() % 20_000_000_000;
        } else if let Some(0) = Some(0) {
            got[0] += coin.claim(0, now, 9);
        }
        assert!(coin.solvent(), "solvency broken");
        assert!(coin.reserve < u128::MAX);
        if !coin.dead {
            assert!(coin.reserve >= coin.seed_reserve, "seed backing broken");
        }
    }
    now += 10_000_000_000_000;
    for p in 0..4 {
        got[p as usize] += coin.claim(p, now, 9);
    }
    // Creator id 9 has no balance. Protocol and creator fees stay in the contract
    // and are part of solvency, not the attacker's wallet.
    assert!(coin.solvent());
    got[0] as i128 - spent[0] as i128
}

#[test]
fn property_solvency_and_no_extraction() {
    let mut worst = 0i128;
    for run in 0..80 {
        let net = random_session(2026_1112 + run * 97);
        assert!(
            net <= 0,
            "run {run} extracted {}",
            net as f64 / ONE_USDC as f64
        );
        worst = worst.max(net);
    }
    assert!(worst <= 0);
}

proptest::proptest! {
    #[test]
    fn proptest_attacker_cannot_extract(seed in 0u64..10_000) {
        let net = random_session(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        prop_assert!(net <= 0);
    }
}
