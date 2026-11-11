"use client";

import type { PetMood } from "@/lib/format";
import { useId } from "react";

const LABEL: Record<PetMood, string> = {
  happy: "A happy pet in a full bowl",
  hungry: "A hungry pet in a half-full bowl",
  starving: "A starving pet in a nearly empty bowl",
  dead: "A ghost pet above an empty bowl",
};

export function BowlMark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="10" fill="#00EC97" />
      <path d="M7 15.5h18c.3 5.2-2.6 8.5-9 8.5s-9.3-3.3-9-8.5z" fill="#101418" />
      <path d="M9.2 16.2h13.6c.2 2.6-1.8 4.2-6.8 4.2s-7-1.6-6.8-4.2z" fill="#E7FFF6" />
      <circle cx="16" cy="12.2" r="2.7" fill="#101418" />
    </svg>
  );
}

export function Pet({ mood, pulse = false, size = "md" }: { mood: PetMood; pulse?: boolean; size?: "sm" | "md" | "lg" }) {
  const clipId = `bowl${useId().replace(/:/g, "")}`;
  const dead = mood === "dead";
  const motion = dead ? "is-ghost" : mood === "starving" ? "is-starving" : "is-alive";
  const liquid =
    mood === "happy" ? { y: 118, height: 42, fill: "#00EC97" } : mood === "hungry" ? { y: 136, height: 24, fill: "#8FF0CC" } : mood === "starving" ? { y: 150, height: 10, fill: "#D5F8EA" } : null;

  return (
    <div className={`pet-wrap pet-${size} ${motion}`}>
      <div className={pulse && !dead ? "pet-pop" : undefined}>
        <svg viewBox="0 0 200 176" role="img" aria-label={LABEL[mood]}>
          <ellipse cx="100" cy="164" rx="58" ry="7" fill="#101418" opacity="0.12" />
          <path d="M48 116h104c2 26-16 40-52 40s-54-14-52-40z" fill="#1B242B" stroke="#101418" strokeWidth="3" />
          <clipPath id={clipId}>
            <path d="M52 118h96c1.6 22-14 34-48 34s-49.6-12-48-34z" />
          </clipPath>
          {liquid ? (
            <g clipPath={`url(#${clipId})`}>
              <rect x="40" y={liquid.y} width="120" height={liquid.height} fill={liquid.fill} />
              {mood === "happy" ? <rect x="68" y="126" width="34" height="6" rx="3" fill="#F4FFFB" opacity="0.85" /> : null}
            </g>
          ) : null}
          <rect x="36" y="106" width="128" height="16" rx="8" fill="#101418" />
          <rect x="46" y="110" width="108" height="5" rx="2.5" fill="#3C4C56" />
          {dead ? (
            <g>
              <path
                d="M58 124c0-34 18-56 42-56s42 22 42 56v16c-7-9-14-9-21 0s-14 9-21 0-14-9-21 0-14 9-21 0z"
                fill="#F6F3FF"
                stroke="#B7A6F2"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <circle cx="86" cy="92" r="5" fill="#101418" />
              <circle cx="114" cy="92" r="5" fill="#101418" />
              <circle cx="88" cy="90" r="1.7" fill="#fff" />
              <circle cx="116" cy="90" r="1.7" fill="#fff" />
              <ellipse cx="100" cy="110" rx="7" ry="8" fill="#D9CCFF" />
            </g>
          ) : (
            <g transform={mood === "starving" ? "translate(0 4)" : undefined}>
              <g transform={mood === "starving" ? "rotate(-16 64 58)" : undefined}>
                <ellipse cx="64" cy="50" rx="14" ry="18" fill="#B8F6DE" stroke="#101418" strokeWidth="3" />
                <ellipse cx="64" cy="52" rx="7" ry="10" fill="#F4FFFB" />
              </g>
              <g transform={mood === "starving" ? "rotate(16 136 58)" : undefined}>
                <ellipse cx="136" cy="50" rx="14" ry="18" fill="#B8F6DE" stroke="#101418" strokeWidth="3" />
                <ellipse cx="136" cy="52" rx="7" ry="10" fill="#F4FFFB" />
              </g>
              <ellipse cx="100" cy="74" rx="40" ry="34" fill="#E9FFF7" stroke="#101418" strokeWidth="3" />
              <ellipse cx="72" cy="84" rx="7" ry="4" fill="#C9B6FF" opacity={mood === "starving" ? 0.25 : mood === "hungry" ? 0.55 : 0.9} />
              <ellipse cx="128" cy="84" rx="7" ry="4" fill="#C9B6FF" opacity={mood === "starving" ? 0.25 : mood === "hungry" ? 0.55 : 0.9} />
              {mood === "starving" ? (
                <g>
                  <path d="M72 60l12 5" fill="none" stroke="#101418" strokeWidth="2.4" strokeLinecap="round" />
                  <path d="M128 60l-12 5" fill="none" stroke="#101418" strokeWidth="2.4" strokeLinecap="round" />
                </g>
              ) : null}
              <circle cx="84" cy="72" r={mood === "starving" ? 5.2 : 4.4} fill="#101418" />
              <circle cx="116" cy="72" r={mood === "starving" ? 5.2 : 4.4} fill="#101418" />
              <circle cx="85.6" cy="70.2" r="1.5" fill="#fff" />
              <circle cx="117.6" cy="70.2" r="1.5" fill="#fff" />
              {mood === "happy" ? (
                <path d="M86 86c4 8 24 8 28 0" fill="none" stroke="#101418" strokeWidth="3" strokeLinecap="round" />
              ) : mood === "hungry" ? (
                <path d="M88 90h24" fill="none" stroke="#101418" strokeWidth="3" strokeLinecap="round" />
              ) : (
                <path d="M86 94c5-6 23-6 28 0" fill="none" stroke="#101418" strokeWidth="3" strokeLinecap="round" />
              )}
              {mood === "starving" ? <path d="M138 66c4 6 2 12-2 14 4-2 8-2 8-8 0-4-2-6-6-6z" fill="#7EB6FF" /> : null}
              {pulse ? <circle className="kibble" cx="146" cy="78" r="6" fill="#00EC97" stroke="#101418" strokeWidth="2" /> : null}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
