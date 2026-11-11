#!/usr/bin/env python3
"""
life-coin prototype math verifier (v2).

Pure Python standard library, no network.  Run:  python3 sim.py
Every number in PROTOTYPE.md comes from this script. Any failed check raises.
"""
from __future__ import annotations

import random
from decimal import Decimal, getcontext
from math import isqrt

getcontext().prec = 80
D = Decimal
ZERO, ONE, TWO = D(0), D(1), D(2)
H = D(3600)

# ---------------------------------------------------------------- parameters
FEE_BPS, INHERIT_BPS, PROTOCOL_BPS, CREATOR_BPS = 100, 50, 30, 20
CREATOR_HAIRCUT = D("0.5")          # share of creator's death claim sent to protocol
W_STEPS = 64                        # exit weight quantised to 1/64, rounded up

PROD = dict(
    initial_life=24 * H, t_ref=24 * H, twilight=2 * H, ext_per_usdc=D(360),
    max_life_min=24 * H, max_life_max=72 * H, r_small=D(1000), r_large=D(100000),
    tier1=6 * H, tier2=6 * H, leak=D("0.25"), scar_step=D(90 * 60),
)
DEMO = dict(
    initial_life=D(45), t_ref=D(45), twilight=D(10), ext_per_usdc=D(2),
    max_life_min=D(180), max_life_max=D(540), r_small=D(1000), r_large=D(100000),
    tier1=D(60), tier2=D(60), leak=D("0.25"), scar_step=D(3),
)
MIN_TRADE = D(1)
TWILIGHT_MIN = D("0.25")


def d(x):
    return x if isinstance(x, Decimal) else D(str(x))


def f6(x, p=6):
    return str(d(x).quantize(D(10) ** -p))


def dpow(x: Decimal, e: Decimal) -> Decimal:
    if x == 0:
        return ZERO
    return (x.ln() * e).exp()


LINES = []


def out(s=""):
    LINES.append(s)
    print(s)


def header(t):
    out()
    out("=" * 76)
    out(t)
    out("=" * 76)


def kv(k, v):
    out(f"  {k:<46} {v}")


