import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page page-pad">
      <div className="card empty-hero">
        <div>
          <h1>That page is not here</h1>
          <p>The link may be old, or the coin id may be wrong.</p>
          <Link className="solid" href="/">
            Back to the bowl
          </Link>
        </div>
      </div>
    </div>
  );
}
