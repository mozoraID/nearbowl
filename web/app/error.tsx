"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page page-pad">
      <div className="card error-card" role="alert">
        <h1>Something went wrong</h1>
        <p>{error.message || "The page hit an unexpected error."}</p>
        <button type="button" className="solid" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