def check(name, cond):
    out(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        raise AssertionError(name)


# ---------------------------------------------------------------- curve core
def s_of(R, k=ONE):
    return (TWO * R / k).sqrt()


def split(gross):
    inh = gross * INHERIT_BPS / 10000
    pro = gross * PROTOCOL_BPS / 10000
    cre = gross * CREATOR_BPS / 10000
    return gross - inh - pro - cre, inh, pro, cre


def curve_out(R, s, x):
    return R * (ONE - ((s - x) / s) ** 2)


def prorata_out(R, s, x):
    return R * x / s


def blend_out(R, s, x, w):
    return (ONE - w) * curve_out(R, s, x) + w * prorata_out(R, s, x)


def power_out(R, s, x, w):
    return R * (ONE - dpow((s - x) / s, TWO - w))


def quantise_w(w):
    """ceil(w * 64) / 64, clamped — rounding up favours the pool."""
    if w <= 0:
        return ZERO
    if w >= 1:
        return ONE
    n = int((w * W_STEPS).to_integral_value(rounding="ROUND_CEILING"))
    return D(n) / W_STEPS


def w_ramp(t_rem, t_ref):
    if t_rem >= t_ref:
        return ZERO
    if t_rem <= 0:
        return ONE
    return ONE - t_rem / t_ref


def twilight_factor(t_rem, tw):
    if t_rem >= tw:
        return ONE
    if t_rem <= 0:
        return TWILIGHT_MIN
    return TWILIGHT_MIN + (ONE - TWILIGHT_MIN) * t_rem / tw


def max_life(R, P):
    if R <= P["r_small"]:
        return P["max_life_min"]
    if R >= P["r_large"]:
        return P["max_life_max"]
    return P["max_life_min"] + (P["max_life_max"] - P["max_life_min"]) * (R - P["r_small"]) / (P["r_large"] - P["r_small"])


class Bucket:
    """Per (coin, account) leaky bucket of raw extension seconds."""

    def __init__(self):
        self.b = ZERO
        self.t = ZERO

    def credit(self, raw, now, P):
        self.b = max(ZERO, self.b - (now - self.t) * P["leak"])
        self.t = now
        t1, t2 = P["tier1"], P["tier1"] + P["tier2"]
        credited, b, left = ZERO, self.b, raw
        # tier 1 at 100 %
        take = min(left, max(ZERO, t1 - b)); credited += take; b += take; left -= take
        # tier 2 at 50 %
        take = min(left, max(ZERO, t2 - b)); credited += take / 2; b += take; left -= take
        self.b = min(b, t2)
        return credited


class Coin:
    """Continuous (Decimal) model of one coin, fees on."""

    def __init__(self, seed, P, now=ZERO):
        self.P = P
        self.R = d(seed)
        self.s = s_of(self.R)
        self.seed_tokens = self.s           # creator, claim-only
        self.bal = {}
        self.deadline = now + P["initial_life"]
        self.dead = False
        self.protocol = ZERO
        self.creator_fees = ZERO
        self.buckets = {}
        self.scar_n = 0
        self.scar_t = now
        self.use_scar = True

    def n_time(self, now):
        w = w_ramp(self.rem(now), self.P["t_ref"])
        return int((w * W_STEPS).to_integral_value(rounding="ROUND_CEILING"))

    def w_eff(self, now, write=True):
        """w rises at once; it falls by at most 1/64 per scar_step."""
        nt = self.n_time(now)
        if not self.use_scar:
            return D(nt) / W_STEPS
        steps = int((now - self.scar_t) / self.P["scar_step"])
        decayed = max(0, self.scar_n - steps)
        n = max(nt, decayed)
        if write:
            if nt > decayed:
                self.scar_n, self.scar_t = nt, now
            else:
                self.scar_n, self.scar_t = decayed, self.scar_t + steps * self.P["scar_step"]
        return D(n) / W_STEPS

    def rem(self, now):
        return max(ZERO, self.deadline - now)

    def touch(self, now):
        if not self.dead and now >= self.deadline:
            self.dead = True
            self.snapR, self.snapS = self.R, self.s

    def buy(self, who, gross, now):
        self.touch(now)
        assert not self.dead
        self.w_eff(now)
        gross = d(gross)
        to_curve, inh, pro, cre = split(gross)
        s_new = self.s * ((self.R + to_curve) / self.R).sqrt()
        minted = s_new - self.s
        self.R += to_curve + inh
        self.s = s_new
        self.bal[who] = self.bal.get(who, ZERO) + minted
        self.protocol += pro
        self.creator_fees += cre
        ext = ZERO
        rem = self.rem(now)
        if gross >= MIN_TRADE:
            raw = gross * self.P["ext_per_usdc"] * twilight_factor(rem, self.P["twilight"])
            ext = self.buckets.setdefault(who, Bucket()).credit(raw, now, self.P)
        new_rem = min(rem + ext, max_life(self.R, self.P))
        self.deadline = now + new_rem
        return dict(minted=minted, ext=ext, rem=new_rem, to_curve=to_curve, inh=inh, pro=pro, cre=cre)

    def sell(self, who, x, now):
        self.touch(now)
        assert not self.dead
        assert x <= self.bal.get(who, ZERO)
        w = self.w_eff(now)
        raw = power_out(self.R, self.s, x, w)
        _, inh, pro, cre = split(raw)
        user = raw - inh - pro - cre
        self.R = self.R - raw + inh
        self.s -= x
        self.bal[who] -= x
        self.protocol += pro
        self.creator_fees += cre
        return dict(w=w, raw=raw, user=user, curve=curve_out(self.R + raw - inh, self.s + x, x),
                    prorata=prorata_out(self.R + raw - inh, self.s + x, x))

    def claim_preview(self, who):
        R, s = (self.snapR, self.snapS) if self.dead else (self.R, self.s)
        if who == "creator":
            gross = R * self.seed_tokens / s
            return gross * (ONE - CREATOR_HAIRCUT), gross * CREATOR_HAIRCUT
        return R * self.bal.get(who, ZERO) / s, ZERO


# ============================================================ sections
def sec_identities():
    header("1. Curve identities (k = 1 unless noted)")
    out("  p = k s ;  R = k s^2 / 2 ;  s = sqrt(2R/k) ;  p = sqrt(2kR) ;  MC = p s = 2R")
    for R in (D(500), D(1000)):
        s = s_of(R)
        kv(f"R={R}", f"s={f6(s, 8)}  p={f6(s, 8)}  MC={f6(s * s, 4)}")
        check(f"MC == 2R at R={R}", abs(s * s - 2 * R) < D("1e-40"))
    r = s_of(D(1000)) / s_of(D(500))
    kv("p(1000)/p(500)", f6(r, 12))
    check("doubling the pool multiplies price by sqrt(2)", abs(r - TWO.sqrt()) < D("1e-40"))
    outs = []
    for k in (ONE, D("0.25"), D(4)):
        s0, s1, s2 = s_of(D(500), k), s_of(D(550), k), s_of(D(1000), k)
        outs.append(curve_out(D(1000), s2, s1 - s0))
    check("USDC payouts are k-independent", max(outs) - min(outs) < D("1e-40"))


def sec_canonical():
    header("2. 50 / 500 / 1000 example (fees off, pure curve exit)")
    s0, s1, s2 = s_of(D(500)), s_of(D(550)), s_of(D(1000))
    x = s1 - s0
    sell = curve_out(D(1000), s2, x)
    claim = prorata_out(D(1000), s2, x)
    kv("tokens minted for 50 USDC at R=500", f6(x, 10))
    kv("curve exit at R=1000", f6(sell))
    kv("profit", f"{f6(sell - 50)} ({f6((sell - 50) * 2, 4)} %)")
    kv("pro-rata value at R=1000", f6(claim))
    kv("curve / pro-rata", f6(sell / claim))
    check("sell ~ 67.834983", abs(sell - D("67.834983216189")) < D("1e-12"))
    check("pro-rata ~ 34.513068", abs(claim - D("34.513067523019")) < D("1e-12"))
    return x, s2


def sec_exit_rule():
    header("3. Exit rule: power exit vs linear blend")
    out("  power exit :  payout = R * (1 - (s'/s)^(2-w))      s' = s - x")
    out("  linear     :  payout = (1-w)*curve + w*prorata")
    R, s = D(1000), s_of(D(1000))
    # bounds
    ok_bounds = True
    for frac in (D("0.001"), D("0.0345"), D("0.25"), D("0.5"), D("0.9")):
        x = s * frac
        for w in (ZERO, D("0.25"), D("0.5"), D("0.75"), ONE):
            p = power_out(R, s, x, w)
            if not (prorata_out(R, s, x) - D("1e-30") <= p <= curve_out(R, s, x) + D("1e-30")):
                ok_bounds = False
    check("pro-rata <= power exit <= curve for all tested (x, w)", ok_bounds)
    # w = 1 keeps R/s
    x = s * D("0.3")
    p = power_out(R, s, x, ONE)
    check("w=1 exit leaves R/s unchanged (remaining holders unharmed)",
          abs((R - p) / (s - x) - R / s) < D("1e-40"))
    out("  Remaining holders' per-token value after an exit of fraction f at weight w:")
    out("     (R'/s') / (R/s) = (1-f)^(1-w)")
    for w in (ZERO, D("0.5"), ONE):
        f = D("0.3")
        after = (R - power_out(R, s, s * f, w)) / (s * (1 - f))
        kv(f"  f=0.30 w={w}", f"per-token value x{f6(after / (R / s), 6)}")
    # chunking
    out()
    out("  Chunking test: sell x in one tx vs 100 equal txs at fixed w=0.5")
    res = {}
    for name, fn in (("linear", blend_out), ("power", power_out)):
        for frac in (D("0.0345"), D("0.5")):
            x = s * frac
            single = fn(R, s, x, D("0.5"))
            RR, ss, tot = R, s, ZERO
            for _ in range(100):
                pay = fn(RR, ss, x / 100, D("0.5"))
                tot += pay; RR -= pay; ss -= x / 100
            res[(name, frac)] = (single, tot)
            kv(f"  {name:<6} x/s={frac}", f"single={f6(single)}  chunked={f6(tot)}  gain={f6(tot - single)}")
    check("linear blend: chunking pays MORE (path-dependent, exploitable)",
          res[("linear", D("0.5"))][1] > res[("linear", D("0.5"))][0] + D("1"))
    check("power exit: chunking pays the same (path-independent)",
          all(abs(a - b) < D("1e-30") for (n, _), (a, b) in res.items() if n == "power"))
    return res


def build_run_coin(P):
    """seed 500 (creator), Alice 50, nine others 50 each — fees on, at t=0."""
    c = Coin(500, P)
    c.buy("alice", 50, ZERO)
    for i in range(9):
        c.buy(f"h{i}", 50, ZERO)
    return c


def sec_ramp():
    header("4. Where should w ramp?  A = over twilight (2h)  vs  B = over last 24h")
    P = PROD
    c0 = build_run_coin(P)
    kv("test coin: reserve / supply", f"{f6(c0.R)} / {f6(c0.s, 8)}")
    holders = ["alice"] + [f"h{i}" for i in range(9)]

    def w_for(opt, t_rem):
        if opt == "A":
            return w_ramp(t_rem, P["twilight"])          # continuous
        return quantise_w(w_ramp(t_rem, P["t_ref"]))      # the rule we ship

    out()
    out("  (a) Small holder (1% of supply): exit value as a share of curve value")
    out("      T_rem      w_A     A: exit/curve     w_B      B: exit/curve")
    R, s = c0.R, c0.s
    x = s * D("0.01")
    for hrs in (D(30), D(24), D(12), D(6), D(3), D(2), D(1), D("0.25"), D(0)):
        t = hrs * H
        wa, wb = w_for("A", t), w_for("B", t)
        ea = power_out(R, s, x, wa) / curve_out(R, s, x)
        eb = power_out(R, s, x, wb) / curve_out(R, s, x)
        out(f"      {f6(hrs, 2):>6}h   {f6(wa, 4)}   {f6(ea, 4):>10}       {f6(wb, 4)}    {f6(eb, 4):>10}")

    # cliff metrics
    worst = {"A": ZERO, "B": ZERO}
    worst_h = {"A": ZERO, "B": ZERO}
    vals = {}
    for opt in ("A", "B"):
        for m in range(0, 26 * 60 + 1):
            t = D(m) * 60
            vals[(opt, m)] = power_out(R, s, x, w_for(opt, t)) / curve_out(R, s, x)
        for m in range(1, 26 * 60 + 1):
            drop = vals[(opt, m)] - vals[(opt, m - 1)]   # value at more remaining minus less remaining
            worst[opt] = max(worst[opt], drop)
        for m in range(60, 26 * 60 + 1):
            worst_h[opt] = max(worst_h[opt], vals[(opt, m)] - vals[(opt, m - 60)])
    out()
    kv("A: worst loss from waiting 1 minute", f"{f6(worst['A'] * 100, 3)} % of curve value")
    kv("B: worst loss from waiting 1 minute", f"{f6(worst['B'] * 100, 3)} % of curve value")
    kv("A: worst loss from waiting 1 hour", f"{f6(worst_h['A'] * 100, 3)} % of curve value")
    kv("B: worst loss from waiting 1 hour", f"{f6(worst_h['B'] * 100, 3)} % of curve value")
    check("B spreads the decay: 1-hour worst loss under B < 1/5 of A", worst_h["B"] * 5 < worst_h["A"])
    check("B has no cliff: 1-minute worst loss <= 1%", worst["B"] <= D("0.01"))

    out()
    out("  (b) Bank run: all 10 non-creator holders sell in sequence at a given T_rem.")
    out("      fairness = last seller's USDC per token / first seller's USDC per token (1 = no race)")
    out("      creator_left = creator's gross pro-rata claim on what remains")
    out("      T_rem    opt   w        first/tok    last/tok   fairness   creator_left")
    table = {}
    for hrs in (D(23), D(12), D(3), D("2.01"), D(1)):
        for opt in ("A", "B"):
            c = build_run_coin(P)
            t = hrs * H
            w = w_for(opt, t)
            per = []
            for h in holders:
                x_h = c.bal[h]
                pay = power_out(c.R, c.s, x_h, w)
                _, inh, _, _ = split(pay)
                c.R = c.R - pay + inh
                c.s -= x_h
                per.append(pay / x_h)
            fair = per[-1] / per[0]
            creator_left = c.R  # creator owns all remaining supply
            table[(hrs, opt)] = (fair, creator_left)
            out(f"      {f6(hrs, 2):>5}h   {opt}    {f6(w, 4)}   {f6(per[0], 4):>9}   {f6(per[-1], 4):>9}   {f6(fair, 4):>7}   {f6(creator_left, 4):>10}")
    check("at T_rem=3h, A is a pure-curve race (fairness < 0.75)", table[(D(3), "A")][0] < D("0.75"))
    check("at T_rem=3h, B is near-fair (fairness > 0.95)", table[(D(3), "B")][0] > D("0.95"))
    check("just before twilight (2.01h) A still races, B does not",
          table[(D("2.01"), "A")][0] < D("0.75") and table[(D("2.01"), "B")][0] > D("0.95"))
    check("creator's seed backing survives every run (R >= 500)",
          all(v[1] >= D(500) for v in table.values()))
    return dict(worst=worst, worst_h=worst_h, table=table)


def sec_feed_dump():
    header("4b. Feed-then-dump: buy time to lower w, then exit on the curve")
    P = PROD

    def make():
        c = Coin(500, P)
        c.buy("whale", 300, ZERO)
        c.buy("other", 200, ZERO)
        return c

    c = make()
    now = 12 * H                       # quiet for 12 h: T_rem 12 h, w = 0.5
    w0 = c.w_eff(now)
    x = c.bal["whale"]
    base = power_out(c.R, c.s, x, w0)
    kv("whale share of supply", f6(x / c.s, 4))
    kv("whale exit at T_rem=12h (w=0.5)", f6(base, 2))

    def feed_until_low(scar):
        """Four sybil accounts refill the timer to 24 h every 30 min until w <= 2/64."""
        c = make()
        c.use_scar = scar
        now = 12 * H
        c.w_eff(now)
        vol, steps = ZERO, 0
        while True:
            need = c.P["max_life_min"] - c.rem(now)
            if need > 0:
                per = max((need / c.P["ext_per_usdc"] / 4).quantize(D("0.000001"), rounding="ROUND_CEILING"), MIN_TRADE)
                for a in range(4):
                    c.buy(f"f{a}", per, now)
                    vol += per
            w = c.w_eff(now)
            if w <= TWO / W_STEPS:
                return c, w, vol, D(steps) / 2
            now += H / 2
            steps += 1

    for scar in (False, True):
        cc, w_end, vol, hrs = feed_until_low(scar)
        x = cc.bal["whale"] + sum(cc.bal[f"f{a}"] for a in range(4))
        gross = power_out(cc.R, cc.s, x, w_end)          # whale + sybils exit together
        net = gross * D("0.99") - vol - base * D("0.99")  # vs exiting at once at w=0.5
        label = "with scar" if scar else "no scar"
        kv(f"{label}: hours fed / buy volume / final w", f"{f6(hrs, 2)} h / {f6(vol, 2)} USDC / {f6(w_end, 6)}")
        kv(f"{label}: whale+sybils exit (net of fee) - feed spend", f"{f6(gross * D('0.99') - vol, 2)} USDC")
        kv(f"{label}: advantage over exiting now at w=0.5", f6(net, 2))
        if not scar:
            check("without the scar an instant 120 USDC feed pays off", hrs == 0 and net > 50)
            nos = (hrs, vol, net)
        else:
            check("with the scar the reset needs >= 44 h of public feeding", hrs >= 44)
            withs = (hrs, vol, net)
    out("  Residual: the reset still pays for a large holder; the scar only makes it")
    out("  slow and public, so every holder sees w falling and can exit on the same terms.")
    return dict(base=base, nos=nos, withs=withs)


def sec_creator():
    header("5. Creator: seed tokens claim-only + 50% haircut on death claim")
    out("  Creator cannot sell or transfer seed tokens. At death the creator receives")
    out("  50% of the seed tokens' pro-rata claim; the other 50% goes to the protocol.")
    out("  Break-even pool growth (fees ignored): R_death / R_seed = 1/(1-h)^2 = 4")
    P = PROD
    rows = []

    def scenario(name, buys, days_volume=ZERO, days=ZERO, self_buys=ZERO):
        c = Coin(500, P)
        for g in buys:
            c.buy("buyer", g, ZERO)
        if self_buys:
            c.buy("creator_sybil", self_buys, ZERO)
        # organic volume while alive: model as buy-then-sell round trips by others at w=0
        if days_volume and days:
            vol = days_volume * days
            c.creator_fees += vol * CREATOR_BPS / 10000 * 2  # buy leg + sell leg
            c.R += vol * INHERIT_BPS / 10000 * 2
        net_claim, haircut = c.claim_preview("creator")
        sybil = c.R * c.bal.get("creator_sybil", ZERO) / c.s if self_buys else ZERO
        outlay = D(500) + self_buys
        payoff = net_claim + c.creator_fees + sybil - outlay
        rows.append((name, c.R, net_claim, c.creator_fees, payoff))
        kv(name, f"R={f6(c.R, 2)} claim={f6(net_claim, 2)} fees={f6(c.creator_fees, 2)} net={f6(payoff, 2)}")
        return payoff

    p1 = scenario("S1 nobody buys, dies at 24h", [])
    p2 = scenario("S2 buyers add 300, dies quickly", [300])
    p3 = scenario("S3 buyers grow pool to ~4x (1500)", [1508])
    p4 = scenario("S4 pool ~10x (4500) + 30 days x 1000/day volume", [4523], D(1000), D(30))
    p5 = scenario("S5 creator self-pumps 1500 via a 2nd wallet, lets die", [], self_buys=D(1500))
    check("creator loses if the coin dies with no buyers (-250)", abs(p1 + 250) < D("1e-20"))
    check("creator loses if it dies quickly with modest buying", p2 < 0)
    check("creator profits only after strong growth + life", p4 > 0)
    check("self-pumping then letting it die loses money", p5 < 0)
    out()
    out("  Why the haircut goes to the protocol, not to other holders:")
    R0 = D(500)
    X = D(50)
    R = R0 + X
    cre_gross = (R0 * R).sqrt()
    to_sniper = R - cre_gross * (ONE - CREATOR_HAIRCUT)
    kv("if redistributed: lone sniper buys 50, claims", f"{f6(to_sniper)} (profit {f6(to_sniper - X)})")
    check("redistributing the haircut would be exploitable", to_sniper > X)
    return dict(p1=p1, p2=p2, p3=p3, p4=p4, p5=p5, rows=rows)


def sec_snipe():
    header("6. Buying right before death (non-creator claims are plain pro-rata)")
    out("  profit = R - sqrt(R (R+X))  < 0  (fees off; fees make it worse)")
    for R in (D(500), D(1000)):
        for X in (D(1), D(50), D(1000)):
            s0, s1 = s_of(R), s_of(R + X)
            claim = (R + X) * (s1 - s0) / s1
            kv(f"R={R} X={X}", f"claim={f6(claim)} profit={f6(claim - X)}")
            check(f"snipe unprofitable R={R} X={X}", claim < X)


def sec_timer():
    header("7. Timer: buys feed the coin; per-account leaky bucket; wash cost")
    P = PROD
    out("  Only buys extend the timer (sells never do).")
    out("  ext = gross_USDC * 360 s * twilight_factor, then per-account tiers:")
    out("  bucket b leaks 0.25 s per s; raw seconds while b<6h credited 100%,")
    out("  while 6h<=b<12h credited 50%, beyond 12h credited 0.")
    for t_rem, g in ((5 * H, D(10)), (H, D(10)), (ZERO, D(10)), (H, D("0.5"))):
        f = twilight_factor(t_rem, P["twilight"])
        raw = g * P["ext_per_usdc"] * f if g >= MIN_TRADE else ZERO
        kv(f"T_rem={f6(t_rem / H, 2)}h buy {g}", f"factor={f6(f, 4)} raw={f6(raw, 1)} s")
    check("twilight factor at 1h is 0.625", twilight_factor(H, P["twilight"]) == D("0.625"))
    b = Bucket()
    whale = b.credit(D(500) * 360, ZERO, P)
    kv("fresh account buys 500 USDC (raw 50h)", f"credited {f6(whale / H, 2)} h")
    check("single buy credit capped at 6h + 3h = 9h", whale == 9 * H)

    def simulate(n_accounts, usdc_per_hour_total, days=7):
        coin_deadline = P["initial_life"]
        buckets = [Bucket() for _ in range(n_accounts)]
        R = D(500)
        alive_hours = 0
        for hour in range(1, days * 24 + 1):
            now = D(hour) * H
            if now >= coin_deadline:
                return alive_hours, False
            alive_hours = hour
            per = usdc_per_hour_total / n_accounts
            rem = coin_deadline - now
            for bk in buckets:
                raw = per * P["ext_per_usdc"] * twilight_factor(rem, P["twilight"]) if per >= MIN_TRADE else ZERO
                rem = min(rem + bk.credit(raw, now, P), max_life(R, P))
            coin_deadline = now + rem
        return alive_hours, True

    for n, usd in ((1, D(10)), (1, D(40)), (2, D(10)), (4, D(10)), (4, D(12))):
        hrs, alive = simulate(n, usd)
        kv(f"{n} account(s), {usd} USDC/h total", f"{'ALIVE after 7 days' if alive else f'dead after ~{hrs} h'}")
    check("one account cannot keep a coin alive at any spend",
          not simulate(1, D(10))[1] and not simulate(1, D(40))[1])
    check("four accounts at 10 USDC/h total keep it alive",
          simulate(4, D(10))[1] or simulate(4, D(12))[1])
    # cost
    vol_day = D(240)
    kv("buy volume needed / day", f"{vol_day} USDC (at least 4 accounts)")
    kv("fees if washer keeps the tokens (1%)", f"{f6(vol_day / 100, 2)} USDC/day")
    kv("fees if washer sells back too (2%)", f"{f6(vol_day * 2 / 100, 2)} USDC/day")
    usdc_reg = D("0.00125")
    factory_pos = D(150) * D("0.00001")
    per_acct = usdc_reg + factory_pos
    kv("per sybil: USDC storage_deposit (RPC-verified)", f"{usdc_reg} NEAR")
    kv("per sybil: factory position ~150 B (estimate)", f"{f6(factory_pos, 5)} NEAR")
    kv("per sybil total (estimate)", f"{f6(per_acct, 5)} NEAR ~ ${f6(per_acct * D('3.65'), 4)} @ $3.65")
    kv("4 sybils, one-time (estimate)", f"{f6(per_acct * 4, 4)} NEAR ~ ${f6(per_acct * 4 * D('3.65'), 3)}")
    return dict(per_acct=per_acct)


# ---------------------------------------------------------------- integer model
SC = 10 ** 18
USDC = 10 ** 6
TOK = 10 ** 18


def ceil_div(a, b):
    return -(-a // b)


def ceil_isqrt(n):
    r = isqrt(n)
    return r if r * r == n else r + 1


def ratio_pow_ceil(num, den, n64):
    """ceil((num/den)^(2 - n64/64)) in SC fixed point, every step rounded up."""
    x = ceil_div(num * SC, den)
    if x >= SC:
        return SC
    m = W_STEPS - n64
    if m == W_STEPS:
        acc = x
    else:
        acc = SC
        root = x
        for bit in (32, 16, 8, 4, 2, 1):
            root = ceil_isqrt(root * SC)
            if m & bit:
                acc = ceil_div(acc * root, SC)
    return min(SC, ceil_div(x * acc, SC))


def n64_of(t_rem, t_ref):
    if t_rem >= t_ref:
        return 0
    if t_rem <= 0:
        return W_STEPS
    return ceil_div(W_STEPS * (t_ref - t_rem), t_ref)


class Factory:
    def __init__(self):
        self.usdc_held = 0
        self.protocol = 0
        self.coins = {}
        self.wallet = {}

    def launch(self, cid, creator, seed, now, life):
        self.usdc_held += seed
        s0 = isqrt(2 * seed * TOK * TOK // USDC)  # k0 = 1 in human units
        self.coins[cid] = dict(R=seed, s=s0, seed=s0, creator=creator, bal={}, deadline=now + life,
                               dead=False, cfees=0, snapR=0, snapS=0)
        self.wallet[creator] = self.wallet.get(creator, 0) - seed

    def touch(self, c, now):
        if not c["dead"] and now >= c["deadline"]:
            c["dead"], c["snapR"], c["snapS"] = True, c["R"], c["s"]

    def buy(self, cid, who, gross, now, ext_ns):
        c = self.coins[cid]
        self.touch(c, now)
        if c["dead"]:
            return None
        inh = gross * INHERIT_BPS // 10000
        pro = gross * PROTOCOL_BPS // 10000
        cre = gross * CREATOR_BPS // 10000
        to_curve = gross - inh - pro - cre
        s_new = isqrt(c["s"] * c["s"] * (c["R"] + to_curve) // c["R"])
        if s_new <= c["s"]:
            return None
        self.usdc_held += gross
        self.wallet[who] = self.wallet.get(who, 0) - gross
        c["bal"][who] = c["bal"].get(who, 0) + s_new - c["s"]
        c["s"] = s_new
        c["R"] += to_curve + inh
        self.protocol += pro
        c["cfees"] += cre
        c["deadline"] = max(c["deadline"], now) + ext_ns
        return s_new

    def sell(self, cid, who, x, now, t_ref):
        c = self.coins[cid]
        self.touch(c, now)
        if c["dead"] or x <= 0 or x > c["bal"].get(who, 0):
            return None
        n = n64_of(c["deadline"] - now, t_ref)
        frac = ratio_pow_ceil(c["s"] - x, c["s"], n)
        R_new = min(c["R"], ceil_div(c["R"] * frac, SC))
        raw = c["R"] - R_new
        inh = raw * INHERIT_BPS // 10000
        pro = raw * PROTOCOL_BPS // 10000
        cre = raw * CREATOR_BPS // 10000
        user = raw - inh - pro - cre
        if user <= 0:
            return None
        c["R"] = R_new + inh
        c["s"] -= x
        c["bal"][who] -= x
        self.protocol += pro
        c["cfees"] += cre
        self.usdc_held -= user
        self.wallet[who] = self.wallet.get(who, 0) + user
        return user

    def claim(self, cid, who, now):
        c = self.coins[cid]
        self.touch(c, now)
        if not c["dead"]:
            return None
        pay = 0
        x = c["bal"].get(who, 0)
        if x:
            pay += c["snapR"] * x // c["snapS"]
            c["bal"][who] = 0
        if who == c["creator"] and c["seed"]:
            gross = c["snapR"] * c["seed"] // c["snapS"]
            keep = gross * 5 // 10
            self.protocol += gross - keep
            c["R"] -= gross - keep
            c["seed"] = 0
            c["R"] -= keep
            self.usdc_held -= keep
            self.wallet[who] = self.wallet.get(who, 0) + keep
        c["R"] -= pay
        self.usdc_held -= pay
        self.wallet[who] = self.wallet.get(who, 0) + pay
        return pay

    def withdraw_fees(self, cid):
        c = self.coins[cid]
        amt = c["cfees"]
        c["cfees"] = 0
        self.usdc_held -= amt
        self.wallet[c["creator"]] = self.wallet.get(c["creator"], 0) + amt

    def liabilities(self):
        return sum(c["R"] + c["cfees"] for c in self.coins.values()) + self.protocol


def sec_integer():
    header("8. Integer path: decimals, overflow, rounding, power exit")
    s0 = isqrt(2 * 500 * USDC * TOK * TOK // USDC)
    kv("seed 500 USDC -> s0 raw (18 dp)", str(s0))
    check("s0^2 overflows u128 -> U256 intermediates required", s0 * s0 > 2 ** 128 - 1)
    check("s0^2 * R fits U256", s0 * s0 * 500 * USDC < 2 ** 256)
    # integer power exit vs Decimal
    worst = ZERO
    ok = True
    for frac_bp in (1, 345, 2500, 5000, 9000):
        for n in (0, 8, 22, 32, 63, 64):
            R, s = 1000 * USDC, isqrt(2 * 1000 * TOK * TOK)
            x = s * frac_bp // 10000
            frac = ratio_pow_ceil(s - x, s, n)
            R_new = min(R, ceil_div(R * frac, SC))
            pay_int = D(R - R_new) / USDC
            pay_dec = power_out(D(1000), D(s) / TOK, D(x) / TOK, D(n) / 64)
            if pay_int > pay_dec + D("0.000001"):
                ok = False
            worst = max(worst, pay_dec - pay_int)
    check("integer power exit never pays more than exact (beyond 1 raw unit)", ok)
    kv("largest integer under-payment vs exact", f"{f6(worst, 6)} USDC")
    check("integer under-payment is negligible (< 0.001 USDC)", worst < D("0.001"))
    # round trip
    f = Factory()
    f.launch(1, "cr", 500 * USDC, 0, 10 ** 15)
    got = f.buy(1, "u", 50 * USDC, 0, 0)
    back = f.sell(1, "u", f.coins[1]["bal"]["u"], 0, 10 ** 15)
    kv("buy 50 then sell immediately (w=0) returns", f"{D(back) / USDC} USDC")
    check("round trip cannot profit", back < 50 * USDC)


def sec_property():
    header("9. Property tests (seeded random sequences, integer model)")
    rng = random.Random(20261112)
    T_REF = 45 * 10 ** 9
    runs, ops_total, extract_fail, inv_fail = 400, 0, 0, 0
    worst_gain = None
    for run in range(runs):
        f = Factory()
        f.launch(1, "creator", rng.randint(10, 1000) * USDC, 0, T_REF)
        for p in ("p1", "p2", "p3"):
            f.buy(1, p, rng.randint(1, 300) * USDC, 0, rng.randint(0, 30) * 10 ** 9)
        now = 0
        attacker_in = 0
        for _ in range(60):
            ops_total += 1
            op = rng.random()
            if op < 0.35:
                g = rng.randint(1, 500) * USDC + rng.randint(0, USDC - 1)
                if f.buy(1, "atk", g, now, rng.randint(0, 40) * 10 ** 9) is not None:
                    attacker_in += g
            elif op < 0.7:
                bal = f.coins[1]["bal"].get("atk", 0)
                if bal:
                    f.sell(1, "atk", rng.randint(1, bal), now, T_REF)
            elif op < 0.9:
                now += rng.randint(1, 20) * 10 ** 9
            else:
                f.claim(1, "atk", now)
            if f.usdc_held != f.liabilities() or any(c["R"] < 0 for c in f.coins.values()):
                inv_fail += 1
        now += 10 ** 13
        f.claim(1, "atk", now)
        for p in ("p1", "p2", "p3", "creator"):
            f.claim(1, p, now)
        f.withdraw_fees(1)
        if f.usdc_held != f.liabilities() or f.coins[1]["R"] < 0:
            inv_fail += 1
        gain = f.wallet.get("atk", 0)  # buys are negative, payouts positive
        if gain > 0:
            extract_fail += 1
        worst_gain = gain if worst_gain is None else max(worst_gain, gain)
    kv("random runs / ops", f"{runs} / {ops_total}")
    kv("best attacker net result", f"{D(worst_gain) / USDC} USDC")
    check("solvency invariant usdc_held == sum(reserves)+fees after every op", inv_fail == 0)
    check("no attacker sequence extracted value from passive holders", extract_fail == 0)


def sec_demo():
    header("10. Demo walkthrough (demo timers, fees on)")
    P = DEMO
    kv("timers", "initial 45 s, t_ref 45 s, cap 180 s, twilight 10 s, +2 s per USDC")
    kv("per-account tiers", "first 60 s at 100%, next 60 s at 50%, leak 0.25 s/s")
    c = Coin(100, P, ZERO)
    kv("t=0   launch 100 USDC: creator seed tokens", f6(c.s))
    kv("      price / timer", f"{f6(c.s)} USDC / {f6(c.rem(ZERO), 1)} s")
    a = c.buy("alice", 20, D(10))
    kv("t=10  Alice buys 20: tokens / +ext / timer", f"{f6(a['minted'])} / +{f6(a['ext'], 1)} s / {f6(a['rem'], 1)} s")
    b = c.buy("bob", 30, D(20))
    kv("t=20  Bob buys 30: tokens / +ext / timer", f"{f6(b['minted'])} / +{f6(b['ext'], 1)} s / {f6(b['rem'], 1)} s")
    cc = c.buy("carol", 50, D(30))
    kv("t=30  Carol buys 50: tokens / +ext / timer", f"{f6(cc['minted'])} / +{f6(cc['ext'], 1)} s / {f6(cc['rem'], 1)} s")
    kv("      pool / supply / price", f"{f6(c.R)} / {f6(c.s)} / {f6(c.s * 2 * c.R / (c.s * c.s))}")
    check("Alice +40 s, Bob +60 s stack visibly", a["ext"] == 40 and b["ext"] == 60)
    check("Carol's 100 raw s credited 80 s (tier 2) and timer capped at 180 s",
          cc["ext"] == 80 and cc["rem"] == 180)
    # preview at w=0 (t=40, rem 170)
    w0 = quantise_w(w_ramp(c.rem(D(40)), P["t_ref"]))
    bx = c.bal["bob"]
    kv("t=40  Bob exit preview (w=0): gross / net", f"{f6(power_out(c.R, c.s, bx, w0))} / {f6(power_out(c.R, c.s, bx, w0) * D('0.99'))}")
    kv("      Bob pro-rata (death) value", f6(prorata_out(c.R, c.s, bx)))
    # jump: remaining = 30 s
    now = D(60)
    c.deadline = now + 30
    sb = c.sell("bob", bx, now)
    kv("jump to 30 s left; w = ceil(64*(1-30/45))/64", f6(sb["w"], 6))
    kv("Bob sells all: curve / pro-rata / paid gross", f"{f6(sb['curve'])} / {f6(sb['prorata'])} / {f6(sb['raw'])}")
    kv("      Bob receives after 1% fee", f6(sb["user"]))
    kv("      pool / supply after", f"{f6(c.R)} / {f6(c.s)}")
    check("Bob's exit sits between pro-rata and curve", sb["prorata"] < sb["raw"] < sb["curve"])
    # death
    c.touch(D(1000))
    al, _ = c.claim_preview("alice")
    ca, _ = c.claim_preview("carol")
    cr, hc = c.claim_preview("creator")
    kv("death: snapshot pool / supply", f"{f6(c.snapR)} / {f6(c.snapS)}")
    kv("Alice claims (paid 20)", f6(al))
    kv("Carol claims (paid 50)", f6(ca))
    kv("Creator claims (seeded 100; 50% haircut)", f"{f6(cr)}  (haircut to protocol {f6(hc)})")
    kv("Creator fees accrued", f6(c.creator_fees))
    kv("Creator net", f6(cr + c.creator_fees - 100))
    check("claims + haircut == snapshot pool", abs(al + ca + cr + hc - c.snapR) < D("1e-30"))
    check("creator loses money when the coin dies this fast", cr + c.creator_fees < 100)
    # rescue alternative
    f = twilight_factor(D(8), P["twilight"])
    kv("rescue option: Dave buys 10 at 8 s left", f"factor {f6(f, 3)} -> +{f6(10 * 2 * f, 2)} s")


def main():
    out("life-coin sim.py v2 — prototype math verification (Decimal prec 80; integer model for rounding)")
    sec_identities()
    sec_canonical()
    sec_exit_rule()
    sec_ramp()
    sec_feed_dump()
    sec_creator()
    sec_snipe()
    sec_timer()
    sec_integer()
    sec_property()
    sec_demo()
    header("All assertions passed.")


if __name__ == "__main__":
    main()
