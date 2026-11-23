#!/usr/bin/env node
// Listens to the real-time messages of a Hydraloop device for as long as it
// runs, and reports messages that deviate from spec/socket/asyncapi.json as
// GitHub issues (see scripts/socket-drift.js).
//
// Run with, e.g. all day on a Mac that shouldn't go to sleep:
//
//   caffeinate -i node --env-file=.env scripts/listen-socket.js [--heartbeat]
//
// Every message is appended to logs/socket.json as a JSON line.
//
// Environment variables:
//
// - HYDRALOOP_USERNAME, HYDRALOOP_PASSWORD, HYDRALOOP_TOTP_SECRET: the
//   username, password and base32 one-time password secret of the HDM
//   account. Used to sign in when all three are set.
// - HYDRALOOP_OP_ITEM: otherwise, the 1Password item with the username,
//   password and one-time password of the HDM account, read with the
//   1Password CLI (`op`). Default: "Hydraloop HDM".
//
//   Signing in is only needed at the start and when the token can't be
//   refreshed, e.g. after the computer slept for more than 30 minutes.
// - HYDRALOOP_TOKEN: a token to start with instead of signing in, unless it
//   expired
// - HYDRALOOP_DEVICE_ID: the device, default: the first H600 of the account
// - DRIFT_GITHUB_TOKEN: a fine-grained token that can write the issues of the
//   repository. Without it, deviations are only printed.
// - DRIFT_GITHUB_REPOSITORY: default "gr2m/hydraloop.js"
//
// Options:
//
// - --heartbeat: keep the live graph active with
//   `local.graph.setActiveHeartBeat()` every 90 seconds, as the HDM web app
//   does while it shows the graph. Without it, `graph:graph` only arrives
//   while someone has the graph open in the HDM web app.

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { Hydraloop, RequestError } from "hydraloop-internal";
import { checkMessage, reportDrift, ROOMS } from "./socket-drift.js";

const { values: options } = parseArgs({
  options: {
    heartbeat: { type: "boolean", default: false },
  },
});

const LOG_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "logs",
  "socket.json",
);
const OP_ITEM = process.env.HYDRALOOP_OP_ITEM ?? "Hydraloop HDM";
const GITHUB_TOKEN = process.env.DRIFT_GITHUB_TOKEN;
/** HDM tokens expire after 30 minutes */
const REFRESH_INTERVAL = 5 * 60_000;
const HEARTBEAT_INTERVAL = 90_000;
const SUMMARY_INTERVAL = 60 * 60_000;

/** @param {...unknown} args */
const log = (...args) => console.log(new Date().toISOString(), ...args);

// The SDK keeps the token it was created with, so a new client is created
// for every new token
let token = validToken(process.env.HYDRALOOP_TOKEN) ?? (await signIn());
let client = new Hydraloop({ token });

/**
 * The token, unless it expires within a minute
 *
 * @param {string | undefined} token
 */
function validToken(token) {
  try {
    const { exp } = JSON.parse(
      Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"),
    );
    return exp * 1000 - Date.now() > 60_000 ? token : undefined;
  } catch {
    return undefined;
  }
}

async function signIn() {
  const { HYDRALOOP_USERNAME, HYDRALOOP_PASSWORD, HYDRALOOP_TOTP_SECRET } =
    process.env;
  if (HYDRALOOP_USERNAME && HYDRALOOP_PASSWORD && HYDRALOOP_TOTP_SECRET) {
    log(
      "Signing in with HYDRALOOP_USERNAME, HYDRALOOP_PASSWORD and HYDRALOOP_TOTP_SECRET",
    );
    const auth = await new Hydraloop().login({
      username: HYDRALOOP_USERNAME,
      password: HYDRALOOP_PASSWORD,
      totpCode: async () => totp(HYDRALOOP_TOTP_SECRET),
    });
    return auth.token;
  }

  log(`Signing in with the 1Password item "${OP_ITEM}"`);
  const fields = JSON.parse(
    op(
      "item",
      "get",
      OP_ITEM,
      "--fields",
      "username,password",
      "--reveal",
      "--format",
      "json",
    ),
  );
  /** @param {string} id */
  const field = (id) =>
    fields.find((/** @type {{ id: string }} */ f) => f.id === id).value;
  const auth = await new Hydraloop().login({
    username: field("username"),
    password: field("password"),
    totpCode: async () => op("item", "get", OP_ITEM, "--otp"),
  });
  return auth.token;
}

