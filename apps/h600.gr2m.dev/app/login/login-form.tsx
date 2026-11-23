"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";

import { signIn, type LoginState } from "../actions";

export function LoginForm() {
  const expired = useSearchParams().has("expired");
  const [state, action, pending] = useActionState<LoginState, FormData>(
    signIn,
    {},
  );
  return (
    <form action={action} className="form">
      {expired && !state.error && (
        <p className="notice">Your session expired. Please sign in again.</p>
      )}
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="email"
          autoComplete="username"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="totpCode">One-time code</label>
        <input
          id="totpCode"
          name="totpCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,8}"
          placeholder="Only for two-factor accounts"
        />
      </div>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="button" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
