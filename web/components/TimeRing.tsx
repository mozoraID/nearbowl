import { formatDuration, lifeRatio } from "@/lib/format";

export function TimeRing({ remaining, cap, dead = false }: { remaining: bigint; cap: bigint; dead?: boolean }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const ratio = dead ? 0 : lifeRatio(remaining, cap);
  const offset = circumference * (1 - ratio);
  const urgent = !dead && ratio > 0 && ratio < 0.2;
  const label = dead ? "Timer finished" : `${formatDuration(remaining)} of ${formatDuration(cap)} left`;
  return (
    <svg className={`time-ring${urgent ? " is-urgent" : ""}${dead ? " is-dead" : ""}`} viewBox="0 0 44 44" role="img" aria-label={label}>
      <circle className="ring-track" cx="22" cy="22" r={radius} />
      <circle
        className="ring-value"
        cx="22"
        cy="22"
        r={radius}
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset}
        transform="rotate(-90 22 22)"
      />
    </svg>
  );
}
