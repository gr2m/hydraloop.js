#!/usr/bin/env node
// Shows the current tank levels of your first device using the INTERNAL
// HDM API (the one the HDM web app uses), which is not meant for external
// use and may change at any time. See readme.md in this folder.
//
// Credentials are read from HYDRALOOP_USERNAME, HYDRALOOP_PASSWORD and
// HYDRALOOP_TOTP_SECRET (the base32 one-time password secret) when all three
// are set. Otherwise they are read (incl. the one-time password) from the
// 1Password item "Hydraloop HDM" via the `op` CLI (override the item with
// HYDRALOOP_OP_ITEM). Without `op`, it prompts for them instead.
// Run with: node --env-file=.env examples/internal/tank-levels.js

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createInterface } from "node:readline";

const ROOT_API_URL = "https://hdm.hydraloop.com/api-root";

/**
 * @param {import("node:readline").Interface} rl
 * @param {string} question
 * @returns {Promise<string>}
 */
function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

/**
 * @param {string} question
 * @returns {Promise<string>}
 */
function promptSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let input = "";
    process.stdin.on("data", function onData(char) {
      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
      } else if (char === "\u0003") {
        // Ctrl+C
        process.exit(1);
      } else if (char === "\u007f") {
        // Backspace
        if (input.length > 0) input = input.slice(0, -1);
      } else {
        input += char;
      }
    });
  });
}

// ── Credentials ────────────────────────────────────────────────────────────

const OP_ITEM = process.env.HYDRALOOP_OP_ITEM || "Hydraloop HDM";

/**
 * @param {...string} args
 * @returns {string | null}
 */
function op(...args) {
  try {
    return execFileSync("op", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The current one-time password (RFC 6238: SHA-1, 6 digits, 30 seconds)
 *
 * @param {string} secret base32 encoded
 * @returns {string}
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

const { HYDRALOOP_USERNAME, HYDRALOOP_PASSWORD, HYDRALOOP_TOTP_SECRET } =
  process.env;

let username, password, getTotpCode;
const opCredentials =
  HYDRALOOP_USERNAME && HYDRALOOP_PASSWORD && HYDRALOOP_TOTP_SECRET
    ? null
    : op(
        "item",
        "get",
        OP_ITEM,
        "--fields",
        "username,password",
        "--reveal",
        "--format",
        "json",
      );
if (HYDRALOOP_USERNAME && HYDRALOOP_PASSWORD && HYDRALOOP_TOTP_SECRET) {
  username = HYDRALOOP_USERNAME;
  password = HYDRALOOP_PASSWORD;
  // Created only when needed, so the code is fresh when it is sent.
  getTotpCode = async () => totp(HYDRALOOP_TOTP_SECRET);
  console.log(
    "Using credentials from HYDRALOOP_USERNAME, HYDRALOOP_PASSWORD and HYDRALOOP_TOTP_SECRET\n",
  );
} else if (opCredentials) {
  /** @type {{ id: string, value: string }[]} */
  const fields = JSON.parse(opCredentials);
  username = fields.find((f) => f.id === "username")?.value;
  password = fields.find((f) => f.id === "password")?.value;
  // Fetched only when needed, so the code is fresh when it is sent.
  getTotpCode = async () => op("item", "get", OP_ITEM, "--otp");
  console.log(`Using credentials from 1Password item "${OP_ITEM}"\n`);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  username = await prompt(rl, "Username: ");
  rl.close();
  password = await promptSecret("Password: ");
  getTotpCode = () => promptSecret("2FA code: ");
  console.log();
}

// ── Step 1: Login ──────────────────────────────────────────────────────────

process.stdout.write("Logging in... ");
const loginRes = await fetch(`${ROOT_API_URL}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
if (!loginRes.ok) {
  console.error(`FAILED (${loginRes.status}): ${await loginRes.text()}`);
  process.exit(1);
}
const login = await loginRes.json();
let token = login.token;
console.log("ok");

// ── Step 2: 2FA ────────────────────────────────────────────────────────────

// The login token is not fully logged in while 2FA is pending. The 2FA call
// returns a new token (same shape as the login response) that replaces it.
if (!login.user?.fullyLoggedIn) {
  const totpCode = await getTotpCode();
  process.stdout.write("Authenticating 2FA... ");
  const totpRes = await fetch(
    `${ROOT_API_URL}/two-factor-authentication/authenticate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ totpCode, rememberDevice: false }),
    },
  );
  if (!totpRes.ok) {
    console.error(`FAILED (${totpRes.status}): ${await totpRes.text()}`);
    process.exit(1);
  }
  token = (await totpRes.json()).token;
  console.log("ok");
}

// ── Step 3: Get device ─────────────────────────────────────────────────────

