"use client";

import { config } from "@/lib/config";
import { accountUrl } from "@/lib/explorer";
import { getConfig } from "@/lib/factory";
import { extensionPerUsdc, formatDuration } from "@/lib/format";
import type { ParamsView } from "@/lib/types";
import { useEffect, useState } from "react";

function ns(value: string): string {
  try {
    return formatDuration(BigInt(value));
  } catch {
    return value;
  }
}

export function FactoryStatus() {
  const [params, setParams] = useState<ParamsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () => {
      getConfig()
        .then((row) => {
          if (stop) return;
          setParams(row.params);
          setFailed(false);
        })
        .catch(() => {
          if (!stop) setFailed(true);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const controls = params ? (params.allow_demo_controls ? "on" : "off") : null;

  return (
    <div className="factory-status">
      <p className="footer-kicker">This factory</p>
      <dl>
        <div>
          <dt>Factory</dt>
          <dd>
            <a href={accountUrl(config.factoryAccountId)} target="_blank" rel="noreferrer">
              {config.factoryAccountId}
            </a>
          </dd>
        </div>
        <div>
          <dt>Initial life</dt>
          <dd>{params ? ns(params.initial_life_ns) : failed ? "view unavailable" : "…"}</dd>
        </div>
        <div>
          <dt>Life cap</dt>
          <dd>{params ? `${ns(params.max_life_min_ns)} – ${ns(params.max_life_max_ns)}` : failed ? "view unavailable" : "…"}</dd>
        </div>
        <div>
          <dt>Life per USDC</dt>
          <dd>{params ? extensionPerUsdc(params.ext_ns_per_raw_usdc) : failed ? "view unavailable" : "…"}</dd>
        </div>
        <div>
          <dt>Timer controls</dt>
          <dd className={controls === "off" ? "timer-off" : controls === "on" ? "timer-on" : undefined}>
            {controls ?? (failed ? "waiting for the factory view" : "…")}
          </dd>
        </div>
      </dl>
    </div>
  );
}
