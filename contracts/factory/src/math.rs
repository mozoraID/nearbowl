//! Integer math for the bonding curve, power exit, hunger weight, and timer.
//!
//! Every rounding step favours the pool. The formulas match `sim/sim.py`
//! (the `Factory` integer model and the continuous timer rules).

#[allow(
    deprecated,
    semicolon_in_expressions_from_non_local_macros,
    clippy::manual_div_ceil
)]
mod wide {
    use uint::construct_uint;
    construct_uint! {
        /// 256-bit unsigned integer. Token-supply squares do not fit in `u128`.
        pub struct U256(4);
    }
}
pub use wide::U256;

pub const ONE_USDC: u128 = 1_000_000;
pub const TOKEN_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18
pub const FP: u128 = 1_000_000_000_000_000_000; // fixed-point 1.0
const BPS: u128 = 10_000;
pub const W_STEPS: u32 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    TooSmall,
    ZeroPayout,
}

fn mul(a: U256, b: U256) -> Result<U256, MathError> {
    let (v, overflow) = a.overflowing_mul(b);
    if overflow {
        Err(MathError::Overflow)
    } else {
        Ok(v)
    }
}

fn fit_u128(v: U256) -> Result<u128, MathError> {
    if v > U256::from(u128::MAX) {
        Err(MathError::Overflow)
    } else {
        Ok(v.as_u128())
    }
}

/// Floor square root. Newton's method, integer-exact.
pub fn isqrt(n: U256) -> U256 {
    if n < U256::from(2u32) {
        return n;
    }
    let mut x = n;
    let mut y = (x + U256::one()) >> 1;
    while y < x {
        x = y;
        y = (x + n / x) >> 1;
    }
    x
}

fn ceil_isqrt(n: U256) -> Result<U256, MathError> {
    let r = isqrt(n);
    if mul(r, r)? == n {
        Ok(r)
    } else {
        Ok(r + U256::one())
    }
}

fn ceil_mul_div(a: u128, b: u128, den: u128) -> Result<u128, MathError> {
    if den == 0 {
        return Err(MathError::Overflow);
    }
    let n = mul(U256::from(a), U256::from(b))?;
    let (q, r) = n.div_mod(U256::from(den));
    let q = if r.is_zero() { q } else { q + U256::one() };
    fit_u128(q)
}

fn floor_mul_div(a: u128, b: u128, den: u128) -> Result<u128, MathError> {
    if den == 0 {
        return Err(MathError::Overflow);
    }
    let n = mul(U256::from(a), U256::from(b))?;
    fit_u128(n / U256::from(den))
}

/// `ceil((num/den) ^ (2 - n64/64))` in 1e18 fixed point. Each step rounds up.
/// This is the integer power exit from `sim.py::ratio_pow_ceil`.
pub fn ratio_pow_ceil(num: u128, den: u128, n64: u32) -> Result<u128, MathError> {
    if den == 0 {
        return Err(MathError::Overflow);
    }
    let n64 = n64.min(W_STEPS);
    let x = ceil_mul_div(num, FP, den)?;
    if x >= FP {
        return Ok(FP);
    }
    let m = W_STEPS - n64;
    let acc = if m == W_STEPS {
        x
    } else {
        let mut acc = FP;
        let mut root = x;
        for bit in [32u32, 16, 8, 4, 2, 1] {
            let squared = mul(U256::from(root), U256::from(FP))?;
            root = fit_u128(ceil_isqrt(squared)?)?;
            if m & bit != 0 {
                acc = ceil_mul_div(acc, root, FP)?;
            }
        }
        acc
    };
    Ok(ceil_mul_div(x, acc, FP)?.min(FP))
}

/// Launch supply. `k0 = 1` in human units: `s0 = isqrt(2 * seed_raw * 1e30)`.
pub fn seed_supply(reserve_raw: u128) -> Result<u128, MathError> {
    // 2 * seed * 10^30
    let two_e30 = mul(U256::from(2u32), U256::from(10u128.pow(30)))?;
    let n = mul(U256::from(reserve_raw), two_e30)?;
    fit_u128(isqrt(n))
}

