import { extensionPerUsdc, formatDuration, formatUsdc } from "@/lib/format";
import { RESERVED_TICKERS } from "@/lib/reserved";
import type { ParamsView } from "@/lib/types";

const STEPS = [
  {
    title: "Launch",
    body: "Send USDC into the factory and name the coin. The full seed becomes the pool. There is no launch fee. The timer starts immediately.",
  },
  {
    title: "Feed by buying",
    body: "A buy of at least 1 USDC mints tokens on the curve and adds time, up to a cap that grows with the pool. Smaller buys can still mint, but they do not feed the timer.",
  },
  {
    title: "Hunger makes selling pay less",
    body: "As time runs out, a seller payout slides from the curve price toward a plain pro-rata share of the bowl. It never pays more than the curve, and never less than pro-rata.",
  },
  {
    title: "Death splits the bowl",
    body: "When the timer hits zero, trading stops. Every holder burns tokens for a pro-rata share of what is left. That is not a refund of what they paid.",
  },
];

const FAQ = [
  {
    q: "Is tUSDC a real dollar?",
    a: "No. On testnet these coins are play money. tUSDC is a mock token with 6 decimals and a public faucet. A dead coin pays a share of what is left, not a refund.",
  },
  {
    q: "What do I get if it dies?",
    a: "A pro-rata share of the reserve snapshot. Late buyers can get back less than they put in. The creator seed is claim-only and that claim is cut in half.",
  },
  {
    q: "Why is the alive list empty?",
    a: "A coin leaves the alive list when its timer hits zero. The starting life is read from this factory and shown on the empty state. Launch one, or open a ghost and read how it ended.",
  },
  {
    q: "How do I get started?",
    a: "Open Get started, connect a testnet wallet, take 100 tUSDC from the faucet (once a minute), then launch a coin or buy at least 1 tUSDC of one that is still alive.",
  },
  {
    q: "Can the creator sell the seed?",
    a: "No. Seed tokens are claim-only. At death the creator keeps half of the seed share and the protocol keeps the other half. Ignoring fees, the creator breaks even only if the pool is about 4× the seed, because 1 / (1 − 0.5)² = 4.",
  },
  {
    q: "Will the coin show up in my wallet?",
    a: "No. Coins live in the factory ledger. Three read-only views use NEP-245-shaped names so other tools can read balances. There is no transfer method.",
  },
  {
    q: "What does hunger change?",
    a: "Hunger weight starts at the curve and moves toward pro-rata as time runs down, rounded up to the next 1/64 in favor of the pool. Feeding back to full does not instantly restore curve exits. A scar falls by at most one step per recovery interval.",
  },
  {
    q: "Which tickers are reserved?",
    a: `Symbols are 3–10 letters or numbers, anything starting with USD is blocked, and these names are reserved: ${RESERVED_TICKERS.join(", ")}. A symbol is never reused, even after the coin dies.`,
  },
];

function ns(value: string): string {
  try {
    return formatDuration(BigInt(value));
  } catch {
    return value;
  }
}