process.stdout.write("Fetching device... ");
const listRes = await fetch(
  `${ROOT_API_URL}/devices/list?event=${encodeURIComponent(JSON.stringify({ rows: 1 }))}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!listRes.ok) {
  console.error(`FAILED (${listRes.status}): ${await listRes.text()}`);
  process.exit(1);
}
const { records } = await listRes.json();
if (!records.length) {
  console.error("No devices found.");
  process.exit(1);
}
const device = records[0];
console.log(`ok  (${device.deviceName})`);

// ── Step 4: Get device-scoped token ────────────────────────────────────────

process.stdout.write("Getting device token... ");
const devTokenRes = await fetch(
  `${ROOT_API_URL}/auth/token-for-device?deviceId=${device.id}`,
  { method: "POST", headers: { Authorization: `Bearer ${token}` } },
);
if (!devTokenRes.ok) {
  console.error(`FAILED (${devTokenRes.status}): ${await devTokenRes.text()}`);
  process.exit(1);
}
const { token: deviceToken } = await devTokenRes.json();
console.log("ok");

// Local API calls require both the user JWT and the device-scoped token
const localHeaders = {
  Authorization: `Bearer ${token}`,
  "Additional-Authorization": deviceToken,
};

// ── Step 5: Fetch graph data and device levels ─────────────────────────────

process.stdout.write("Fetching tank data... ");
const now = new Date();
const from = new Date(now.getTime() - 5 * 60 * 1000); // last 5 minutes is enough for current reading
const graphParams = new URLSearchParams({
  deviceId: device.id,
  from: from.toISOString(),
  until: now.toISOString(),
  minutesInView: "5",
  debugData: "false",
});

const [graphRes, levelsRes] = await Promise.all([
  fetch(`${device.localApiUrl}/graph/data?${graphParams}`, {
    headers: localHeaders,
  }),
  fetch(`${device.localApiUrl}/graph/device-levels?deviceId=${device.id}`, {
    headers: localHeaders,
  }),
]);
if (!graphRes.ok) {
  console.error(
    `graph/data FAILED (${graphRes.status}): ${await graphRes.text()}`,
  );
  process.exit(1);
}
const graphData = await graphRes.json();
const levels = levelsRes.ok ? await levelsRes.json() : null;
console.log("ok\n");

// ── Helpers ────────────────────────────────────────────────────────────────

/** @typedef {{ p: number, l: number }[]} LevelsTable */

// Look up liters from pressure points using the device's calibration table
/**
 * @param {number | null} pressurePoints
 * @param {LevelsTable | null} table
 * @returns {number | null}
 */
function pressureToLiters(pressurePoints, table) {
  if (!table || pressurePoints == null) return null;
  const entry =
    table.find((e) => e.p >= pressurePoints) ?? table[table.length - 1];
  return entry.l;
}

/**
 * @param {number | null} liters
 * @param {number | null} maxLiters
 * @returns {string}
 */
function tankBar(liters, maxLiters) {
  if (liters == null || maxLiters == null) return "  —";
  const pct = Math.min(100, Math.round((liters / maxLiters) * 100));
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  return `  ${bar}  ${pct}%  (${liters.toFixed(1)} / ${maxLiters} L)`;
}

// ── Display ────────────────────────────────────────────────────────────────

const t1t2Table = levels?.t1t2Levels ?? null;
const t3Table = levels?.t3Levels ?? null;
const t1t2Max = t1t2Table ? t1t2Table[t1t2Table.length - 1].l : null;
const t3Max = t3Table ? t3Table[t3Table.length - 1].l : null;

// Get last pressure reading for each tank
/**
 * @param {string} key
 * @returns {number | null}
 */
function lastPressure(key) {
  const arr = graphData[key];
  return arr?.length ? arr[arr.length - 1].y : null;
}

const tanks = [
  { key: "tank1", label: "Tank 1  ", table: t1t2Table, max: t1t2Max },
  { key: "tank1_b", label: "Tank 1B ", table: t1t2Table, max: t1t2Max },
  { key: "tank2", label: "Tank 2  ", table: t1t2Table, max: t1t2Max },
  { key: "tank2_b", label: "Tank 2B ", table: t1t2Table, max: t1t2Max },
  { key: "tank3", label: "Tank 3  ", table: t3Table, max: t3Max },
];

console.log(
  `Device: ${device.deviceName}  (${device.type}, serial: ${device.serial})`,
);
console.log(`Status: ${device.online ? "online" : "offline"}\n`);
console.log("── Tank levels ───────────────────────────────────────────────");
for (const { key, label, table, max } of tanks) {
  const pressure = lastPressure(key);
  if (pressure == null) continue;
  const liters = pressureToLiters(pressure, table);
  console.log(`  ${label}${tankBar(liters, max)}`);
}

const ts = new Date(graphData.tank1?.[graphData.tank1.length - 1]?.x ?? now);
console.log(`\n  (readings as of ${ts.toLocaleString()})`);
console.log("─────────────────────────────────────────────────────────────");
