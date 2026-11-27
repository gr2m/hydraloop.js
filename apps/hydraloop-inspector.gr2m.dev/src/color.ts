// Converts computed CSS colors to sRGB hex for three.js, without a canvas.
// Canvas `fillStyle` silently keeps black for color syntaxes it does not know
// (older iOS Safari and oklch), which turned highlights black.

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const gamma = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const linear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

function hex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(clamp01(v) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function oklabToHex(L: number, a: number, b: number) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return hex(
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
}

/** Parses one component; `percentOf` scales "50%" (1 for L, 0.4 for oklch chroma). */
function num(token: string | undefined, percentOf = 1) {
  if (!token || token === "none") return 0;
  return token.endsWith("%")
    ? (parseFloat(token) / 100) * percentOf
    : parseFloat(token);
}

export function cssColorToHex(input: string): string | null {
  const str = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(str)) return str;
  const m = str.match(/^([a-z-]+)\((.*)\)$/);
  if (!m) return null;
  const [, fn, body] = m;
  const parts = body.replace(/,/g, " ").split("/")[0].trim().split(/\s+/);

  if (fn === "rgb" || fn === "rgba") {
    const [r, g, b] = parts.map((p) =>
      p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / 255,
    );
    return hex(r, g, b);
  }
  if (fn === "oklch") {
    const L = num(parts[0]);
    const C = num(parts[1], 0.4);
    const h = (num(parts[2]) * Math.PI) / 180;
    return oklabToHex(L, C * Math.cos(h), C * Math.sin(h));
  }
  if (fn === "oklab")
    return oklabToHex(num(parts[0]), num(parts[1], 0.4), num(parts[2], 0.4));
  if (fn === "color") {
    const [space, ...rest] = parts;
    const [r, g, b] = rest.map((p) => num(p));
    if (space === "srgb") return hex(r, g, b);
    if (space === "display-p3") {
      // Linear Display P3 to linear sRGB.
      const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
      return hex(
        gamma(1.2249401 * lr - 0.2249404 * lg),
        gamma(-0.0420569 * lr + 1.0420571 * lg),
        gamma(-0.0196376 * lr - 0.0786361 * lg + 1.0982735 * lb),
      );
    }
  }
  return null;
}