/**
 * The current one-time password (RFC 6238: SHA-1, 6 digits, 30 seconds)
 *
 * @param {string} secret base32 encoded
 */
function totp(secret) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/[\s=]/g, "")]
    .map((char) => {
      const index = ALPHABET.indexOf(char);
      if (index === -1) throw new Error("HYDRALOOP_TOTP_SECRET is not base32");
      return index.toString(2).padStart(5, "0");
    })
    .join("");
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** @param {string[]} args */
function op(...args) {
  return execFileSync("op", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

/** Refreshes the token, or signs in again if it expired */
async function renewToken() {
  try {
    token = (await client.root.auth.refreshToken()).token;
  } catch (error) {
    if (!(error instanceof RequestError && error.response.status === 401)) {
      throw error;
    }
    token = await signIn();
  }
  client = new Hydraloop({ token });
}

const deviceId =
  process.env.HYDRALOOP_DEVICE_ID ?? (await findDevice(client)).id;

/** @param {Hydraloop} hydraloop */
async function findDevice(hydraloop) {
  const { records = [] } = await hydraloop.root.devices.listDevices({
    event: { first: 0, rows: 50 },
  });
  if (records.length === 0) throw new Error("No devices in this account");
  return (
    records.find((d) => /600/.test(`${d.type} ${d.subType}`)) ?? records[0]
  );
}

/** @type {Map<string, number>} */
const counts = new Map();
/** @type {Set<string>} */
const reported = new Set();

setInterval(() => {
  renewToken().catch((error) => log("Renewing the token failed:", error));
}, REFRESH_INTERVAL);

if (options.heartbeat) {
  const heartbeat = () =>
    client.local.graph
      .setActiveHeartBeat({ body: { deviceId } })
      .catch((error) => log("Heartbeat failed:", error.message));
  heartbeat();
  setInterval(heartbeat, HEARTBEAT_INTERVAL);
}

setInterval(() => {
  const summary = [...counts].map(([name, n]) => `${name} ${n}`).join(", ");
  log(`Messages in the last hour: ${summary || "none"}`);
  counts.clear();
}, SUMMARY_INTERVAL);

mkdirSync(dirname(LOG_FILE), { recursive: true });

log(
  `Listening to device ${deviceId}, rooms: ${ROOMS.join(", ")}`,
  GITHUB_TOKEN ? "" : "(DRIFT_GITHUB_TOKEN is not set, drift is only printed)",
);

// A subscription reconnects by itself, but ends when its token can no longer
// get a device token. Then it's started again with a new one.
while (true) {
  const subscription = client.local.subscribe({
    deviceId,
    rooms: ROOMS,
    onConnect: () => log("Connected"),
    onDisconnect: (reason) => log(`Disconnected: ${reason}`),
  });
  try {
    for await (const { name, payload } of subscription) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const at = new Date().toISOString();
      appendFileSync(LOG_FILE, `${JSON.stringify({ at, name, payload })}\n`);
      const drift = checkMessage(name, payload);
      if (drift && !reported.has(drift.hash)) await report(drift, payload);
    }
  } catch (error) {
    log("Subscription ended:", /** @type {Error} */ (error).message);
    await renewToken().catch((error) => log("Signing in failed:", error));
  }
  await sleep(5000);
}

/**
 * @param {import("./socket-drift.js").Drift} drift
 * @param {unknown} payload
 */
async function report(drift, payload) {
  reported.add(drift.hash);
  log(`${drift.kind}: ${drift.name} (${drift.hash})`, drift.errors);
  if (!GITHUB_TOKEN) return;
  try {
    const url = await reportDrift(GITHUB_TOKEN, drift, payload);
    log(url ? `Reported as ${url}` : "Reported before");
  } catch (error) {
    // Try again with the next message
    reported.delete(drift.hash);
    log("Reporting failed:", error);
  }
}
