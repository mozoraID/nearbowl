# NearBowl

NearBowl is a USDC meme-coin launchpad on NEAR. Anyone can launch a coin by sending USDC into one factory contract. That USDC is the coin's pool. People trade against a linear bonding curve, quoted only in USDC. Nobody can withdraw the pool except through the rules below.

Each coin is a pet that has to be fed.

- **Feeding** means buying. A buy of at least 1 USDC adds time to the coin's life, up to a cap that grows with the pool.
- **Hunger** grows as the timer runs down. The hungrier the coin, the closer a seller's payout moves from the curve price toward a plain pro-rata share of the pool.
- **Death** comes when the timer hits zero. Trading stops. Every holder burns their tokens for a pro-rata share of what is left. The creator's seed tokens are claim-only, and that claim is cut in half. The other half goes to the protocol.

This repository is a testnet prototype. The app is at https://nearbowl.vercel.app/.

## The mechanic

Price grows with the square root of the pool. With reserve `R` and supply `s`:

```
p(s) = k s
R(s) = k s² / 2
s(R) = sqrt(2R / k)
market cap = p · s = 2R
```

The contract stores `R` and `s`. `k = 2R / s²` is derived, so a fee that stays in the pool without minting raises `k`. USDC in and out does not depend on `k`. Token amounts use 18 decimals. USDC amounts use 6 decimals (1 USDC = 1_000_000).

**Buy.** A gross amount is split into a 1% fee. 0.50% stays in the reserve and mints nothing (inheritance), 0.30% is protocol fees, 0.20% is creator fees. The other 99% is `to_curve`. Tokens minted:

```
s_new = floor_isqrt( s² · (R + to_curve) / R )
```

**Sell.** A holder selling down to supply `s'` receives, before the 1% fee:

```
payout = R · (1 − (s' / s) ^ (2 − w))
```

- `w = 0` is the curve: `R (1 − (s' / s)²)`.
- `w = 1` is pro-rata: `R · x / s`.
- In between it never pays more than the curve and never less than pro-rata, and splitting the sell does not pay more.

Hunger weight, rounded up to the next 1/64 (that favors the pool):

```
w_time = ceil(64 · clamp(1 − T_rem / T_ref, 0, 1)) / 64
w = max(w_time, scar)
```

