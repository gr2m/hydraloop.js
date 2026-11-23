import type { Metadata } from "next";
import { Suspense } from "react";

import { startDemo } from "../actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · H600" };

export default function LoginPage() {
  return (
    <main id="main" className="page login">
      <div className="login-intro">
        <h1>See what your H600 is doing</h1>
        <p className="lede">
          Sign in with your Hydraloop Device Manager (HDM) account. The
          dashboard reads tank levels, valves, pumps and routines from the
          internal HDM API. It never changes settings on the device.
        </p>
        <p className="muted">
          The token is kept in an httpOnly cookie on this server and never
          reaches browser JavaScript. Hydraloop does not intend the internal API
          for external use, so it may change without notice.
        </p>
      </div>
      <div className="login-forms">
        <Suspense>
          <LoginForm />
        </Suspense>
        <form action={startDemo} className="login-demo">
          <p className="muted">No HDM account at hand?</p>
          <button type="submit" className="button is-quiet">
            Explore with simulated data
          </button>
        </form>
      </div>
    </main>
  );
}
