import { isIP } from "node:net";

/** SPEC §9. Clean before store or `/go`. No network. */

export type HygieneErrorCode =
  | "invalid_url"
  | "https_required"
  | "chat_link"
  | "nsfw"
  | "url_shortener";

export class HygieneError extends Error {
  readonly code: HygieneErrorCode;

  constructor(code: HygieneErrorCode, message: string) {
    super(message);
    this.name = "HygieneError";
    this.code = code;
  }
}

/** Invite / chat hosts. Subdomains match. */
export const CHAT_HOSTS: readonly string[] = [
  "t.me",
  "telegram.me",
  "telegram.dog",
  "wa.me",
  "whatsapp.com",
  "api.whatsapp.com",
  "chat.whatsapp.com",
  "web.whatsapp.com",
  "discord.gg",
  "discord.com",
  "discordapp.com",
  "discord.me",
  "m.me",
  "messenger.com",
  "signal.me",
  "signal.group",
  "line.me",
];

/** Adult platforms. Subdomains match. Documented on /rules. */
export const NSFW_HOSTS: readonly string[] = [
  "onlyfans.com",
  "fansly.com",
  "pornhub.com",
  "pornhub.org",
  "pornhubpremium.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "chaturbate.com",
  "stripchat.com",
  "manyvids.com",
  "redtube.com",
  "youporn.com",
  "brazzers.com",
  "adultfriendfinder.com",
];

/** Not stored. Offline path rejects; live resolve is out of this PR. */
export const SHORTENER_HOSTS: readonly string[] = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "lnkd.in",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "cutt.ly",
  "rb.gy",
];

function hostMatches(host: string, listed: string): boolean {
  return host === listed || host.endsWith(`.${listed}`);
}

function isChatHost(host: string): boolean {
  return CHAT_HOSTS.some((listed) => hostMatches(host, listed));
}

function isNsfwHost(host: string): boolean {
  return NSFW_HOSTS.some((listed) => hostMatches(host, listed));
}

function isShortenerHost(host: string): boolean {
  return SHORTENER_HOSTS.some((listed) => hostMatches(host, listed));
}

function hostnameOf(parsed: URL): string {
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

const ASCII_CONTROL_RE = /[\u0000-\u001f\u007f]/;
const EXPLICIT_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;
const EXPLICIT_AUTHORITY_SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i;
const HTTP_URL_RE = /^https?:\/\//i;
const HOST_LABEL_RE = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i;

function authorityOf(value: string): string {
  const schemeEnd = EXPLICIT_AUTHORITY_SCHEME_RE.test(value) ? value.indexOf("://") : -1;
  const authorityStart = value.startsWith("//")
    ? value.slice(2)
    : schemeEnd >= 0
      ? value.slice(schemeEnd + 3)
      : value;
  return authorityStart.match(/^[^/?#]*/)?.[0] ?? "";
}

function hostPartOfAuthority(authority: string, allowUserinfo = false): string | undefined {
  if (!authority || authority.includes("\\")) return undefined;
  if (allowUserinfo) {
    const userinfoEnd = authority.lastIndexOf("@");
    if (userinfoEnd >= 0) authority = authority.slice(userinfoEnd + 1);
  } else if (authority.includes("@")) {
    return undefined;
  }
  if (authority.startsWith("[")) {
    const closing = authority.indexOf("]");
    if (closing < 0) return undefined;
    const suffix = authority.slice(closing + 1);
    if (suffix && !/^:\d+$/.test(suffix)) return undefined;
    return authority.slice(0, closing + 1);
  }
  if (authority.includes("[") || authority.includes("]")) return undefined;
  const colon = authority.indexOf(":");
  if (colon < 0) return authority;
  if (colon !== authority.lastIndexOf(":") || !/^\d+$/.test(authority.slice(colon + 1))) {
    return undefined;
  }
  return authority.slice(0, colon);
}

function dottedHostname(host: string): boolean {
  const labels = host.split(".");
  return labels.length > 1 && labels.every((label) => HOST_LABEL_RE.test(label));
}

function plausibleSingleLabelHostname(host: string): boolean {
  return HOST_LABEL_RE.test(host) && host.includes("-");
}

function plausibleSiteAuthority(
  value: string,
  parsed: URL,
  allowUserinfo = false,
  allowSingleLabel = false,
): boolean {
  const authority = authorityOf(value);
  if (!authority || authority.startsWith("/")) return false;
  const hostPart = hostPartOfAuthority(authority, allowUserinfo);
  if (!hostPart) return false;
  const host = hostnameOf(parsed);
  if (!host) return false;
  if (hostPart.startsWith("[")) return isIP(host) === 6;
  if (isIP(host) === 4) return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostPart);
  return host === "localhost" || dottedHostname(host) ||
    (allowSingleLabel && plausibleSingleLabelHostname(host));
}

function ipv6ToBigInt(value: string): bigint | undefined {
  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (half: string): number[] | undefined => {
    if (!half) return [];
    const result: number[] = [];
    for (const part of half.split(":")) {
      if (part.includes(".")) {
        const octets = part.split(".").map(Number);
        if (
          octets.length !== 4 ||
          octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
        ) {
          return undefined;
        }
        result.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
      result.push(Number.parseInt(part, 16));
    }
    return result;
  };
  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (left === undefined || right === undefined) return undefined;
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...left, ...Array.from({ length: Math.max(0, missing) }, () => 0), ...right];
  if (groups.length !== 8) return undefined;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function ipv6InPrefix(hostname: string, prefix: string, bits: number): boolean {
  const value = ipv6ToBigInt(hostname);
  const network = ipv6ToBigInt(prefix);
  if (value === undefined || network === undefined) return false;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === (network & mask);
}

function unsafeHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname === "local" ||
    hostname === "internal" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    return true;
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [first, second] = hostname.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second! >= 64 && second! <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second! >= 16 && second! <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 2) ||
      (first === 198 && (second === 18 || second === 19 || second === 51)) ||
      (first === 203 && second === 0) ||
      first! >= 224
    );
  }
  if (ipVersion === 6) {
    return (
      ipv6InPrefix(hostname, "::", 128) ||
      ipv6InPrefix(hostname, "::1", 128) ||
      ipv6InPrefix(hostname, "fc00::", 7) ||
      ipv6InPrefix(hostname, "fe80::", 10) ||
      ipv6InPrefix(hostname, "fec0::", 10) ||
      ipv6InPrefix(hostname, "ff00::", 8) ||
      ipv6InPrefix(hostname, "2001:db8::", 32) ||
      ipv6InPrefix(hostname, "::ffff:0:0", 96)
    );
  }
  return false;
}

