type Mood = "fed" | "hungry" | "dead";

export function Pet({ mood, pulse = false }: { mood: Mood; pulse?: boolean }) {
  const fed = mood === "fed";
  const dead = mood === "dead";
  const className = `pet ${dead ? "" : "bob"} ${pulse ? "fed-pulse" : ""}`;
  if (dead) {
    return (
      <svg className="pet" viewBox="0 0 160 140" role="img" aria-label="A small tombstone">
        <ellipse cx="80" cy="122" rx="46" ry="8" fill="#ead9c6" />
        <path d="M48 118 V78 a32 32 0 0 1 64 0 V118 Z" fill="#f7f1ea" stroke="#d9c6b2" />
        <text x="80" y="96" textAnchor="middle" fontSize="28" fill="#8d6b58" fontFamily="serif">†</text>
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 160 140" role="img" aria-label={fed ? "A fed pet" : "A hungry pet"}>
      <ellipse cx="80" cy="124" rx="50" ry="8" fill="#f0e0cf" />
      <path d="M28 96 h104 a18 18 0 0 1 -18 22 H46 a18 18 0 0 1 -18 -22 Z" fill="#f4d7b0" stroke="#e2b98a" />
      <path d="M36 96 h88 v8 H36 Z" fill={fed ? "#f6d56a" : "#f3b183"} />
      {pulse && <circle className="kibble" cx="108" cy="78" r="6" fill="#c45c32" />}
      <g transform={fed ? "translate(0,0)" : "translate(0,4)"}>
        <ellipse cx="80" cy="62" rx="38" ry="32" fill="#f7c9a5" />
        <ellipse cx="52" cy="40" rx="10" ry="14" fill="#f7c9a5" />
        <ellipse cx="108" cy="40" rx="10" ry="14" fill="#f7c9a5" />
        <circle cx="66" cy="60" r="4" fill="#2c241b" />
        <circle cx="94" cy="60" r="4" fill="#2c241b" />
        {fed ? (
          <path d="M70 74 q10 10 20 0" fill="none" stroke="#2c241b" strokeWidth="3" strokeLinecap="round" />
        ) : (
          <path d="M70 80 q10 -8 20 0" fill="none" stroke="#2c241b" strokeWidth="3" strokeLinecap="round" />
        )}
        <ellipse cx="58" cy="70" rx="6" ry="3" fill="#f0a0a4" opacity="0.8" />
        <ellipse cx="102" cy="70" rx="6" ry="3" fill="#f0a0a4" opacity="0.8" />
      </g>
    </svg>
  );
}
