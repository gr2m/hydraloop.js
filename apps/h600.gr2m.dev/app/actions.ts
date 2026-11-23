"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { login } from "@/lib/hdm";
import { DEMO_COOKIE, TOKEN_COOKIE, tokenCookieOptions } from "@/lib/token";

export type LoginState = { error?: string };

export async function signIn(
  _: LoginState,
  form: FormData,
): Promise<LoginState> {
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const totpCode =
    String(form.get("totpCode") ?? "").replace(/\s/g, "") || undefined;

  let token: string;
  let expiresIn: number;
  try {
    ({ token, expiresIn } = await login({ username, password, totpCode }));
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response
      ?.status;
    return {
      error:
        status === 401 || status === 400
          ? "Sign in failed. Check your username, password and one-time code."
          : `Sign in failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const store = await cookies();
  store.delete(DEMO_COOKIE);
  store.set(TOKEN_COOKIE, token, tokenCookieOptions(token, expiresIn));
  redirect("/");
}

export async function startDemo() {
  const store = await cookies();
  store.set(DEMO_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function signOut() {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  store.delete(DEMO_COOKIE);
  redirect("/login");
}