function looksLikeBareSiteUrl(value: string): boolean {
  if (
    !value ||
    /\s/.test(value) ||
    ASCII_CONTROL_RE.test(value) ||
    value.includes("\\") ||
    (value.startsWith("/") && !value.startsWith("//")) ||
    EXPLICIT_AUTHORITY_SCHEME_RE.test(value) ||
    value.startsWith("///")
  ) {
    return false;
  }
  try {
    const candidate = value.startsWith("//")
      ? new URL(`https:${value}`)
      : new URL(`https://${value}`);
    return plausibleSiteAuthority(value, candidate, false, value.startsWith("//"));
  } catch {
    return false;
  }
}

function urlCandidate(value: string): string {
  if (HTTP_URL_RE.test(value)) return value;
  if (value.startsWith("//") && !value.startsWith("///") && looksLikeBareSiteUrl(value)) {
    return `https:${value}`;
  }
  if (looksLikeBareSiteUrl(value)) return `https://${value}`;
  return value;
}

/**
 * https only. Bare site hosts receive an https scheme. Drop userinfo, hash,
 * and every query parameter.
 * Reject chat/invite, NSFW, and unresolved shorteners.
 */
export function canonicalizeSiteUrl(raw: string): string {
  if (ASCII_CONTROL_RE.test(raw) || raw.includes("\\")) {
    throw new HygieneError("invalid_url", "site URL contains invalid characters");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new HygieneError("invalid_url", "site URL is required");
  }
  if (/\s/.test(trimmed)) {
    throw new HygieneError("invalid_url", "site URL contains invalid whitespace");
  }
  if (
    (trimmed.startsWith("/") && !trimmed.startsWith("//")) ||
    trimmed.startsWith("///")
  ) {
    throw new HygieneError("invalid_url", "site URL must include a public host");
  }
  if (EXPLICIT_SCHEME_RE.test(trimmed) && !HTTP_URL_RE.test(trimmed) && !looksLikeBareSiteUrl(trimmed)) {
    throw new HygieneError("https_required", "site URL must be https");
  }
  if (HTTP_URL_RE.test(trimmed) && !authorityOf(trimmed)) {
    throw new HygieneError("invalid_url", "site URL host is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlCandidate(trimmed));
  } catch {
    throw new HygieneError("invalid_url", "site URL is not a valid URL");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new HygieneError("https_required", "site URL must be https");
  }

  if (!plausibleSiteAuthority(trimmed, parsed, true, trimmed.startsWith("//"))) {
    throw new HygieneError("invalid_url", "site URL must include a valid public host");
  }

  const host = hostnameOf(parsed);
  if (!host) {
    throw new HygieneError("invalid_url", "site URL host is required");
  }

  if (isShortenerHost(host)) {
    throw new HygieneError("url_shortener", "URL shorteners are not stored");
  }
  if (isChatHost(host)) {
    throw new HygieneError("chat_link", "chat and invite links are not allowed");
  }
  if (isNsfwHost(host)) {
    throw new HygieneError("nsfw", "adult platforms are not allowed");
  }
  if (unsafeHostname(host)) {
    throw new HygieneError("invalid_url", "private and local site targets are not allowed");
  }
  if (protocol !== "https:") {
    throw new HygieneError("https_required", "site URL must be https");
  }

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const port = parsed.port && parsed.port !== "443" ? `:${parsed.port}` : "";
  const hostForUrl = host.includes(":") ? `[${host}]` : host;
  return `https://${hostForUrl}${port}${path === "/" ? "/" : path}`;
}
