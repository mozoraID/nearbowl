"use client";

export type ReviewLine = { k: string; v: string };

export function ReviewCard({
  title,
  lines,
  confirmLabel,
  pending,
  onConfirm,
  onBack,
}: {
  title: string;
  lines: ReviewLine[];
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="review" role="region" aria-label={title}>
      <h3>{title}</h3>
      <p className="hint">Check the numbers, then confirm. The wallet opens after that.</p>
      <dl>
        {lines.map((line) => (
          <div key={line.k}>
            <dt>{line.k}</dt>
            <dd>{line.v}</dd>
          </div>
        ))}
      </dl>
      <div className="review-actions">
        <button type="button" className="solid" disabled={pending} onClick={onConfirm}>
          {pending ? "Sending…" : confirmLabel}
        </button>
        <button type="button" className="ghost" disabled={pending} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
