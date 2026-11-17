"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="page">
      <div className="page-title">
        <h1>The H600 data could not be loaded</h1>
        <p className="muted">{error.message}</p>
      </div>
      <p>
        <button type="button" className="button" onClick={reset}>
          Try again
        </button>{" "}
        <a href="/login">Sign in again</a>
      </p>
    </main>
  );
}
