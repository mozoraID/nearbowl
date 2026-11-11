# NearBowl

NearBowl is a USDC meme-coin launchpad on NEAR. Anyone can launch a coin by sending USDC into one factory contract. That USDC is the coin's pool. People trade against a linear bonding curve, quoted only in USDC. Nobody can withdraw the pool except through the rules below.

Each coin is a pet that has to be fed.

- **Feeding** means buying. A buy of at least 1 USDC adds time to the coin's life, up to a cap that grows with the pool.
- **Hunger** grows as the timer runs down. The hungrier the coin, the closer a seller's payout moves from the curve price toward a plain pro-rata share of the pool.
- **Death** comes when the timer hits zero. Trading stops. Every holder burns their tokens for a pro-rata share of what is left. The creator's seed tokens are claim-only, and that claim is cut in half. The other half goes to the protocol.

This repository is a testnet prototype. The same author also builds [NearPocket](https://github.com/mozoraID/nearpocket), a separate project with no shared code.

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

`T_ref` is the initial life (24 hours in production, 45 seconds in the demo). The scar jumps up to `w_time` immediately and falls by at most 1/64 per recovery step (90 minutes in production, 3 seconds in the demo). Feeding a coin back to full does not instantly restore curve exits.

**Timer.** Only buys extend it. A buy of `G` USDC (at least 1) adds

```
raw = G · ext_per_usdc · f
f = 1                         when time left ≥ twilight
f = 0.25 + 0.75 · T_rem / T_tw otherwise
```

Each account has a leaky bucket. Recent raw seconds leak at 0.25 per second. The next raw seconds are credited at 100% for the first tier, 50% for the second, and 0% after that. One account cannot keep a coin alive by itself. The new remaining time is capped by `max_life(R)`: 24 hours below 1,000 USDC, 72 hours above 100,000 USDC, linear between (180 seconds to 540 seconds on the demo timer).

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

Rust unit tests reproduce the reference numbers (the 50/500/1000 curve, the demo walkthrough, the 9 hour bucket, hunger 22/64 at 30s of 45s). Property tests check solvency after every operation and that an attacker who only trades against passive holders does not end with more USDC than they put in.

## Deploy to testnet

Build the wasm, then deploy. The script reads the deployer account and key from the environment. It does not contain a key.

```bash
cp .env.example .env
# edit .env — DEPLOYER_ACCOUNT_ID and DEPLOYER_PRIVATE_KEY or NEAR_CREDENTIALS_FILE

set -a && source .env && set +a
bash scripts/build-contracts.sh
node scripts/deploy-testnet.mjs
```

With `DEPLOYER_ACCOUNT_ID=nearbowl.testnet` the script creates and deploys:

- `tusdc.nearbowl.testnet` — mock USDC, owner is the deployer
- `factory.nearbowl.testnet` — factory, demo timers, `allow_demo_controls = true`
- `alice.nearbowl.testnet`, `bob.nearbowl.testnet`, `carol.nearbowl.testnet` — demo wallets, same full-access key as the deployer

Running it again updates the wasm and leaves state in place. It refuses to run when `NEAR_NETWORK_ID=mainnet`.

## Demo

```bash
set -a && source .env && set +a
node scripts/demo.mjs
```

The script mints tUSDC, launches a coin with 100, has Alice buy 20, Bob buy 30, and Carol buy 50, then pins 30 seconds of life and sells Bob's position. It prints each on-chain number next to the integer value from the reference model. Token amounts and USDC payouts match that model exactly. The on-screen 6-decimal figures in the design notes are the continuous model; the chain is within 0.000001 USDC of those, and claim dust of a few raw units stays in the reserve.

`demo_set_remaining` holds the contract clock for 120 seconds. On the demo timer one hunger step is about 0.7 seconds wide, so a second transaction could not otherwise land on "exactly 30 seconds left". The pin exists only while `allow_demo_controls` is true.

## Web app

```bash
cd web
cp ../.env.example .env.local
npm ci
npm run dev
```

Vercel needs these public variables:

| Name | Example |
| --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_RPC_URL` | `https://test.rpc.fastnear.com` |
| `NEXT_PUBLIC_FACTORY_ACCOUNT_ID` | `factory.nearbowl.testnet` |
| `NEXT_PUBLIC_USDC_ACCOUNT_ID` | `tusdc.nearbowl.testnet` |

The UI has a testnet banner, a tUSDC faucet, Explore (alive coins and a Graveyard), Launch, and a coin page with the timer, hunger meter, quote, buy, sell, claim, and the on-contract trade list.

## Mainnet

The wasm is the same. Only init config changes.

| | Testnet | Mainnet |
| --- | --- | --- |
| USDC account | `tusdc…` or Circle testnet `3e2210…b8af` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` |
| Initial life / hunger reference | 45 seconds | 24 hours |
| Extension | 2 seconds per USDC | 360 seconds per USDC |
| Life cap | 180–540 seconds | 24–72 hours |
| Twilight | 10 seconds | 2 hours |
| Bucket tiers | 60 seconds, then 60 seconds | 6 hours, then 6 hours |
| Scar step | 3 seconds | 90 minutes |
| Minimum seed | 1 USDC | 10 USDC |
| `allow_demo_controls` | `true` | **`false`** |
| Accounts | `*.testnet` | `*.near` |

`ext_ns_per_raw_usdc` is nanoseconds per raw USDC unit: `360_000` in production (360 seconds per whole USDC) and `2_000` in the demo. Fee shares stay 50 / 30 / 20 bps inside the 100 bps fee. `creator_haircut_bps` stays 5000.

There is no mainnet deployment in this repository. A mainnet factory must be initialized with `allow_demo_controls: false`. The deploy script exits if the network is mainnet so the demo flag cannot be turned on by accident.

## Known limitations

- **Death is not a refund.** Late buyers get a share of what is left. In the demo, Alice gets about 12.57 USDC back on 20 USDC.
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