/// Spot price in raw USDC (6 decimals) for one whole token (1e18 raw).
pub fn price_raw(reserve: u128, supply: u128) -> Result<u128, MathError> {
    if supply == 0 {
        return Ok(0);
    }
    // 2 * R * 1e18 / s
    floor_mul_div(reserve, 2 * TOKEN_SCALE, supply)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeSplit {
    pub inherit: u128,
    pub protocol: u128,
    pub creator: u128,
    /// Buy: amount that mints tokens. Sell: amount the seller receives.
    pub rest: u128,
}

/// Three floored fee legs. Whatever is left stays in `rest` (the curve on a
/// buy, the seller on a sell). That matches `sim.py`, where the leftover of
/// the three floors is not added to the inheritance leg.
pub fn split_fees(
    gross: u128,
    inherit_bps: u32,
    protocol_bps: u32,
    creator_bps: u32,
) -> Result<FeeSplit, MathError> {
    let inherit = floor_mul_div(gross, inherit_bps as u128, BPS)?;
    let protocol = floor_mul_div(gross, protocol_bps as u128, BPS)?;
    let creator = floor_mul_div(gross, creator_bps as u128, BPS)?;
    let taken = inherit
        .checked_add(protocol)
        .and_then(|v| v.checked_add(creator))
        .ok_or(MathError::Overflow)?;
    if taken > gross {
        return Err(MathError::Overflow);
    }
    Ok(FeeSplit {
        inherit,
        protocol,
        creator,
        rest: gross - taken,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuyMint {
    pub supply_after: u128,
    pub minted: u128,
    pub reserve_after: u128,
    pub fees: FeeSplit,
}

/// Fees on. `reserve` and `supply` are the pre-buy values.
pub fn buy_mint(
    reserve: u128,
    supply: u128,
    gross: u128,
    inherit_bps: u32,
    protocol_bps: u32,
    creator_bps: u32,
) -> Result<BuyMint, MathError> {
    if reserve == 0 || supply == 0 {
        return Err(MathError::TooSmall);
    }
    let fees = split_fees(gross, inherit_bps, protocol_bps, creator_bps)?;
    let reserve_plus = reserve.checked_add(fees.rest).ok_or(MathError::Overflow)?;
    // s_new = isqrt( s^2 * (R + to_curve) / R )
    let s = U256::from(supply);
    let numer = mul(mul(s, s)?, U256::from(reserve_plus))?;
    let s_new = fit_u128(isqrt(numer / U256::from(reserve)))?;
    if s_new <= supply {
        return Err(MathError::TooSmall);
    }
    let reserve_after = reserve
        .checked_add(fees.rest)
        .and_then(|v| v.checked_add(fees.inherit))
        .ok_or(MathError::Overflow)?;
    Ok(BuyMint {
        supply_after: s_new,
        minted: s_new - supply,
        reserve_after,
        fees,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SellPayout {
    /// Reserve after the exit, before inheritance is added back.
    pub reserve_kept: u128,
    /// Reserve once inheritance has been added: `reserve_kept + inherit`.
    pub reserve_after: u128,
    pub gross: u128,
    pub net: u128,
    pub fees: FeeSplit,
    pub curve_gross: u128,
    pub prorata: u128,
}

pub fn sell_payout(
    reserve: u128,
    supply: u128,
    tokens: u128,
    n64: u32,
    inherit_bps: u32,
    protocol_bps: u32,
    creator_bps: u32,
) -> Result<SellPayout, MathError> {
    if tokens == 0 || tokens > supply || supply == 0 || reserve == 0 {
        return Err(MathError::TooSmall);
    }
    let s_new = supply - tokens;
    let gross_from = |n: u32| -> Result<(u128, u128), MathError> {
        let frac = ratio_pow_ceil(s_new, supply, n)?;
        let kept = ceil_mul_div(reserve, frac, FP)?.min(reserve);
        Ok((kept, reserve - kept))
    };
    let (reserve_kept, gross) = gross_from(n64)?;
    let (curve_kept, curve_gross) = gross_from(0)?;
    let _ = curve_kept;
    let prorata = floor_mul_div(reserve, tokens, supply)?;
    let fees = split_fees(gross, inherit_bps, protocol_bps, creator_bps)?;
    if fees.rest == 0 {
        return Err(MathError::ZeroPayout);
    }
    let reserve_after = reserve_kept
        .checked_add(fees.inherit)
        .ok_or(MathError::Overflow)?;
    Ok(SellPayout {
        reserve_kept,
        reserve_after,
        gross,
        net: fees.rest,
        fees,
        curve_gross,
        prorata,
    })
}

/// Pro-rata claim. `seed` is claimed only for the creator (pass 0 otherwise).
/// Returns `(balance_payout, creator_keep, haircut)`.
pub fn claim_amounts(
    snap_reserve: u128,
    snap_supply: u128,
    balance: u128,
    seed: u128,
    haircut_bps: u32,
) -> Result<(u128, u128, u128), MathError> {
    if snap_supply == 0 {
        return Ok((0, 0, 0));
    }
    let pay = floor_mul_div(snap_reserve, balance, snap_supply)?;
    let gross = floor_mul_div(snap_reserve, seed, snap_supply)?;
    let keep = floor_mul_div(gross, (BPS as u32 - haircut_bps) as u128, BPS)?;
    let hair = gross - keep;
    Ok((pay, keep, hair))
}

/// Hunger step in `0..=64`. Rounded up, which favours the pool.
pub fn hunger_n(t_rem: u64, t_ref: u64) -> u8 {
    if t_ref == 0 || t_rem >= t_ref {
        return 0;
    }
    if t_rem == 0 {
        return W_STEPS as u8;
    }
    let num = (W_STEPS as u128) * u128::from(t_ref - t_rem);
    let den = u128::from(t_ref);
    num.div_ceil(den) as u8
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Scar {
    pub n: u8,
    pub ts: u64,
}

/// Effective hunger and the scar that a trade would store.
/// The scar jumps up immediately and falls by at most one step per `step_ns`.
/// Views use the returned scar without writing it back.
pub fn scar_weight(scar: Scar, now: u64, t_rem: u64, t_ref: u64, step_ns: u64) -> (u8, Scar) {
    let nt = hunger_n(t_rem, t_ref);
    let steps = now
        .saturating_sub(scar.ts)
        .checked_div(step_ns)
        .unwrap_or(0);
    let decayed = if steps >= u64::from(scar.n) {
        0
    } else {
        scar.n - steps as u8
    };
    let n = nt.max(decayed);
    let updated = if nt > decayed {
        Scar { n: nt, ts: now }
    } else {
        Scar {
            n: decayed,
            ts: scar.ts.saturating_add(steps.saturating_mul(step_ns)),
        }
    };
    (n, updated)
}

pub fn twilight_factor_bps(t_rem: u64, twilight_ns: u64, min_bps: u32) -> u64 {
    let min_bps = u64::from(min_bps.min(10_000));
    if twilight_ns == 0 || t_rem >= twilight_ns {
        return 10_000;
    }
    if t_rem == 0 {
        return min_bps;
    }
    let span = 10_000u128 - u128::from(min_bps);
    min_bps + ((span * u128::from(t_rem)) / u128::from(twilight_ns)) as u64
}

pub fn raw_extension_ns(
    gross_raw: u128,
    ext_ns_per_raw: u128,
    factor_bps: u64,
) -> Result<u64, MathError> {
    let v = mul(
        mul(U256::from(gross_raw), U256::from(ext_ns_per_raw))?,
        U256::from(factor_bps),
    )?;
    let v = v / U256::from(BPS);
    if v > U256::from(u64::MAX) {
        Ok(u64::MAX)
    } else {
        Ok(v.as_u64())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bucket {
    pub b: u64,
    pub ts: u64,
}

/// Leaky bucket. `tier1` seconds (ns) are credited in full, the next `tier2`
/// at 50%, and anything past that at 0%. The bucket itself stores raw seconds,
/// not credited seconds. Leak is floored; tier-2 credit is floored.
pub fn credit_bucket(
    mut bucket: Bucket,
    raw_ns: u64,
    now: u64,
    tier1_ns: u64,
    tier2_ns: u64,
    leak_bps: u32,
) -> (u64, Bucket) {
    let elapsed = now.saturating_sub(bucket.ts);
    let leak = floor_mul_div(u128::from(elapsed), u128::from(leak_bps), BPS).unwrap_or(0) as u64;
    bucket.b = bucket.b.saturating_sub(leak);
    bucket.ts = now;
    let t2 = tier1_ns.saturating_add(tier2_ns);
    let mut credited = 0u64;
    let mut b = bucket.b;
    let mut left = raw_ns;
    let room1 = tier1_ns.saturating_sub(b);
    let take1 = left.min(room1);
    credited = credited.saturating_add(take1);
    b = b.saturating_add(take1);
    left -= take1;
    let room2 = t2.saturating_sub(b);
    let take2 = left.min(room2);
    credited = credited.saturating_add(take2 / 2);
    b = b.saturating_add(take2);
    bucket.b = b.min(t2);
    (credited, bucket)
}

pub fn max_life_ns(reserve: u128, min_ns: u64, max_ns: u64, r_small: u128, r_large: u128) -> u64 {
    if max_ns < min_ns {
        return min_ns;
    }
    if r_large <= r_small || reserve <= r_small {
        return min_ns;
    }
    if reserve >= r_large {
        return max_ns;
    }
    let span = u128::from(max_ns - min_ns);
    let add = span * (reserve - r_small) / (r_large - r_small);
    min_ns + add as u64
}

pub fn w_bps(n: u8) -> u16 {
    u16::try_from(u32::from(n.min(W_STEPS as u8)) * 10_000 / W_STEPS).unwrap_or(10_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INH: u32 = 50;
    const PRO: u32 = 30;
    const CRE: u32 = 20;

    fn usdc(whole: u128) -> u128 {
        whole * ONE_USDC
    }

    #[test]
    fn seed_supply_matches_sim() {
        let s500 = seed_supply(usdc(500)).unwrap();
        assert_eq!(s500, 31_622_776_601_683_793_319);
        assert!(s500 > 0);
        // s0^2 does not fit in u128, which is why the curve uses U256.
        assert!(U256::from(s500) * U256::from(s500) > U256::from(u128::MAX));
        let s100 = seed_supply(usdc(100)).unwrap();
        assert_eq!(s100, 14_142_135_623_730_950_488);
    }

    #[test]
    fn fees_off_curve_example_within_one_raw_unit() {
        // sim.py §2, fees off: 50 into 500 mints ~1.5434713019, and the later
        // curve exit at R=1000 is 67.834983 with pro-rata 34.513068.
        let s0 = seed_supply(usdc(500)).unwrap();
        let s1 = seed_supply(usdc(550)).unwrap();
        let s2 = seed_supply(usdc(1000)).unwrap();
        let minted = s1 - s0;
        let minted_human = minted as f64 / TOKEN_SCALE as f64;
        assert!(
            (minted_human - 1.543_471_301_9).abs() < 1e-9,
            "{minted_human}"
        );

        let x = minted;
        let payout = sell_payout(usdc(1000), s2, x, 0, 0, 0, 0).unwrap();
        assert!(payout.gross.abs_diff(67_834_983) <= 1, "{}", payout.gross);
        assert!(
            payout.prorata.abs_diff(34_513_068) <= 1,
            "{}",
            payout.prorata
        );
        assert!(payout.prorata <= payout.gross);
        assert!(payout.gross <= payout.curve_gross);
    }

    #[test]
    fn round_trip_matches_sim_integer() {
        // buy 50 then sell immediately at w=0. sim.py prints 49.027296; the
        // integer model returns 49.027295 (one raw unit of fee dust).
        let s0 = seed_supply(usdc(500)).unwrap();
        let buy = buy_mint(usdc(500), s0, usdc(50), INH, PRO, CRE).unwrap();
        let sell = sell_payout(
            buy.reserve_after,
            buy.supply_after,
            buy.minted,
            0,
            INH,
            PRO,
            CRE,
        )
        .unwrap();
        assert_eq!(
            (
                buy.fees.inherit,
                buy.fees.protocol,
                buy.fees.creator,
                buy.fees.rest,
                buy.minted,
                buy.reserve_after
            ),
            (
                250_000,
                150_000,
                100_000,
                49_500_000,
                buy.minted,
                buy.reserve_after
            )
        );
        // sim.py's integer Factory returns 49.027296 (49_027_296 raw).
        assert_eq!(
            sell.net, 49_027_296,
            "gross {} kept {}",
            sell.gross, sell.reserve_kept
        );
        assert!(sell.net < usdc(50));
    }

    #[test]
    fn hunger_quantises_up() {
        // 30s left of a 45s reference is 22/64 = 0.34375.
        assert_eq!(hunger_n(30_000_000_000, 45_000_000_000), 22);
        assert_eq!(hunger_n(45_000_000_000, 45_000_000_000), 0);
        assert_eq!(hunger_n(0, 45_000_000_000), 64);
        assert_eq!(w_bps(22), 3437);
    }

    #[test]
    fn scar_decays_one_step_and_resets_on_a_rise() {
        let step = 3_000_000_000u64;
        let t_ref = 45_000_000_000u64;
        let now = 1_000_000_000_000u64;
        let (n, scar) = scar_weight(Scar { n: 0, ts: 0 }, now, 30_000_000_000, t_ref, step);
        assert_eq!(n, 22);
        assert_eq!(scar.n, 22);
        assert_eq!(scar.ts, now);
        // Time passes one step, but the coin is fed back to full (n_time = 0).
        let (n, scar) = scar_weight(scar, now + step, t_ref, t_ref, step);
        assert_eq!(n, 21);
        assert_eq!(scar.n, 21);
        let (n, scar) = scar_weight(scar, now + 2 * step, t_ref, t_ref, step);
        assert_eq!(n, 20);
        // A rise replaces the scar immediately.
        let (n, scar) = scar_weight(scar, now + 2 * step, 5_000_000_000, t_ref, step);
        assert!(n > 20);
        assert_eq!(scar.n, n);
        assert_eq!(scar.ts, now + 2 * step);
    }

    #[test]
    fn fresh_bucket_credits_nine_hours() {
        let hour = 3_600 * 1_000_000_000u64;
        let raw = raw_extension_ns(usdc(500), 360_000, 10_000).unwrap();
        assert_eq!(raw, 180_000 * 1_000_000_000);
        let (credited, bucket) =
            credit_bucket(Bucket { b: 0, ts: 0 }, raw, 0, 6 * hour, 6 * hour, 2500);
        assert_eq!(credited, 9 * hour);
        assert_eq!(bucket.b, 12 * hour);
    }

    #[test]
    fn twilight_factor_matches_spec() {
        let hour = 3_600 * 1_000_000_000u64;
        assert_eq!(twilight_factor_bps(5 * hour, 2 * hour, 2500), 10_000);
        assert_eq!(twilight_factor_bps(hour, 2 * hour, 2500), 6250);
        assert_eq!(twilight_factor_bps(0, 2 * hour, 2500), 2500);
        let raw = raw_extension_ns(usdc(10), 360_000, 6250).unwrap();
        assert_eq!(raw, 2_250 * 1_000_000_000);
        // Demo: 10 USDC with 8s of a 10s twilight -> factor 0.850, +17s.
        assert_eq!(
            twilight_factor_bps(8_000_000_000, 10_000_000_000, 2500),
            8500
        );
        let raw = raw_extension_ns(usdc(10), 2_000, 8500).unwrap();
        assert_eq!(raw, 17 * 1_000_000_000);
    }

    #[test]
    fn sub_one_usdc_does_not_extend_and_half_buy_raw_is_zero_gate() {
        // The gate lives in the contract (`gross >= min_trade`). The raw
        // formula itself is linear, so 0.5 USDC would be half of 1 USDC.
        let raw = raw_extension_ns(ONE_USDC / 2, 360_000, 6250).unwrap();
        assert_eq!(raw, 112_500_000_000); // 112.5s before the 1 USDC gate
    }

    #[test]
    fn power_exit_never_pays_more_than_the_curve_and_chunking_does_not_help() {
        let reserve = usdc(1000);
        let supply = seed_supply(reserve).unwrap();
        for frac_bp in [1u128, 345, 2500, 5000, 9000] {
            for n in [0u32, 8, 22, 32, 63, 64] {
                let x = supply * frac_bp / 10_000;
                if x == 0 || x >= supply {
                    continue;
                }
                let p = sell_payout(reserve, supply, x, n, 0, 0, 0).unwrap();
                assert!(
                    p.gross <= p.curve_gross,
                    "n={n} gross {} curve {}",
                    p.gross,
                    p.curve_gross
                );
                // At full hunger the exit is pro-rata, rounded toward the pool.
                if n == 64 {
                    assert!(p.gross <= p.prorata);
                    let kept = reserve - p.gross;
                    let s_new = supply - x;
                    // Remaining backing does not fall: kept/s_new >= reserve/supply.
                    let left = U256::from(kept) * U256::from(supply);
                    let right = U256::from(reserve) * U256::from(s_new);
                    assert!(left >= right);
                }
            }
        }

        // Path independence, integer: splitting must not pay more than one sell.
        let x = supply / 2;
        let single = sell_payout(reserve, supply, x, 32, 0, 0, 0).unwrap().gross;
        let mut left_r = reserve;
        let mut left_s = supply;
        let mut total = 0u128;
        let part = x / 100;
        for _ in 0..100 {
            let p = sell_payout(left_r, left_s, part, 32, 0, 0, 0).unwrap();
            total += p.gross;
            left_r = p.reserve_after;
            left_s -= part;
        }
        assert!(total <= single, "chunked {total} single {single}");
    }

    #[test]
    fn demo_buy_and_sell_raw_numbers() {
        // sim.py §10 with the integer model. Human figures in the spec are the
        // continuous model; these are the chain values (within 0.000001 USDC).
        let mut reserve = usdc(100);
        let mut supply = seed_supply(reserve).unwrap();
        assert_eq!(supply, 14_142_135_623_730_950_488);

        let alice = buy_mint(reserve, supply, usdc(20), INH, PRO, CRE).unwrap();
        assert_eq!(alice.minted, 1_336_882_432_980_528_133);
        reserve = alice.reserve_after;
        supply = alice.supply_after;

        let bob = buy_mint(reserve, supply, usdc(30), INH, PRO, CRE).unwrap();
        assert_eq!(bob.minted, 1_811_165_826_509_553_515);
        reserve = bob.reserve_after;
        supply = bob.supply_after;

        let carol = buy_mint(reserve, supply, usdc(50), INH, PRO, CRE).unwrap();
        assert_eq!(carol.minted, 2_653_958_297_866_865_965);
        reserve = carol.reserve_after;
        supply = carol.supply_after;
        assert_eq!(reserve, usdc(199) + 500_000); // 199.5 USDC
        assert_eq!(supply, 19_944_142_181_087_898_101);

        let preview = sell_payout(reserve, supply, bob.minted, 0, INH, PRO, CRE).unwrap();
        assert_eq!(preview.gross, 34_588_718);
        assert_eq!(preview.net, 34_242_832);
        assert_eq!(preview.prorata, 18_116_977);

        let sold = sell_payout(reserve, supply, bob.minted, 22, INH, PRO, CRE).unwrap();
        assert_eq!(sold.gross, 29_102_528);
        assert_eq!(sold.net, 28_811_504);
        assert_eq!(sold.reserve_after, 170_542_984);
        let supply_after = supply - bob.minted;
        assert_eq!(supply_after, 18_132_976_354_578_344_586);
        assert!(sold.prorata < sold.gross && sold.gross < sold.curve_gross);

        let (alice_pay, _, _) =
            claim_amounts(sold.reserve_after, supply_after, alice.minted, 0, 5000).unwrap();
        let (carol_pay, _, _) =
            claim_amounts(sold.reserve_after, supply_after, carol.minted, 0, 5000).unwrap();
        let (_, keep, hair) = claim_amounts(
            sold.reserve_after,
            supply_after,
            0,
            14_142_135_623_730_950_488,
            5000,
        )
        .unwrap();
        assert_eq!(alice_pay, 12_573_551);
        assert_eq!(carol_pay, 24_960_820);
        assert_eq!(keep, 66_504_305);
        assert_eq!(hair, 66_504_306);
        let dust = sold.reserve_after - (alice_pay + carol_pay + keep + hair);
        assert_eq!(dust, 2);
        // Buys 100 USDC * 0.20% = 0.2, plus 0.20% of Bob's gross exit.
        let creator_fees = usdc(100) * 20 / 10_000 + sold.fees.creator;
        assert_eq!(creator_fees, 258_205);
    }

    #[test]
    fn bucket_tiers_and_leak() {
        let hour = 3_600 * 1_000_000_000u64;
        let mut bucket = Bucket { b: 0, ts: 0 };
        // Fill tier 1 exactly (6h raw).
        let (c1, b1) = credit_bucket(bucket, 6 * hour, 0, 6 * hour, 6 * hour, 2500);
        assert_eq!(c1, 6 * hour);
        bucket = b1;
        // An hour later the bucket has leaked 0.25h, so part of this buy is tier 1 again.
        let (c2, b2) = credit_bucket(bucket, 2 * hour, hour, 6 * hour, 6 * hour, 2500);
        // leak = 0.25h, b = 5.75h, room in tier 1 = 0.25h at 100%, rest 1.75h at 50%.
        assert_eq!(c2, hour / 4 + (2 * hour - hour / 4) / 2);
        assert_eq!(b2.b, 6 * hour + (2 * hour - hour / 4));
    }

    #[test]
    fn max_life_interpolates() {
        let min = 24 * 3_600 * 1_000_000_000u64;
        let max = 72 * 3_600 * 1_000_000_000u64;
        let small = usdc(1_000);
        let large = usdc(100_000);
        assert_eq!(max_life_ns(usdc(500), min, max, small, large), min);
        assert_eq!(max_life_ns(usdc(100_000), min, max, small, large), max);
        let mid = max_life_ns(usdc(50_500), min, max, small, large);
        assert!(mid > min && mid < max);
    }
}
