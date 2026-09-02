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
  return parsed.hostname.toLowerCase().replace(/\.$/, "");
}

function looksLikeBareSiteUrl(value: string): boolean {
  if (!value || /\s/.test(value) || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false;
  try {
    const candidate = value.startsWith("//")
      ? new URL(`https:${value}`)
      : new URL(`https://${value}`);
    return Boolean(candidate.hostname);
  } catch {
    return false;
  }
}

function urlCandidate(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (looksLikeBareSiteUrl(value)) return `https://${value}`;
  return value;
}

/**
 * https only. Bare site hosts receive an https scheme. Drop userinfo, hash,
 * and every query parameter.
 * Reject chat/invite, NSFW, and unresolved shorteners.
 */
export function canonicalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new HygieneError("invalid_url", "site URL is required");
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
  if (protocol !== "https:") {
    throw new HygieneError("https_required", "site URL must be https");
  }

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const port = parsed.port && parsed.port !== "443" ? `:${parsed.port}` : "";
  const hostForUrl = host.includes(":") ? `[${host}]` : host;
  return `https://${hostForUrl}${port}${path === "/" ? "/" : path}`;
}
