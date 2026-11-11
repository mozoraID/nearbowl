mod math;

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise};

pub use math::{MathError, ONE_USDC};

const RING: u8 = 30;
const YOCTO_PER_BYTE: u128 = 10_000_000_000_000_000_000;
/// Circle USDC `storage_balance_bounds` on NEAR: min = max = 0.00125 NEAR.
const USDC_REGISTRATION_YOCTO: u128 = 1_250_000_000_000_000_000_000;
/// Reject a first buy that cannot cover a position record. The exact cost is
/// measured and charged; this is only the pre-check.
const POSITION_STORAGE_MIN: u128 = 5_000_000_000_000_000_000_000; // 0.005 NEAR
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_CALLBACK: Gas = Gas::from_tgas(40);
const GAS_REGISTER: Gas = Gas::from_tgas(15);
/// While demo controls are on, `demo_set_remaining` holds the contract clock
/// still for this long so the next transaction sees the requested remaining
/// time. One hunger step on the demo timer is only ~0.7s wide.
const DEMO_CLOCK_PIN_NS: u64 = 120_000_000_000;
const PROTOCOL_COIN: u64 = 0;

#[near(serializers = [json])]
#[derive(Clone)]
pub struct ParamsInput {
    pub fee_bps: u32,
    pub inherit_bps: u32,
    pub protocol_bps: u32,
    pub creator_bps: u32,
    pub creator_haircut_bps: u32,
    pub min_trade_usdc: U128,
    pub min_seed_usdc: U128,
    pub ext_ns_per_raw_usdc: U128,
    pub initial_life_ns: U64,
    pub t_ref_ns: U64,
    pub twilight_ns: U64,
    pub twilight_min_factor_bps: u32,
    pub max_life_min_ns: U64,
    pub max_life_max_ns: U64,
    pub r_small: U128,
    pub r_large: U128,
    pub tier1_ns: U64,
    pub tier2_ns: U64,
    pub leak_bps: u32,
    pub scar_step_ns: U64,
    pub launch_storage_min_yocto: U128,
    pub allow_demo_controls: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Params {
    pub fee_bps: u32,
    pub inherit_bps: u32,
    pub protocol_bps: u32,
    pub creator_bps: u32,
    pub creator_haircut_bps: u32,
    pub min_trade_usdc: u128,
    pub min_seed_usdc: u128,
    pub ext_ns_per_raw_usdc: u128,
    pub initial_life_ns: u64,
    pub t_ref_ns: u64,
    pub twilight_ns: u64,
    pub twilight_min_factor_bps: u32,
    pub max_life_min_ns: u64,
    pub max_life_max_ns: u64,
    pub r_small: u128,
    pub r_large: u128,
    pub tier1_ns: u64,
    pub tier2_ns: u64,
    pub leak_bps: u32,
    pub scar_step_ns: u64,
    pub launch_storage_min_yocto: u128,
    pub allow_demo_controls: bool,
}

impl From<ParamsInput> for Params {
    fn from(p: ParamsInput) -> Self {
        Self {
            fee_bps: p.fee_bps,
            inherit_bps: p.inherit_bps,
            protocol_bps: p.protocol_bps,
            creator_bps: p.creator_bps,
            creator_haircut_bps: p.creator_haircut_bps,
            min_trade_usdc: p.min_trade_usdc.0,
            min_seed_usdc: p.min_seed_usdc.0,
            ext_ns_per_raw_usdc: p.ext_ns_per_raw_usdc.0,
            initial_life_ns: p.initial_life_ns.0,
            t_ref_ns: p.t_ref_ns.0,
            twilight_ns: p.twilight_ns.0,
            twilight_min_factor_bps: p.twilight_min_factor_bps,
            max_life_min_ns: p.max_life_min_ns.0,
            max_life_max_ns: p.max_life_max_ns.0,
            r_small: p.r_small.0,
            r_large: p.r_large.0,
            tier1_ns: p.tier1_ns.0,
            tier2_ns: p.tier2_ns.0,
            leak_bps: p.leak_bps,
            scar_step_ns: p.scar_step_ns.0,
            launch_storage_min_yocto: p.launch_storage_min_yocto.0,
            allow_demo_controls: p.allow_demo_controls,
        }
    }
}

impl Params {
    fn validate(&self) {
        if self.inherit_bps + self.protocol_bps + self.creator_bps != self.fee_bps
            || self.fee_bps > 1_000
        {
            env::panic_str("FeeParamsInvalid");
        }
        if self.creator_haircut_bps > 10_000
            || self.twilight_min_factor_bps > 10_000
            || self.leak_bps > 10_000
        {
            env::panic_str("FeeParamsInvalid");
        }
        if self.initial_life_ns == 0
            || self.t_ref_ns == 0
            || self.scar_step_ns == 0
            || self.ext_ns_per_raw_usdc == 0
            || self.r_large <= self.r_small
            || self.max_life_max_ns < self.max_life_min_ns
            || self.min_trade_usdc == 0
            || self.min_seed_usdc == 0
        {
            env::panic_str("FeeParamsInvalid");
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Coin {
    creator_id: AccountId,
    name: String,
    symbol: String,
    image_uri: String,
    reserve: u128,
    supply: u128,
    seed_tokens: u128,
    deadline_ns: u64,
    launched_ns: u64,
    dead: bool,
    snapshot_reserve: u128,
    snapshot_supply: u128,
    scar_n: u8,
    scar_ts: u64,
    creator_fees: u128,
    creator_fees_pending: u128,
    volume: u128,
    trade_count: u64,
    feeders: u32,
    ring_head: u8,
    ring_len: u8,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Position {
    balance: u128,
    bucket_ns: u64,
    bucket_ts: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct TradeRecord {
    account_id: AccountId,
    /// 0 = buy, 1 = sell.
    side: u8,
    usdc: u128,
    tokens: u128,
    ts: u64,
    w_bps: u16,
    ext_s: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct StorageBalance {
    total: u128,
    used: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
enum PayoutKind {
    Sell {
        tokens: u128,
        protocol_fee: u128,
        creator_fee: u128,
        gross: u128,
        w_n: u8,
        prev_scar_n: u8,
        prev_scar_ts: u64,
        new_scar_n: u8,
        new_scar_ts: u64,
    },
    Claim {
        tokens: u128,
        seed: u128,
        haircut: u128,
        reserve_delta: u128,
    },
    CreatorFees,
    ProtocolFees,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct PendingPayout {
    coin_id: u64,
    account_id: AccountId,
    receiver_id: AccountId,
    usdc_out: u128,
    kind: PayoutKind,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    usdc_account_id: AccountId,
    params: Params,
    next_coin_id: u64,
    next_payout_id: u64,
    usdc_held: u128,
    protocol_fees: u128,
    protocol_fees_pending: u128,
    in_flight: u128,
    /// Demo controls only. `clock_pin_until == 0` means the clock is live.
    clock_pin_at: u64,
    clock_pin_until: u64,
    coins: IterableMap<u64, Coin>,
    symbols: LookupMap<String, u64>,
    positions: LookupMap<(u64, AccountId), Position>,
    trades: LookupMap<(u64, u8), TradeRecord>,
    storage: LookupMap<AccountId, StorageBalance>,
    payout_locks: LookupSet<(u64, AccountId)>,
    payouts: LookupMap<u64, PendingPayout>,
}

#[near]
impl Contract {
    #[init]
    #[payable]
    pub fn new(owner_id: AccountId, usdc_account_id: AccountId, params: ParamsInput) -> Self {
        let params = Params::from(params);
        params.validate();
        let attached = env::attached_deposit().as_yoctonear();
        if attached >= USDC_REGISTRATION_YOCTO {
            ext_ft::ext(usdc_account_id.clone())
                .with_static_gas(GAS_REGISTER)
                .with_attached_deposit(NearToken::from_yoctonear(USDC_REGISTRATION_YOCTO))
                .storage_deposit(Some(env::current_account_id()), Some(true))
                .detach();
        }
        Self {
            owner_id,
            usdc_account_id,
            params,
            next_coin_id: 1,
            next_payout_id: 1,
            usdc_held: 0,
            protocol_fees: 0,
            protocol_fees_pending: 0,
            in_flight: 0,
            clock_pin_at: 0,
            clock_pin_until: 0,
            coins: IterableMap::new(b"c"),
            symbols: LookupMap::new(b"y"),
            positions: LookupMap::new(b"p"),
            trades: LookupMap::new(b"t"),
            storage: LookupMap::new(b"b"),
            payout_locks: LookupSet::new(b"l"),
            payouts: LookupMap::new(b"o"),
        }
    }

    /// Register the factory on the configured USDC contract. Safe to call again.
    #[payable]
    pub fn register_usdc(&mut self) {
        let attached = env::attached_deposit().as_yoctonear();
        if attached < USDC_REGISTRATION_YOCTO {
            env::panic_str("InsufficientDeposit");
        }
        ext_ft::ext(self.usdc_account_id.clone())
            .with_static_gas(GAS_REGISTER)
            .with_attached_deposit(NearToken::from_yoctonear(USDC_REGISTRATION_YOCTO))
            .storage_deposit(Some(env::current_account_id()), Some(true))
            .detach();
        let refund = attached - USDC_REGISTRATION_YOCTO;
        if refund > 0 {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
    }

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> StorageView {
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit == 0 {
            env::panic_str("InsufficientDeposit");
        }
        if let Some(mut bal) = self.storage.get(&account).cloned() {
            bal.total = bal.total.saturating_add(deposit);
            let view = storage_view(&bal);
            self.storage.insert(account, bal);
            return view;
        }
        let before = env::storage_usage();
        self.storage.insert(
            account.clone(),
            StorageBalance {
                total: deposit,
                used: 0,
            },
        );
        self.storage.flush();
        let bytes = env::storage_usage().saturating_sub(before);
        let used = bytes as u128 * YOCTO_PER_BYTE;
        if deposit < used {
            env::panic_str("InsufficientDeposit");
        }
        let bal = StorageBalance {
            total: deposit,
            used,
        };
        let view = storage_view(&bal);
        self.storage.insert(account, bal);
        view
    }

    // --- USDC entry -------------------------------------------------------

    #[payable]
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let amount = amount.0;
        if env::predecessor_account_id() != self.usdc_account_id {
            env::log_str("NearBowl refund: UnexpectedToken");
            return U128(amount);
        }
        if msg.len() > 2_048 {
            env::log_str("NearBowl refund: InvalidMsg");
            return U128(amount);
        }
        match self.handle_usdc(sender_id, amount, &msg) {
            Ok(()) => U128(0),
            Err(reason) => {
                env::log_str(&format!("NearBowl refund: {reason}"));
                U128(amount)
            }
        }
    }

    // --- trades and claims ------------------------------------------------

    #[payable]
    pub fn sell(&mut self, coin_id: u64, tokens_in: U128, min_usdc_out: U128) {
        self.assert_yocto_and_gas();
        let seller = env::predecessor_account_id();
        self.ensure_unlocked(coin_id, &seller);
        let mut coin = self.touch(coin_id);
        if self.is_dead(&coin) {
            env::panic_str("CoinDead");
        }
        let tokens = tokens_in.0;
        let mut position = self
            .positions
            .get(&(coin_id, seller.clone()))
            .cloned()
            .unwrap_or(Position {
                balance: 0,
                bucket_ns: 0,
                bucket_ts: 0,
            });
        if tokens == 0 || tokens > position.balance {
            env::panic_str("InsufficientBalance");
        }
        let now = self.now();
        let rem = coin.deadline_ns.saturating_sub(now);
        let (w_n, scar) = math::scar_weight(
            math::Scar {
                n: coin.scar_n,
                ts: coin.scar_ts,
            },
            now,
            rem,
            self.params.t_ref_ns,
            self.params.scar_step_ns,
        );
        let old_scar = (coin.scar_n, coin.scar_ts);
        let payout = math::sell_payout(
            coin.reserve,
            coin.supply,
            tokens,
            w_n as u32,
            self.params.inherit_bps,
            self.params.protocol_bps,
            self.params.creator_bps,
        )
        .unwrap_or_else(|_| env::panic_str("TradeTooSmallForMint"));
        if payout.net < min_usdc_out.0 {
            env::panic_str("SlippageExceeded");
        }
        position.balance -= tokens;
        coin.supply -= tokens;
        coin.reserve = payout.reserve_after;
        coin.creator_fees = coin.creator_fees.saturating_add(payout.fees.creator);
        coin.creator_fees_pending = coin
            .creator_fees_pending
            .saturating_add(payout.fees.creator);
        self.protocol_fees = self.protocol_fees.saturating_add(payout.fees.protocol);
        self.protocol_fees_pending = self
            .protocol_fees_pending
            .saturating_add(payout.fees.protocol);
        coin.scar_n = scar.n;
        coin.scar_ts = scar.ts;
        self.positions.insert((coin_id, seller.clone()), position);
        self.coins.insert(coin_id, coin);
        self.schedule(
            coin_id,
            seller.clone(),
            seller,
            payout.net,
            PayoutKind::Sell {
                tokens,
                protocol_fee: payout.fees.protocol,
                creator_fee: payout.fees.creator,
                gross: payout.gross,
                w_n,
                prev_scar_n: old_scar.0,
                prev_scar_ts: old_scar.1,
                new_scar_n: scar.n,
                new_scar_ts: scar.ts,
            },
        );
    }

    #[payable]
    pub fn claim(&mut self, coin_id: u64, receiver_id: Option<AccountId>) {
        self.assert_yocto_and_gas();
        let caller = env::predecessor_account_id();
        let receiver = receiver_id.unwrap_or_else(|| caller.clone());
        self.ensure_unlocked(coin_id, &caller);
        let mut coin = self.touch(coin_id);
        if !self.is_dead(&coin) {
            env::panic_str("CoinAlive");
        }
        let position = self.positions.get(&(coin_id, caller.clone())).cloned();
        let balance = position.as_ref().map(|p| p.balance).unwrap_or(0);
        let seed = if caller == coin.creator_id {
            coin.seed_tokens
        } else {
            0
        };
        if balance == 0 && seed == 0 {
            env::panic_str("NothingToClaim");
        }
        let (pay, keep, hair) = math::claim_amounts(
            coin.snapshot_reserve,
            coin.snapshot_supply,
            balance,
            seed,
            self.params.creator_haircut_bps,
        )
        .unwrap_or_else(|_| env::panic_str("AmountOverflow"));
        let usdc_out = pay.saturating_add(keep);
        let reserve_delta = usdc_out.saturating_add(hair);
        if coin.reserve < reserve_delta {
            env::panic_str("AmountOverflow");
        }
        coin.reserve -= reserve_delta;
        if balance > 0 {
            coin.supply = coin.supply.saturating_sub(balance);
            let mut position = position.unwrap();
            position.balance = 0;
            self.positions.insert((coin_id, caller.clone()), position);
        }
        if seed > 0 {
            coin.supply = coin.supply.saturating_sub(seed);
            coin.seed_tokens = 0;
        }
        if hair > 0 {
            self.protocol_fees = self.protocol_fees.saturating_add(hair);
            self.protocol_fees_pending = self.protocol_fees_pending.saturating_add(hair);
        }
        self.coins.insert(coin_id, coin);
        if usdc_out == 0 {
            // Nothing to transfer. Haircut (if any) is already in protocol fees.
            self.protocol_fees_pending = self.protocol_fees_pending.saturating_sub(hair);
            self.emit_claimed(
                coin_id,
                &caller,
                &receiver,
                balance.saturating_add(seed),
                0,
                hair,
            );
            return;
        }
        self.schedule(
            coin_id,
            caller,
            receiver,
            usdc_out,
            PayoutKind::Claim {
                tokens: balance,
                seed,
                haircut: hair,
                reserve_delta,
            },
        );
    }

    pub fn poke(&mut self, coin_id: u64) {
        let coin = self.touch(coin_id);
        self.coins.insert(coin_id, coin);
    }

    #[payable]
    pub fn withdraw_creator_fees(&mut self, coin_id: u64, receiver_id: Option<AccountId>) {
        self.assert_yocto_and_gas();
        let caller = env::predecessor_account_id();
        let mut coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        if caller != coin.creator_id {
            env::panic_str("Unauthorized");
        }
        self.ensure_unlocked(coin_id, &caller);
        let amount = coin.creator_fees.saturating_sub(coin.creator_fees_pending);
        if amount == 0 {
            env::panic_str("NothingToClaim");
        }
        coin.creator_fees -= amount;
        self.coins.insert(coin_id, coin);
        let receiver = receiver_id.unwrap_or_else(|| caller.clone());
        self.schedule(coin_id, caller, receiver, amount, PayoutKind::CreatorFees);
    }

    #[payable]
    pub fn withdraw_protocol_fees(&mut self, receiver_id: Option<AccountId>) {
        self.assert_yocto_and_gas();
        let caller = env::predecessor_account_id();
        if caller != self.owner_id {
            env::panic_str("Unauthorized");
        }
        self.ensure_unlocked(PROTOCOL_COIN, &caller);
        let amount = self
            .protocol_fees
            .saturating_sub(self.protocol_fees_pending);
        if amount == 0 {
            env::panic_str("NothingToClaim");
        }
        self.protocol_fees -= amount;
        let receiver = receiver_id.unwrap_or_else(|| caller.clone());
        self.schedule(
            PROTOCOL_COIN,
            caller,
            receiver,
            amount,
            PayoutKind::ProtocolFees,
        );
    }

    pub fn demo_set_remaining(&mut self, coin_id: u64, remaining_ns: U64) {
        if !self.params.allow_demo_controls {
            env::panic_str("DemoControlsDisabled");
        }
        if env::predecessor_account_id() != self.owner_id {
            env::panic_str("Unauthorized");
        }
        let real = env::block_timestamp();
        self.clock_pin_at = real;
        self.clock_pin_until = real.saturating_add(DEMO_CLOCK_PIN_NS);
        let mut coin = self.touch(coin_id);
        if coin.dead {
            env::panic_str("CoinDead");
        }
        coin.deadline_ns = real.saturating_add(remaining_ns.0);
        let died = real >= coin.deadline_ns;
        self.coins.insert(coin_id, coin);
        if died {
            let coin = self.touch(coin_id);
            self.coins.insert(coin_id, coin);
        }
    }

    #[private]
    pub fn on_payout(&mut self, payout_id: u64) {
        let Some(payout) = self.payouts.remove(&payout_id) else {
            return;
        };
        self.payout_locks
            .remove(&(payout.coin_id, payout.account_id.clone()));
        self.in_flight = self.in_flight.saturating_sub(payout.usdc_out);
        // `ft_transfer` returns unit. Anything longer than a small payload is treated
        // as a failed payout so a huge return value cannot burn the gas stipend.
        let ok = env::promise_result_checked(0, 256).is_ok();
        if ok {
            self.usdc_held = self.usdc_held.saturating_sub(payout.usdc_out);
            self.finish_payout(payout);
        } else {
            self.revert_payout(payout);
        }
    }

    // --- views ------------------------------------------------------------

    pub fn get_params(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            usdc_account_id: self.usdc_account_id.clone(),
            params: self.params_json(),
        }
    }

    pub fn get_coin(&self, coin_id: u64) -> CoinView {
        let now = self.now();
        let coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        coin_view(&self.params, coin_id, &coin, now)
    }

    pub fn list_coins(&self, status: String, from_index: u64, limit: u64) -> Vec<CoinView> {
        if status != "alive" && status != "dead" {
            env::panic_str("InvalidMsg");
        }
        let want_dead = status == "dead";
        let limit = limit.min(50);
        let now = self.now();
        let params = self.params.clone();
        let mut skipped = 0u64;
        let mut out = Vec::new();
        for (id, coin) in self.coins.iter() {
            let dead = coin.dead || now >= coin.deadline_ns;
            if dead != want_dead {
                continue;
            }
            if skipped < from_index {
                skipped += 1;
                continue;
            }
            out.push(coin_view(&params, *id, coin, now));
            if out.len() as u64 >= limit {
                break;
            }
        }
        out
    }

    pub fn get_position(&self, coin_id: u64, account_id: AccountId) -> PositionView {
        let coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        let position = self.positions.get(&(coin_id, account_id.clone())).cloned();
        let now = self.now();
        let bucket = if let Some(p) = &position {
            leaked_bucket(p, now, self.params.leak_bps)
        } else {
            0
        };
        let is_creator = account_id == coin.creator_id;
        PositionView {
            balance: U128(position.map(|p| p.balance).unwrap_or(0)),
            bucket_ns: U64(bucket),
            is_creator,
            seed_tokens: U128(if is_creator { coin.seed_tokens } else { 0 }),
        }
    }

    pub fn quote_buy(&self, coin_id: u64, usdc_in: U128, account_id: AccountId) -> QuoteBuy {
        let now = self.now();
        let coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        if coin.dead || now >= coin.deadline_ns {
            env::panic_str("CoinDead");
        }
        let gross = usdc_in.0;
        let mint = math::buy_mint(
            coin.reserve,
            coin.supply,
            gross,
            self.params.inherit_bps,
            self.params.protocol_bps,
            self.params.creator_bps,
        )
        .unwrap_or_else(|_| env::panic_str("TradeTooSmallForMint"));
        let rem = coin.deadline_ns.saturating_sub(now);
        let position = self
            .positions
            .get(&(coin_id, account_id))
            .cloned()
            .unwrap_or(Position {
                balance: 0,
                bucket_ns: 0,
                bucket_ts: now,
            });
        let (ext, _) = self.extension_for(&position, gross, rem, now);
        let cap = math::max_life_ns(
            mint.reserve_after,
            self.params.max_life_min_ns,
            self.params.max_life_max_ns,
            self.params.r_small,
            self.params.r_large,
        );
        QuoteBuy {
            tokens_out: U128(mint.minted),
            fee_split: fee_view(mint.fees),
            extension_ns: U64(ext),
            new_remaining_ns: U64(rem.saturating_add(ext).min(cap)),
            price_after: U128(math::price_raw(mint.reserve_after, mint.supply_after).unwrap_or(0)),
        }
    }

    pub fn quote_sell(&self, coin_id: u64, tokens_in: U128) -> QuoteSell {
        let now = self.now();
        let coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        if coin.dead || now >= coin.deadline_ns {
            env::panic_str("CoinDead");
        }
        let rem = coin.deadline_ns.saturating_sub(now);
        let (w_n, _) = math::scar_weight(
            math::Scar {
                n: coin.scar_n,
                ts: coin.scar_ts,
            },
            now,
            rem,
            self.params.t_ref_ns,
            self.params.scar_step_ns,
        );
        let payout = math::sell_payout(
            coin.reserve,
            coin.supply,
            tokens_in.0,
            w_n as u32,
            self.params.inherit_bps,
            self.params.protocol_bps,
            self.params.creator_bps,
        )
        .unwrap_or_else(|_| env::panic_str("TradeTooSmallForMint"));
        QuoteSell {
            w_n,
            w_bps: math::w_bps(w_n),
            usdc_out_gross: U128(payout.gross),
            usdc_out_net: U128(payout.net),
            curve_value: U128(payout.curve_gross),
            prorata_value: U128(payout.prorata),
            fee_split: fee_view(payout.fees),
        }
    }

    pub fn quote_claim(&self, coin_id: u64, account_id: AccountId) -> QuoteClaim {
        let now = self.now();
        let coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        let dead = coin.dead || now >= coin.deadline_ns;
        let (snap_r, snap_s) = if coin.dead {
            (coin.snapshot_reserve, coin.snapshot_supply)
        } else {
            (coin.reserve, coin.supply)
        };
        let balance = self
            .positions
            .get(&(coin_id, account_id.clone()))
            .map(|p| p.balance)
            .unwrap_or(0);
        let seed = if account_id == coin.creator_id {
            coin.seed_tokens
        } else {
            0
        };
        let (pay, keep, hair) = math::claim_amounts(
            snap_r,
            snap_s,
            balance,
            seed,
            self.params.creator_haircut_bps,
        )
        .unwrap_or((0, 0, 0));
        QuoteClaim {
            usdc_out: U128(pay.saturating_add(keep)),
            haircut: U128(hair),
            status: if dead { "dead" } else { "alive" }.to_string(),
        }
    }

    pub fn get_recent_trades(&self, coin_id: u64) -> Vec<TradeView> {
        let coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        let mut out = Vec::with_capacity(coin.ring_len as usize);
        for i in 0..coin.ring_len {
            let slot = (coin.ring_head + RING - 1 - i) % RING;
            if let Some(trade) = self.trades.get(&(coin_id, slot)) {
                // Skip the launch placeholders (empty account, zero size).
                if trade.usdc == 0 && trade.tokens == 0 {
                    continue;
                }
                out.push(TradeView {
                    account_id: trade.account_id.clone(),
                    side: if trade.side == 0 { "buy" } else { "sell" }.to_string(),
                    usdc: U128(trade.usdc),
                    tokens: U128(trade.tokens),
                    ts: U64(trade.ts),
                    w_bps: trade.w_bps,
                    ext_s: trade.ext_s,
                });
            }
        }
        out
    }

    pub fn get_solvency(&self) -> SolvencyView {
        let mut reserves = 0u128;
        let mut creator_fees = 0u128;
        for coin in self.coins.values() {
            reserves = reserves.saturating_add(coin.reserve);
            creator_fees = creator_fees.saturating_add(coin.creator_fees);
        }
        SolvencyView {
            usdc_held: U128(self.usdc_held),
            reserves: U128(reserves),
            creator_fees: U128(creator_fees),
            protocol_fees: U128(self.protocol_fees),
            in_flight: U128(self.in_flight),
        }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageView> {
        self.storage.get(&account_id).map(storage_view)
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> String {
        let Some(coin_id) = token_id.parse::<u64>().ok() else {
            return "0".to_string();
        };
        self.positions
            .get(&(coin_id, account_id))
            .map(|p| p.balance.to_string())
            .unwrap_or_else(|| "0".to_string())
    }

    pub fn mt_batch_balance_of(
        &self,
        account_id: AccountId,
        token_ids: Vec<String>,
    ) -> Vec<String> {
        token_ids
            .into_iter()
            .map(|id| self.mt_balance_of(account_id.clone(), id))
            .collect()
    }

    /// `true` when the symbol can be launched: valid, not reserved, not taken.
    pub fn symbol_available(&self, symbol: String) -> bool {
        match canonical_symbol(&symbol) {
            Ok(symbol) => !self.symbols.contains_key(&symbol),
            Err(_) => false,
        }
    }

    pub fn mt_supply(&self, token_id: String) -> Option<String> {
        let coin_id = token_id.parse::<u64>().ok()?;
        self.coins.get(&coin_id).map(|c| c.supply.to_string())
    }
}

// --- internals ------------------------------------------------------------

impl Contract {
    fn now(&self) -> u64 {
        let real = env::block_timestamp();
        if self.params.allow_demo_controls && self.clock_pin_until > real {
            self.clock_pin_at
        } else {
            real
        }
    }

    fn is_dead(&self, coin: &Coin) -> bool {
        coin.dead || self.now() >= coin.deadline_ns
    }

    fn touch(&mut self, coin_id: u64) -> Coin {
        let mut coin = self
            .coins
            .get(&coin_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("CoinNotFound"));
        let now = self.now();
        if !coin.dead && now >= coin.deadline_ns {
            coin.dead = true;
            coin.snapshot_reserve = coin.reserve;
            coin.snapshot_supply = coin.supply;
            self.coins.insert(coin_id, coin.clone());
            emit(
                "coin_died",
                &near_sdk::serde_json::json!({
                    "coin_id": coin_id.to_string(),
                    "snapshot_reserve": coin.snapshot_reserve.to_string(),
                    "snapshot_supply": coin.snapshot_supply.to_string(),
                }),
            );
        }
        coin
    }

    fn handle_usdc(
        &mut self,
        sender: AccountId,
        amount: u128,
        msg: &str,
    ) -> Result<(), &'static str> {
        let v: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(msg).map_err(|_| "InvalidMsg")?;
        let action = v
            .get("action")
            .and_then(|a| a.as_str())
            .ok_or("InvalidMsg")?;
        match action {
            "launch" => self.launch(sender, amount, &v),
            "buy" => self.buy(sender, amount, &v),
            _ => Err("InvalidMsg"),
        }
    }

    fn launch(
        &mut self,
        sender: AccountId,
        amount: u128,
        v: &near_sdk::serde_json::Value,
    ) -> Result<(), &'static str> {
        if amount < self.params.min_seed_usdc {
            return Err("SeedTooSmall");
        }
        let name = json_str(v, "name").ok_or("InvalidMsg")?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 48 {
            return Err("InvalidMsg");
        }
        let symbol_raw = json_str(v, "symbol").ok_or("InvalidMsg")?;
        let symbol = canonical_symbol(symbol_raw)?;
        if self.symbols.contains_key(&symbol) {
            return Err("SymbolTaken");
        }
        let image = json_str(v, "image_uri").unwrap_or("");
        if image.chars().count() > 200 {
            return Err("InvalidMsg");
        }
        let available = self.available(&sender).ok_or("LaunchStorageInsufficient")?;
        if available < self.params.launch_storage_min_yocto {
            return Err("LaunchStorageInsufficient");
        }
        let supply = math::seed_supply(amount).map_err(|_| "AmountOverflow")?;
        if supply == 0 {
            return Err("SeedTooSmall");
        }
        let now = self.now();
        let coin_id = self.next_coin_id;
        let coin = Coin {
            creator_id: sender.clone(),
            name: name.to_string(),
            symbol: symbol.clone(),
            image_uri: image.to_string(),
            reserve: amount,
            supply,
            seed_tokens: supply,
            deadline_ns: now.saturating_add(self.params.initial_life_ns),
            launched_ns: now,
            dead: false,
            snapshot_reserve: 0,
            snapshot_supply: 0,
            scar_n: 0,
            scar_ts: now,
            creator_fees: 0,
            creator_fees_pending: 0,
            volume: 0,
            trade_count: 0,
            feeders: 0,
            ring_head: 0,
            ring_len: 0,
        };
        let before = env::storage_usage();
        self.coins.insert(coin_id, coin);
        self.symbols.insert(symbol.clone(), coin_id);
        let placeholder = placeholder_account();
        for slot in 0..RING {
            self.trades.insert(
                (coin_id, slot),
                TradeRecord {
                    account_id: placeholder.clone(),
                    side: 0,
                    usdc: 0,
                    tokens: 0,
                    ts: 0,
                    w_bps: 0,
                    ext_s: 0,
                },
            );
        }
        self.flush_cached();
        let bytes = env::storage_usage().saturating_sub(before);
        if self
            .charge(&sender, bytes, "LaunchStorageInsufficient")
            .is_err()
        {
            env::panic_str("LaunchStorageInsufficient");
        }
        self.next_coin_id = coin_id + 1;
        self.usdc_held = self.usdc_held.saturating_add(amount);
        emit(
            "coin_launched",
            &near_sdk::serde_json::json!({
                "coin_id": coin_id.to_string(),
                "creator_id": sender,
                "symbol": symbol,
                "reserve": amount.to_string(),
                "seed_tokens": supply.to_string(),
                "deadline_ns": now.saturating_add(self.params.initial_life_ns).to_string(),
            }),
        );
        Ok(())
    }

    fn buy(
        &mut self,
        sender: AccountId,
        amount: u128,
        v: &near_sdk::serde_json::Value,
    ) -> Result<(), &'static str> {
        let coin_id = json_u64(v, "coin_id").ok_or("InvalidMsg")?;
        let min_out = json_u128(v, "min_tokens_out").ok_or("InvalidMsg")?;
        if !self.coins.contains_key(&coin_id) {
            return Err("CoinNotFound");
        }
        let mut coin = self.touch(coin_id);
        if self.is_dead(&coin) {
            self.coins.insert(coin_id, coin);
            return Err("CoinDead");
        }
        let now = self.now();
        let rem = coin.deadline_ns.saturating_sub(now);
        let (w_n, scar) = math::scar_weight(
            math::Scar {
                n: coin.scar_n,
                ts: coin.scar_ts,
            },
            now,
            rem,
            self.params.t_ref_ns,
            self.params.scar_step_ns,
        );
        let mint = math::buy_mint(
            coin.reserve,
            coin.supply,
            amount,
            self.params.inherit_bps,
            self.params.protocol_bps,
            self.params.creator_bps,
        )
        .map_err(|e| match e {
            MathError::TooSmall | MathError::ZeroPayout => "TradeTooSmallForMint",
            MathError::Overflow => "AmountOverflow",
        })?;
        if mint.minted < min_out {
            return Err("SlippageExceeded");
        }
        let existing = self.positions.get(&(coin_id, sender.clone())).cloned();
        if existing.is_none() {
            let available = self
                .available(&sender)
                .ok_or("PositionStorageInsufficient")?;
            if available < POSITION_STORAGE_MIN {
                return Err("PositionStorageInsufficient");
            }
        }
        let mut position = existing.unwrap_or(Position {
            balance: 0,
            bucket_ns: 0,
            bucket_ts: now,
        });
        let (credited, extension_bucket) = self.extension_for(&position, amount, rem, now);
        let cap = math::max_life_ns(
            mint.reserve_after,
            self.params.max_life_min_ns,
            self.params.max_life_max_ns,
            self.params.r_small,
            self.params.r_large,
        );
        let new_rem = rem.saturating_add(credited).min(cap);
        let before = env::storage_usage();
        let created = self.positions.get(&(coin_id, sender.clone())).is_none();
        position.balance = position.balance.saturating_add(mint.minted);
        position.bucket_ns = extension_bucket.b;
        position.bucket_ts = extension_bucket.ts;
        if created {
            coin.feeders = coin.feeders.saturating_add(1);
        }
        coin.reserve = mint.reserve_after;
        coin.supply = mint.supply_after;
        coin.deadline_ns = now.saturating_add(new_rem);
        coin.creator_fees = coin.creator_fees.saturating_add(mint.fees.creator);
        coin.volume = coin.volume.saturating_add(amount);
        coin.trade_count = coin.trade_count.saturating_add(1);
        coin.scar_n = scar.n;
        coin.scar_ts = scar.ts;
        self.protocol_fees = self.protocol_fees.saturating_add(mint.fees.protocol);
        self.usdc_held = self.usdc_held.saturating_add(amount);
        self.positions.insert((coin_id, sender.clone()), position);
        self.push_trade(
            coin_id,
            &mut coin,
            TradeRecord {
                account_id: sender.clone(),
                side: 0,
                usdc: amount,
                tokens: mint.minted,
                ts: now,
                w_bps: math::w_bps(w_n),
                ext_s: (credited / 1_000_000_000).min(u32::MAX as u64) as u32,
            },
        );
        self.coins.insert(coin_id, coin.clone());
        if created {
            self.flush_cached();
            let bytes = env::storage_usage().saturating_sub(before);
            // Panic (rather than return a refund code) so a short charge cannot
            // leave the mint in place. The USDC contract refunds a failed call.
            if self
                .charge(&sender, bytes, "PositionStorageInsufficient")
                .is_err()
            {
                env::panic_str("PositionStorageInsufficient");
            }
        }
        emit(
            "fed",
            &near_sdk::serde_json::json!({
                "coin_id": coin_id.to_string(),
                "account_id": sender,
                "usdc_in": amount.to_string(),
                "tokens_out": mint.minted.to_string(),
                "extension_ns": credited.to_string(),
                "deadline_ns": coin.deadline_ns.to_string(),
                "reserve_after": coin.reserve.to_string(),
                "supply_after": coin.supply.to_string(),
                "fees": {
                    "inherit": mint.fees.inherit.to_string(),
                    "protocol": mint.fees.protocol.to_string(),
                    "creator": mint.fees.creator.to_string(),
                },
            }),
        );
        Ok(())
    }

    fn extension_for(
        &self,
        position: &Position,
        gross: u128,
        rem: u64,
        now: u64,
    ) -> (u64, math::Bucket) {
        if gross < self.params.min_trade_usdc {
            let leaked = leaked_bucket(position, now, self.params.leak_bps);
            return (0, math::Bucket { b: leaked, ts: now });
        }
        let factor = math::twilight_factor_bps(
            rem,
            self.params.twilight_ns,
            self.params.twilight_min_factor_bps,
        );
        let raw = math::raw_extension_ns(gross, self.params.ext_ns_per_raw_usdc, factor)
            .unwrap_or(u64::MAX);
        math::credit_bucket(
            math::Bucket {
                b: position.bucket_ns,
                ts: position.bucket_ts,
            },
            raw,
            now,
            self.params.tier1_ns,
            self.params.tier2_ns,
            self.params.leak_bps,
        )
    }

    fn push_trade(&mut self, coin_id: u64, coin: &mut Coin, record: TradeRecord) {
        let slot = coin.ring_head;
        self.trades.insert((coin_id, slot), record);
        coin.ring_head = (coin.ring_head + 1) % RING;
        if coin.ring_len < RING {
            coin.ring_len += 1;
        }
    }

    fn schedule(
        &mut self,
        coin_id: u64,
        account: AccountId,
        receiver: AccountId,
        usdc_out: u128,
        kind: PayoutKind,
    ) {
        if usdc_out == 0 {
            env::panic_str("NothingToClaim");
        }
        let payout_id = self.next_payout_id;
        self.next_payout_id += 1;
        self.payout_locks.insert((coin_id, account.clone()));
        self.in_flight = self.in_flight.saturating_add(usdc_out);
        self.payouts.insert(
            payout_id,
            PendingPayout {
                coin_id,
                account_id: account,
                receiver_id: receiver.clone(),
                usdc_out,
                kind,
            },
        );
        ext_ft::ext(self.usdc_account_id.clone())
            .with_static_gas(GAS_FT_TRANSFER)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_transfer(receiver, U128(usdc_out), Some("nearbowl".to_string()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payout(payout_id),
            )
            .detach();
    }

    fn finish_payout(&mut self, payout: PendingPayout) {
        match payout.kind {
            PayoutKind::Sell {
                protocol_fee,
                creator_fee,
                gross,
                w_n,
                tokens,
                ..
            } => {
                self.protocol_fees_pending =
                    self.protocol_fees_pending.saturating_sub(protocol_fee);
                if let Some(mut coin) = self.coins.get(&payout.coin_id).cloned() {
                    coin.creator_fees_pending =
                        coin.creator_fees_pending.saturating_sub(creator_fee);
                    coin.volume = coin.volume.saturating_add(gross);
                    coin.trade_count = coin.trade_count.saturating_add(1);
                    let ts = self.now();
                    self.push_trade(
                        payout.coin_id,
                        &mut coin,
                        TradeRecord {
                            account_id: payout.account_id.clone(),
                            side: 1,
                            usdc: gross,
                            tokens,
                            ts,
                            w_bps: math::w_bps(w_n),
                            ext_s: 0,
                        },
                    );
                    let reserve_after = coin.reserve;
                    let supply_after = coin.supply;
                    self.coins.insert(payout.coin_id, coin);
                    let inherit = gross
                        .saturating_sub(protocol_fee)
                        .saturating_sub(creator_fee)
                        .saturating_sub(payout.usdc_out);
                    emit(
                        "sold",
                        &near_sdk::serde_json::json!({
                            "coin_id": payout.coin_id.to_string(),
                            "account_id": payout.account_id,
                            "tokens_in": tokens.to_string(),
                            "w_bps": math::w_bps(w_n),
                            "usdc_out_net": payout.usdc_out.to_string(),
                            "reserve_after": reserve_after.to_string(),
                            "supply_after": supply_after.to_string(),
                            "fees": {
                                "inherit": inherit.to_string(),
                                "protocol": protocol_fee.to_string(),
                                "creator": creator_fee.to_string(),
                            },
                        }),
                    );
                }
            }
            PayoutKind::Claim {
                tokens,
                seed,
                haircut,
                ..
            } => {
                self.protocol_fees_pending = self.protocol_fees_pending.saturating_sub(haircut);
                self.emit_claimed(
                    payout.coin_id,
                    &payout.account_id,
                    &payout.receiver_id,
                    tokens.saturating_add(seed),
                    payout.usdc_out,
                    haircut,
                );
            }
            PayoutKind::CreatorFees => {
                emit(
                    "fees_withdrawn",
                    &near_sdk::serde_json::json!({
                        "coin_id": payout.coin_id.to_string(),
                        "role": "creator",
                        "receiver_id": payout.receiver_id,
                        "amount": payout.usdc_out.to_string(),
                    }),
                );
            }
            PayoutKind::ProtocolFees => {
                emit(
                    "fees_withdrawn",
                    &near_sdk::serde_json::json!({
                        "coin_id": null,
                        "role": "protocol",
                        "receiver_id": payout.receiver_id,
                        "amount": payout.usdc_out.to_string(),
                    }),
                );
            }
        }
    }

    fn revert_payout(&mut self, payout: PendingPayout) {
        match payout.kind {
            PayoutKind::Sell {
                tokens,
                protocol_fee,
                creator_fee,
                prev_scar_n,
                prev_scar_ts,
                new_scar_n,
                new_scar_ts,
                ..
            } => {
                self.protocol_fees = self.protocol_fees.saturating_sub(protocol_fee);
                self.protocol_fees_pending =
                    self.protocol_fees_pending.saturating_sub(protocol_fee);
                if let Some(mut coin) = self.coins.get(&payout.coin_id).cloned() {
                    coin.reserve = coin
                        .reserve
                        .saturating_add(payout.usdc_out)
                        .saturating_add(protocol_fee)
                        .saturating_add(creator_fee);
                    coin.supply = coin.supply.saturating_add(tokens);
                    coin.creator_fees = coin.creator_fees.saturating_sub(creator_fee);
                    coin.creator_fees_pending =
                        coin.creator_fees_pending.saturating_sub(creator_fee);
                    // Only undo the scar if it is still the one this sell wrote.
                    if coin.scar_n == new_scar_n && coin.scar_ts == new_scar_ts {
                        coin.scar_n = prev_scar_n;
                        coin.scar_ts = prev_scar_ts;
                    }
                    self.coins.insert(payout.coin_id, coin);
                }
                if let Some(mut position) = self
                    .positions
                    .get(&(payout.coin_id, payout.account_id.clone()))
                    .cloned()
                {
                    position.balance = position.balance.saturating_add(tokens);
                    self.positions
                        .insert((payout.coin_id, payout.account_id), position);
                }
            }
            PayoutKind::Claim {
                tokens,
                seed,
                haircut,
                reserve_delta,
            } => {
                self.protocol_fees = self.protocol_fees.saturating_sub(haircut);
                self.protocol_fees_pending = self.protocol_fees_pending.saturating_sub(haircut);
                if let Some(mut coin) = self.coins.get(&payout.coin_id).cloned() {
                    coin.reserve = coin.reserve.saturating_add(reserve_delta);
                    if seed > 0 {
                        coin.seed_tokens = coin.seed_tokens.saturating_add(seed);
                        coin.supply = coin.supply.saturating_add(seed);
                    }
                    if tokens > 0 {
                        coin.supply = coin.supply.saturating_add(tokens);
                    }
                    self.coins.insert(payout.coin_id, coin);
                }
                if tokens > 0 {
                    let mut position = self
                        .positions
                        .get(&(payout.coin_id, payout.account_id.clone()))
                        .cloned()
                        .unwrap_or(Position {
                            balance: 0,
                            bucket_ns: 0,
                            bucket_ts: 0,
                        });
                    position.balance = position.balance.saturating_add(tokens);
                    self.positions
                        .insert((payout.coin_id, payout.account_id), position);
                }
            }
            PayoutKind::CreatorFees => {
                if let Some(mut coin) = self.coins.get(&payout.coin_id).cloned() {
                    coin.creator_fees = coin.creator_fees.saturating_add(payout.usdc_out);
                    self.coins.insert(payout.coin_id, coin);
                }
            }
            PayoutKind::ProtocolFees => {
                self.protocol_fees = self.protocol_fees.saturating_add(payout.usdc_out);
            }
        }
    }

    fn emit_claimed(
        &self,
        coin_id: u64,
        account: &AccountId,
        receiver: &AccountId,
        burned: u128,
        usdc_out: u128,
        haircut: u128,
    ) {
        emit(
            "claimed",
            &near_sdk::serde_json::json!({
                "coin_id": coin_id.to_string(),
                "account_id": account,
                "receiver_id": receiver,
                "tokens_burned": burned.to_string(),
                "usdc_out": usdc_out.to_string(),
                "haircut": haircut.to_string(),
            }),
        );
    }

    fn flush_cached(&mut self) {
        // Cached collection writes are invisible to `storage_usage` until flushed.
        self.coins.flush();
        self.symbols.flush();
        self.positions.flush();
        self.trades.flush();
        self.storage.flush();
        self.payouts.flush();
    }

    fn available(&self, account: &AccountId) -> Option<u128> {
        let bal = self.storage.get(account)?;
        Some(bal.total.saturating_sub(bal.used))
    }

    fn charge(
        &mut self,
        account: &AccountId,
        bytes: u64,
        err: &'static str,
    ) -> Result<(), &'static str> {
        let cost = (bytes as u128).saturating_mul(YOCTO_PER_BYTE);
        let mut bal = self.storage.get(account).cloned().ok_or(err)?;
        if bal.total.saturating_sub(bal.used) < cost {
            return Err(err);
        }
        bal.used += cost;
        self.storage.insert(account.clone(), bal);
        Ok(())
    }

    fn ensure_unlocked(&self, coin_id: u64, account: &AccountId) {
        if self.payout_locks.contains(&(coin_id, account.clone())) {
            env::panic_str("PayoutInFlight");
        }
    }

    fn assert_yocto_and_gas(&self) {
        if env::attached_deposit().as_yoctonear() < 1 {
            env::panic_str("NeedOneYocto");
        }
        if env::prepaid_gas() < Gas::from_tgas(80) {
            env::panic_str("NotEnoughGas");
        }
    }

    fn params_json(&self) -> ParamsInput {
        let p = &self.params;
        ParamsInput {
            fee_bps: p.fee_bps,
            inherit_bps: p.inherit_bps,
            protocol_bps: p.protocol_bps,
            creator_bps: p.creator_bps,
            creator_haircut_bps: p.creator_haircut_bps,
            min_trade_usdc: U128(p.min_trade_usdc),
            min_seed_usdc: U128(p.min_seed_usdc),
            ext_ns_per_raw_usdc: U128(p.ext_ns_per_raw_usdc),
            initial_life_ns: U64(p.initial_life_ns),
            t_ref_ns: U64(p.t_ref_ns),
            twilight_ns: U64(p.twilight_ns),
            twilight_min_factor_bps: p.twilight_min_factor_bps,
            max_life_min_ns: U64(p.max_life_min_ns),
            max_life_max_ns: U64(p.max_life_max_ns),
            r_small: U128(p.r_small),
            r_large: U128(p.r_large),
            tier1_ns: U64(p.tier1_ns),
            tier2_ns: U64(p.tier2_ns),
            leak_bps: p.leak_bps,
            scar_step_ns: U64(p.scar_step_ns),
            launch_storage_min_yocto: U128(p.launch_storage_min_yocto),
            allow_demo_controls: p.allow_demo_controls,
        }
    }
}

fn coin_view(params: &Params, coin_id: u64, coin: &Coin, now: u64) -> CoinView {
    let dead = coin.dead || now >= coin.deadline_ns;
    let remaining = if dead {
        0
    } else {
        coin.deadline_ns.saturating_sub(now)
    };
    let (w_n, scar) = if dead {
        (
            math::W_STEPS as u8,
            math::Scar {
                n: coin.scar_n,
                ts: coin.scar_ts,
            },
        )
    } else {
        math::scar_weight(
            math::Scar {
                n: coin.scar_n,
                ts: coin.scar_ts,
            },
            now,
            remaining,
            params.t_ref_ns,
            params.scar_step_ns,
        )
    };
    let status = if dead {
        "dead"
    } else if w_n == 0 {
        "fed"
    } else {
        "hungry"
    };
    let (snap_r, snap_s) = if coin.dead {
        (coin.snapshot_reserve, coin.snapshot_supply)
    } else if dead {
        (coin.reserve, coin.supply)
    } else {
        (0, 0)
    };
    let (price_r, price_s) = if coin.dead {
        (coin.snapshot_reserve, coin.snapshot_supply)
    } else {
        (coin.reserve, coin.supply)
    };
    CoinView {
        coin_id: coin_id.to_string(),
        creator_id: coin.creator_id.clone(),
        name: coin.name.clone(),
        symbol: coin.symbol.clone(),
        image_uri: coin.image_uri.clone(),
        reserve: U128(coin.reserve),
        supply: U128(coin.supply),
        seed_tokens: U128(coin.seed_tokens),
        price: U128(math::price_raw(price_r, price_s).unwrap_or(0)),
        deadline_ns: U64(coin.deadline_ns),
        remaining_ns: U64(remaining),
        max_life_ns: U64(math::max_life_ns(
            coin.reserve,
            params.max_life_min_ns,
            params.max_life_max_ns,
            params.r_small,
            params.r_large,
        )),
        w_n,
        w_bps: math::w_bps(w_n),
        scar_n: if dead { coin.scar_n } else { scar.n },
        status: status.to_string(),
        snapshot_reserve: U128(snap_r),
        snapshot_supply: U128(snap_s),
        volume_usdc: U128(coin.volume),
        trade_count: coin.trade_count,
        feeders_count: coin.feeders,
        creator_fees_owed: U128(coin.creator_fees.saturating_sub(coin.creator_fees_pending)),
        launched_ns: U64(coin.launched_ns),
    }
}

fn leaked_bucket(position: &Position, now: u64, leak_bps: u32) -> u64 {
    let elapsed = now.saturating_sub(position.bucket_ts);
    let leak = (u128::from(elapsed) * u128::from(leak_bps) / 10_000) as u64;
    position.bucket_ns.saturating_sub(leak)
}

fn canonical_symbol(raw: &str) -> Result<String, &'static str> {
    if raw.len() < 3 || raw.len() > 10 || !raw.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("SymbolInvalid");
    }
    let symbol = raw.to_ascii_uppercase();
    if symbol.starts_with("USD") {
        return Err("SymbolReserved");
    }
    const RESERVED: &[&str] = &[
        "USDC", "USDT", "USDE", "DAI", "NEAR", "WNEAR", "STNEAR", "LINEAR", "ETH", "WETH", "BTC",
        "WBTC", "SOL", "AURORA",
    ];
    if RESERVED.contains(&symbol.as_str()) {
        return Err("SymbolReserved");
    }
    Ok(symbol)
}

fn json_str<'a>(v: &'a near_sdk::serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn json_u64(v: &near_sdk::serde_json::Value, key: &str) -> Option<u64> {
    match v.get(key)? {
        near_sdk::serde_json::Value::String(s) => s.parse().ok(),
        near_sdk::serde_json::Value::Number(n) => n.as_u64(),
        _ => None,
    }
}

fn json_u128(v: &near_sdk::serde_json::Value, key: &str) -> Option<u128> {
    match v.get(key)? {
        near_sdk::serde_json::Value::String(s) => s.parse().ok(),
        near_sdk::serde_json::Value::Number(n) => n.as_u64().map(u128::from),
        _ => None,
    }
}

fn placeholder_account() -> AccountId {
    "a".repeat(64).parse().expect("placeholder account")
}

fn storage_view(bal: &StorageBalance) -> StorageView {
    StorageView {
        total: U128(bal.total),
        available: U128(bal.total.saturating_sub(bal.used)),
    }
}

fn fee_view(fees: math::FeeSplit) -> FeeView {
    FeeView {
        inherit: U128(fees.inherit),
        protocol: U128(fees.protocol),
        creator: U128(fees.creator),
        to_curve: U128(fees.rest),
    }
}

fn emit(event: &str, data: &near_sdk::serde_json::Value) {
    let payload = near_sdk::serde_json::json!({
        "standard": "life-coin",
        "version": "2.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub usdc_account_id: AccountId,
    pub params: ParamsInput,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct StorageView {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct FeeView {
    pub inherit: U128,
    pub protocol: U128,
    pub creator: U128,
    pub to_curve: U128,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct CoinView {
    pub coin_id: String,
    pub creator_id: AccountId,
    pub name: String,
    pub symbol: String,
    pub image_uri: String,
    pub reserve: U128,
    pub supply: U128,
    pub seed_tokens: U128,
    pub price: U128,
    pub deadline_ns: U64,
    pub remaining_ns: U64,
    pub max_life_ns: U64,
    pub w_n: u8,
    pub w_bps: u16,
    pub scar_n: u8,
    pub status: String,
    pub snapshot_reserve: U128,
    pub snapshot_supply: U128,
    pub volume_usdc: U128,
    pub trade_count: u64,
    pub feeders_count: u32,
    pub creator_fees_owed: U128,
    pub launched_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct PositionView {
    pub balance: U128,
    pub bucket_ns: U64,
    pub is_creator: bool,
    pub seed_tokens: U128,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct QuoteBuy {
    pub tokens_out: U128,
    pub fee_split: FeeView,
    pub extension_ns: U64,
    pub new_remaining_ns: U64,
    pub price_after: U128,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct QuoteSell {
    pub w_n: u8,
    pub w_bps: u16,
    pub usdc_out_gross: U128,
    pub usdc_out_net: U128,
    pub curve_value: U128,
    pub prorata_value: U128,
    pub fee_split: FeeView,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct QuoteClaim {
    pub usdc_out: U128,
    pub haircut: U128,
    pub status: String,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct TradeView {
    pub account_id: AccountId,
    pub side: String,
    pub usdc: U128,
    pub tokens: U128,
    pub ts: U64,
    pub w_bps: u16,
    pub ext_s: u32,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct SolvencyView {
    pub usdc_held: U128,
    pub reserves: U128,
    pub creator_fees: U128,
    pub protocol_fees: U128,
    pub in_flight: U128,
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_ft)]
trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_self)]
trait ExtSelf {
    fn on_payout(&mut self, payout_id: u64);
}

#[cfg(test)]
mod tests;