export function Guide({ params }: { params: ParamsView | null }) {
  const life = params ? ns(params.initial_life_ns) : null;
  const capMin = params ? ns(params.max_life_min_ns) : null;
  const capMax = params ? ns(params.max_life_max_ns) : null;
  return (
    <>
      <section id="how" className="section">
        <div className="section-head">
          <h2>How it works</h2>
          <p>One factory holds every coin. People trade against a curve quoted only in USDC. Nobody withdraws the pool except through these rules.</p>
        </div>
        <ol className="how-grid">
          {STEPS.map((step, index) => (
            <li key={step.title} className="card step">
              <span className="step-index">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="hint section-note">
          {life && capMin && capMax
            ? `This factory starts each coin with ${life} of life, capped between ${capMin} and ${capMax}.`
            : "Starting life and the life cap are read from this factory."}
        </p>
      </section>

      <section id="rules" className="section">
        <div className="section-head">
          <h2>Rules that keep it fair</h2>
          <p>The figures in the cards are the published configuration. The panel under them is read from this factory, so a trade follows the chain if the two ever differ.</p>
        </div>
        <div className="rules-grid">
          <article className="card rule">
            <h3>1% fee, three ways</h3>
            <p>Every buy and sell pays a 1% fee. 0.50% stays in the bowl and mints nothing, 0.30% is the protocol fee, and 0.20% is the creator fee. 50 / 30 / 20 basis points inside 100.</p>
          </article>
          <article className="card rule">
            <h3>One wallet cannot babysit</h3>
            <p>
              Each account has a leaky bucket. Recent raw seconds leak at 0.25 per second. The next seconds count at 100% for the first tier, 50% for the second, and 0% after that.
              {params ? ` On this factory the tiers are ${ns(params.tier1_ns)}, then ${ns(params.tier2_ns)}.` : ""}
              {" "}
              One account cannot keep a coin alive by itself.
            </p>
          </article>
          <article className="card rule">
            <h3>Creator seed is claim-only</h3>
            <p>The creator cannot sell the seed. At death that claim is cut in half (5,000 bps) and the other half goes to the protocol. Holders who bought on the curve claim their share without that haircut.</p>
          </article>
          <article className="card rule">
            <h3>Reserved tickers</h3>
            <p>3–10 letters or numbers. Anything starting with USD is rejected, plus {RESERVED_TICKERS.join(", ")}. Taken symbols stay taken after death. The minimum seed on the public testnet factory is 1 USDC. Launch storage is 0.06 NEAR.</p>
          </article>
        </div>
        <div className="card factory-facts">
          <h3>Read from this factory</h3>
          {params ? (
            <dl>
              <div>
                <dt>Initial life</dt>
                <dd>{ns(params.initial_life_ns)}</dd>
              </div>
              <div>
                <dt>Hunger reference</dt>
                <dd>{ns(params.t_ref_ns)}</dd>
              </div>
              <div>
                <dt>Life cap</dt>
                <dd>
                  {ns(params.max_life_min_ns)} – {ns(params.max_life_max_ns)}
                </dd>
              </div>
              <div>
                <dt>Twilight</dt>
                <dd>{ns(params.twilight_ns)}</dd>
              </div>
              <div>
                <dt>Extension</dt>
                <dd>{extensionPerUsdc(params.ext_ns_per_raw_usdc)} per USDC</dd>
              </div>
              <div>
                <dt>Scar step</dt>
                <dd>{ns(params.scar_step_ns)}</dd>
              </div>
              <div>
                <dt>Feeding tiers</dt>
                <dd>
                  {ns(params.tier1_ns)}, then {ns(params.tier2_ns)}
                </dd>
              </div>
              <div>
                <dt>Leak</dt>
                <dd>{params.leak_bps} bps</dd>
              </div>
              <div>
                <dt>Min seed</dt>
                <dd>{formatUsdc(params.min_seed_usdc)} USDC</dd>
              </div>
              <div>
                <dt>Min buy that feeds</dt>
                <dd>{formatUsdc(params.min_trade_usdc)} USDC</dd>
              </div>
              <div>
                <dt>Fee split</dt>
                <dd>
                  {params.fee_bps} bps · {params.inherit_bps} / {params.protocol_bps} / {params.creator_bps}
                </dd>
              </div>
              <div>
                <dt>Creator haircut</dt>
                <dd>{params.creator_haircut_bps} bps</dd>
              </div>
            </dl>
          ) : (
            <p className="hint">Factory parameters are not available yet. Timer lengths show up here once the factory view loads. The fee in the cards is the published 1% split, 0.50% / 0.30% / 0.20%.</p>
          )}
        </div>
      </section>

      <section id="faq" className="section">
        <div className="section-head">
          <h2>Questions</h2>
        </div>
        <div className="faq">
          {FAQ.map((item) => (
            <details key={item.q} className="card">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
