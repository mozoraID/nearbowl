//! Testnet-only mock USDC.
//!
//! 6 decimals, NEP-141, with a public faucet. The factory treats this the same
//! way it treats Circle's USDC: `ft_transfer_call` in, `ft_transfer` out.
//! Nothing in here should be deployed on mainnet.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

/// Matches Circle USDC on NEAR: min = max = 0.00125 NEAR.
const STORAGE_BOUND: u128 = 1_250_000_000_000_000_000_000;
const FAUCET_AMOUNT: u128 = 100 * 1_000_000;
const FAUCET_COOLDOWN_NS: u64 = 60 * 1_000_000_000;
const GAS_RESOLVE: Gas = Gas::from_tgas(15);

#[near(serializers = [json])]
#[derive(Clone)]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Account {
    balance: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    total_supply: u128,
    accounts: LookupMap<AccountId, Account>,
    faucet_at: LookupMap<AccountId, u64>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id,
            total_supply: 0,
            accounts: LookupMap::new(b"a"),
            faucet_at: LookupMap::new(b"f"),
        }
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: "ft-1.0.0".to_string(),
            name: "NearBowl tUSDC (testnet only)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(
            self.accounts
                .get(&account_id)
                .map(|a| a.balance)
                .unwrap_or(0),
        )
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds {
            min: U128(STORAGE_BOUND),
            max: Some(U128(STORAGE_BOUND)),
        }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        if self.accounts.contains_key(&account_id) {
            Some(StorageBalance {
                total: U128(STORAGE_BOUND),
                available: U128(0),
            })
        } else {
            None
        }
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let _ = registration_only;
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit().as_yoctonear();
        if self.accounts.contains_key(&account) {
            if deposit > 0 {
                Promise::new(env::predecessor_account_id())
                    .transfer(NearToken::from_yoctonear(deposit))
                    .detach();
            }
            return StorageBalance {
                total: U128(STORAGE_BOUND),
                available: U128(0),
            };
        }
        if deposit < STORAGE_BOUND {
            env::panic_str("InsufficientDeposit");
        }
        self.accounts.insert(account, Account { balance: 0 });
        let refund = deposit - STORAGE_BOUND;
        if refund > 0 {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
        StorageBalance {
            total: U128(STORAGE_BOUND),
            available: U128(0),
        }
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_yocto();
        let sender = env::predecessor_account_id();
        self.transfer(&sender, &receiver_id, amount.0);
        if let Some(memo) = memo {
            env::log_str(&format!("tUSDC memo: {memo}"));
        }
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_yocto();
        let sender = env::predecessor_account_id();
        self.transfer(&sender, &receiver_id, amount.0);
        if let Some(memo) = memo {
            env::log_str(&format!("tUSDC memo: {memo}"));
        }
        ext_receiver::ext(receiver_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_unused_gas_weight(1)
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_RESOLVE)
                    .with_unused_gas_weight(0)
                    .ft_resolve_transfer(sender, receiver_id, amount),
            )
            .into()
    }

    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let amount = amount.0;
        let unused = match env::promise_result_checked(0, 64) {
            Ok(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes)
                .map(|v| v.0.min(amount))
                .unwrap_or(amount),
            Err(_) => amount,
        };
        if unused > 0 {
            let receiver_balance = self
                .accounts
                .get(&receiver_id)
                .map(|a| a.balance)
                .unwrap_or(0);
            let refund = unused.min(receiver_balance);
            if refund > 0 {
                self.debit(&receiver_id, refund);
                self.credit(&sender_id, refund);
            }
        }
        U128(amount - unused)
    }

    /// Owner mint, for the demo script. Not rate limited.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        if env::predecessor_account_id() != self.owner_id {
            env::panic_str("Unauthorized");
        }
        if !self.accounts.contains_key(&account_id) {
            env::panic_str("ReceiverNotRegistered");
        }
        self.credit(&account_id, amount.0);
        self.total_supply = self.total_supply.saturating_add(amount.0);
    }

    /// Public faucet. 100 tUSDC per account, at most once a minute.
    /// Testnet only — this contract is not a dollar.
    pub fn faucet(&mut self) {
        let account = env::predecessor_account_id();
        if !self.accounts.contains_key(&account) {
            env::panic_str("ReceiverNotRegistered");
        }
        let now = env::block_timestamp();
        let last = self.faucet_at.get(&account).copied().unwrap_or(0);
        if last != 0 && now < last.saturating_add(FAUCET_COOLDOWN_NS) {
            env::panic_str("FaucetCooldown");
        }
        self.faucet_at.insert(account.clone(), now);
        self.credit(&account, FAUCET_AMOUNT);
        self.total_supply = self.total_supply.saturating_add(FAUCET_AMOUNT);
    }
}

impl Contract {
    fn transfer(&mut self, sender: &AccountId, receiver: &AccountId, amount: u128) {
        if sender == receiver || amount == 0 {
            env::panic_str("InvalidTransfer");
        }
        if !self.accounts.contains_key(receiver) {
            env::panic_str("ReceiverNotRegistered");
        }
        self.debit(sender, amount);
        self.credit(receiver, amount);
    }

    fn debit(&mut self, account: &AccountId, amount: u128) {
        let mut record = self
            .accounts
            .get(account)
            .cloned()
            .unwrap_or_else(|| env::panic_str("SenderNotRegistered"));
        if record.balance < amount {
            env::panic_str("InsufficientBalance");
        }
        record.balance -= amount;
        self.accounts.insert(account.clone(), record);
    }

    fn credit(&mut self, account: &AccountId, amount: u128) {
        let mut record = self
            .accounts
            .get(account)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ReceiverNotRegistered"));
        record.balance = record.balance.saturating_add(amount);
        self.accounts.insert(account.clone(), record);
    }
}

fn assert_yocto() {
    if env::attached_deposit().as_yoctonear() != 1 {
        env::panic_str("NeedOneYocto");
    }
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_receiver)]
trait ExtReceiver {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128;
}

#[allow(dead_code)]
#[near_sdk::ext_contract(ext_self)]
trait ExtSelf {
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128;
}
