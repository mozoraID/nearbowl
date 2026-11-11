export default function Loading() {
  return (
    <div className="page page-pad" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-hero" />
      <div className="skeleton-row">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    </div>
  );
}