`T_ref` is the initial life (24 hours in production and on the public testnet factory, 45 seconds on the legacy short timer). The scar jumps up to `w_time` immediately and falls by at most 1/64 per recovery step (90 minutes in production and on the public testnet factory, 3 seconds on the legacy short timer). Feeding a coin back to full does not instantly restore curve exits. The public factory is `pet.nearbowl.testnet`. Its timers are in [Deploy to testnet](#deploy-to-testnet), and timer controls are off. `factory.nearbowl.testnet` is a legacy short-timer factory (45 second initial life, 180–540 second cap, timer controls on). The app does not use it. `scripts/demo.mjs` is the only thing that still talks to that legacy factory.

**Timer.** Only buys extend it. A buy of `G` USDC (at least 1) adds

```
raw = G · ext_per_usdc · f
f = 1                         when time left ≥ twilight
f = 0.25 + 0.75 · T_rem / T_tw otherwise
```

Each account has a leaky bucket. Recent raw seconds leak at 0.25 per second. The next raw seconds are credited at 100% for the first tier, 50% for the second, and 0% after that. One account cannot keep a coin alive by itself. The new remaining time is capped by `max_life(R)`: 24 hours below 1,000 USDC, 72 hours above 100,000 USDC, linear between (180 seconds to 540 seconds on the short demo timer).

**Death and claims.** Death is lazy: the next write notices `now ≥ deadline`, snapshots `(R, s)`, and stops trading. A claim pays `floor(R_snap · x / s_snap)`. The creator also claims the seed tokens, then keeps `floor(gross / 2)`. The rest of that gross is a protocol fee. Ignoring fees, the creator breaks even only if the pool is about 4× the seed at death, because `1 / (1 − 0.5)² = 4`.

Every integer step rounds toward the pool. Sums of squares use 256-bit intermediates because a normal seed supply does not fit in `u128` when squared.

The reference math is [`sim/sim.py`](sim/sim.py). `python3 sim/sim.py` checks the formulas. The contract's integer path matches that file's `Factory` model.

## Architecture

One factory contract (`contracts/factory`, near-sdk 5.30.1, `near_sdk::store` collections) holds every coin in an internal ledger. USDC comes in only through `ft_on_transfer` from the configured token account. Sells and claims send USDC out with `ft_transfer`, then a private callback. If that transfer fails, the callback restores the burned tokens, the reserve, and the fees.

Coins do not show up as NEP-141 tokens in wallets. Three read-only views use NEP-245-shaped names (`mt_balance_of`, `mt_batch_balance_of`, `mt_supply`) so generic tooling can read balances. There is no `mt_transfer`. The contract does not claim NEP-245 compliance.

`tUSDC` (`contracts/tusdc`) is a testnet-only mock NEP-141 with 6 decimals and a public faucet (100 tUSDC, once a minute per account). The factory does not special-case it. Point `usdc_account_id` at Circle testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` and the same wasm works. Do not use bridged USDC.e.

The web app (`web/`) is Next.js App Router. It reads the factory over RPC and sends transactions with NEAR Wallet Selector (Meteor, MyNearWallet, HOT, Intear).

## Tests

```bash
python3 sim/sim.py
cargo test --workspace --exclude nearbowl-sandbox
bash scripts/build-contracts.sh
cargo test -p nearbowl-sandbox -- --test-threads=1
```

Sandbox tests need OpenSSL headers (`libssl-dev`, `pkg-config`) and a built wasm. They cover launch → buy → feed → sell → death → claim, a wrong token, a malformed message, a launch without storage, a buy on a dead coin, a payout to an account that is not registered on USDC, and `demo_set_remaining` with demo controls off.

Rust unit tests reproduce the reference numbers (the 50/500/1000 curve, the demo script walkthrough, the 9 hour bucket, hunger 22/64 at 30s of 45s). Property tests check solvency after every operation and that an attacker who only trades against passive holders does not end with more USDC than they put in.

## Deploy to testnet

Build the wasm, then deploy. The script reads the deployer account and key from the environment. It does not contain a key.

```bash
cp .env.example .env
# edit .env — DEPLOYER_ACCOUNT_ID and DEPLOYER_PRIVATE_KEY or NEAR_CREDENTIALS_FILE

set -a && source .env && set +a
bash scripts/build-contracts.sh
node scripts/deploy-testnet.mjs
```

With `DEPLOYER_ACCOUNT_ID=nearbowl.testnet` and the env file filled in, the script creates or updates:

- `tusdc.nearbowl.testnet` — mock USDC, owner is the deployer. Already deployed; a second run only updates the wasm.
- `pet.nearbowl.testnet` unless `FACTORY_ACCOUNT_ID` is set — the public factory, created from `nearbowl.testnet`. Timer controls are off unless `ALLOW_DEMO_CONTROLS=true`, which the script refuses for this account.
- `alice.nearbowl.testnet`, `bob.nearbowl.testnet`, `carol.nearbowl.testnet` — wallets for the legacy walkthrough, same full-access key as the deployer

`factory.nearbowl.testnet` is the legacy short-timer factory (45 second initial life, 180–540 second cap, timer controls on). It is not the factory the app reads. Do not point `NEXT_PUBLIC_FACTORY_ID` at it.

The public factory uses these timer values. Other init params stay on the script defaults (1% fee split 50 / 30 / 20, 1 USDC minimum seed) except `allow_demo_controls`, which is `false`. `new` is called with 0.005 NEAR attached. The contract forwards 0.00125 NEAR to tUSDC `storage_deposit` for the factory account, so a separate registration call is not required when that deposit is present.

| Env var | Value | Meaning |
| --- | --- | --- |
| `INITIAL_LIFE_NS` | `86400000000000` | 24 hours |
| `T_REF_NS` | `86400000000000` | 24 hours, hunger reference |
| `MAX_LIFE_MIN_NS` | `172800000000000` | 48 hour cap at or below 1,000 USDC |
| `MAX_LIFE_MAX_NS` | `259200000000000` | 72 hour cap at or above 100,000 USDC |
| `TWILIGHT_NS` | `7200000000000` | 2 hours |
| `EXT_NS_PER_RAW_USDC` | `360000` | 6 minutes of life per USDC |
| `TIER1_NS` | `21600000000000` | 6 hours |
| `TIER2_NS` | `21600000000000` | 6 hours |
| `SCAR_STEP_NS` | `5400000000000` | 90 minutes per hunger recovery step |

```bash
FACTORY_ACCOUNT_ID=pet.nearbowl.testnet \
TUSDC_ACCOUNT_ID=tusdc.nearbowl.testnet \
ALLOW_DEMO_CONTROLS=false \
INITIAL_LIFE_NS=86400000000000 \
T_REF_NS=86400000000000 \
MAX_LIFE_MIN_NS=172800000000000 \
MAX_LIFE_MAX_NS=259200000000000 \
TWILIGHT_NS=7200000000000 \
EXT_NS_PER_RAW_USDC=360000 \
TIER1_NS=21600000000000 \
TIER2_NS=21600000000000 \
SCAR_STEP_NS=5400000000000 \
node scripts/deploy-testnet.mjs
```

`new` args, with the owner `nearbowl.testnet` and 0.005 NEAR attached (gas 80 Tgas):

```json
{
  "owner_id": "nearbowl.testnet",
  "usdc_account_id": "tusdc.nearbowl.testnet",
  "params": {
    "fee_bps": 100,
    "inherit_bps": 50,
    "protocol_bps": 30,
    "creator_bps": 20,
    "creator_haircut_bps": 5000,
    "min_trade_usdc": "1000000",
    "min_seed_usdc": "1000000",
    "ext_ns_per_raw_usdc": "360000",
    "initial_life_ns": "86400000000000",
    "t_ref_ns": "86400000000000",
    "twilight_ns": "7200000000000",
    "twilight_min_factor_bps": 2500,
    "max_life_min_ns": "172800000000000",
    "max_life_max_ns": "259200000000000",
    "r_small": "1000000000",
    "r_large": "100000000000",
    "tier1_ns": "21600000000000",
    "tier2_ns": "21600000000000",
    "leak_bps": 2500,
    "scar_step_ns": "5400000000000",
    "launch_storage_min_yocto": "2160000000000000000000000",
    "allow_demo_controls": false
  }
}
```

If a factory was initialized without the 0.00125 NEAR tUSDC deposit, register it once:

```bash
near call pet.nearbowl.testnet register_usdc '{}' \
  --accountId nearbowl.testnet --deposit 0.00125 --gas 30000000000000
```

Running the script again updates the wasm and leaves state in place. Timer env vars apply only when the factory account is created. It refuses to run when `NEAR_NETWORK_ID=mainnet`.

## Legacy walkthrough

`scripts/demo.mjs` is not part of the public app. It targets the legacy factory `factory.nearbowl.testnet` (`LEGACY_FACTORY_ACCOUNT_ID`) and refuses to run against the public factory. That factory still has timer controls on and a 45 second initial life. The public factory does not.

```bash
set -a && source .env && set +a
node scripts/demo.mjs
```

The script mints tUSDC, launches a coin with 100, has Alice buy 20, Bob buy 30, and Carol buy 50, then pins 30 seconds of life and sells Bob's position. It prints each on-chain number next to the integer value from the reference model. Token amounts and USDC payouts match that model exactly. The on-screen 6-decimal figures in the design notes are the continuous model; the chain is within 0.000001 USDC of those, and claim dust of a few raw units stays in the reserve.

`demo_set_remaining` holds the contract clock for 120 seconds. On the legacy timer one hunger step is about 0.7 seconds wide, so a second transaction could not otherwise land on "exactly 30 seconds left". The pin exists only while `allow_demo_controls` is true, which is why it stays off the public factory.

## Web app

```bash
cd web
cp ../.env.example .env.local
npm ci
npm run dev
```

Vercel needs these public variables. `NEXT_PUBLIC_FACTORY_ID` is the one the app reads first. If it is unset, `NEXT_PUBLIC_FACTORY_ACCOUNT_ID` is the fallback. Set the new name so an old value cannot keep the app on a previous factory.

| Name | Example |
| --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_RPC_URL` | `https://test.rpc.fastnear.com` |
| `NEXT_PUBLIC_FACTORY_ID` | `pet.nearbowl.testnet` |
| `NEXT_PUBLIC_USDC_ACCOUNT_ID` | `tusdc.nearbowl.testnet` |

The footer reads the factory view and shows the account, initial life, life cap, seconds per USDC, and whether timer controls are off.

The UI has a testnet banner, a tUSDC faucet, Explore (alive coins and a Graveyard), Get started (`/start`, with `/demo` redirecting there), Launch, and a coin page with the timer, hunger meter, quote, buy, sell, claim, and the on-contract trade list. An empty alive list links to launch and to the cycle on `/start`.

### Try one cycle

`/start` walks through one coin with the amounts up front:

1. Faucet: 100 tUSDC, once a minute. The first tap registers the account for 0.00125 NEAR. The cycle itself spends 11 tUSDC.
2. Launch: 10 tUSDC seed (minimum 1) and 0.06 NEAR of factory storage. No launch fee. The timer starts at the factory's initial life, 24 hours on the public factory.
3. Feed: buy at least 1 tUSDC. That adds about 6 minutes per USDC on the public factory, up to the 48–72 hour cap. Buys under 1 tUSDC mint tokens and do not add time.
4. Sell while the coin is alive, or claim after it dies. A claim is not available during the first 24 hours (longer if someone keeps feeding). The creator's seed claim is cut in half. Bought tokens are not.

Launch, feed, sell, and claim each open a confirm step with the quote: tokens or USDC out, the fee split, the creator haircut where it applies, the hunger-adjusted payout on a sale, and the 2% minimum. The wallet opens after confirm. The factory view `quote_launch` prices a seed. Buys, sales, and claims use `quote_buy`, `quote_sell`, and `quote_claim`.

The factory does not store transaction hashes. After each wallet action the app keeps the hash from the wallet outcome, or from the `transactionHashes` redirect parameter, and shows a receipt with a NearBlocks link (`https://testnet.nearblocks.io/txns/<hash>`). Older trades link to that account and to the factory on the explorer.

Coin pictures are optional. Launch uploads them from the browser with `@vercel/blob/client` through `/api/upload`. The route allows PNG, JPEG, WebP, and GIF, caps the file at 2 MB, and stores it under `coins/` with a random suffix. `BLOB_READ_WRITE_TOKEN` stays on the server. Without that token the form says so, and the pet art is used. The factory keeps `image_uri` to 200 characters.

Page views are tracked with Vercel Web Analytics.

## Mainnet

The wasm is the same. Only init config changes. The public testnet factory uses the timers in [Deploy to testnet](#deploy-to-testnet) and timer controls off. The legacy factory `factory.nearbowl.testnet` still has the short timer and timer controls on. It is not public. The "Script default" column is what you get when the timer env vars are unset. Those defaults are not the public factory.

| | Public testnet | Script default (legacy) | Mainnet |
| --- | --- | --- | --- |
| Factory | `pet.nearbowl.testnet` | `factory.nearbowl.testnet` | `*.near` |
| USDC account | `tusdc.nearbowl.testnet` | `tusdc.nearbowl.testnet` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| Initial life / hunger reference | 24 hours | 45 seconds | 24 hours |
| Extension | 360 seconds per USDC | 2 seconds per USDC | 360 seconds per USDC |
| Life cap | 48–72 hours | 180–540 seconds | 24–72 hours |
| Twilight | 2 hours | 10 seconds | 2 hours |
| Bucket tiers | 6 hours, then 6 hours | 60 seconds, then 60 seconds | 6 hours, then 6 hours |
| Scar step | 90 minutes | 3 seconds | 90 minutes |
| Minimum seed | 1 USDC | 1 USDC | 10 USDC |
| `allow_demo_controls` | **`false`** | `true` (legacy only) | **`false`** |

`ext_ns_per_raw_usdc` is nanoseconds per raw USDC unit: `360_000` on the public testnet factory and in production (360 seconds per whole USDC), and `2_000` on the legacy short timer. Fee shares stay 50 / 30 / 20 bps inside the 100 bps fee. `creator_haircut_bps` stays 5000.

There is no mainnet deployment in this repository. A mainnet factory must be initialized with `allow_demo_controls: false`. The deploy script exits if the network is mainnet. On testnet it leaves timer controls off unless `ALLOW_DEMO_CONTROLS=true`, and it refuses that flag for `pet.nearbowl.testnet`.

## Known limitations

- **Death is not a refund.** Late buyers get a share of what is left. In the demo script, Alice gets about 12.57 USDC back on 20 USDC.
- **Quiet coins have a wide sell spread.** At 12 hours left, a small holder gets about 75% of the curve value. That is the cost of closing the bank run.
- **Feed-then-dump is slowed, not removed.** A large holder can still gain by paying to keep a coin fed for a long time and then selling closer to the curve. It is public and slow.
- **Sybil volume is cheap.** One wallet cannot keep a coin alive. Four wallets can, for about 2.40–4.80 USDC of fees per day, plus a small storage deposit per account.
- **The creator's terms are harsh.** The 50% haircut is one parameter (`creator_haircut_bps`).
- **Front-running.** Slippage bounds are required. Claims do not depend on order.
- **Wallets do not list these coins** until a wrapper exists. The NEP-245-shaped views are read-only.
- **Wrong USDC account is an operator error.** Pointing the factory at the wrong token has real consequences.
- **Storage sizes in the design notes are estimates.** The contract measures `storage_usage` and charges the actual bytes. Launch still requires the configured minimum (0.06 NEAR) up front.
- **This is not an offer or investment advice.** A mainnet launch needs its own legal review.

## License

MIT. See [LICENSE](LICENSE).
