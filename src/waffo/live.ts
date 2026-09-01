import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import {
  WaffoPancake,
  WaffoPancakeError,
  TaxCategory,
  verifyWebhook,
  type WaffoPancakeConfig,
} from "@waffo/pancake-ts";
import type {
  CreateCheckoutInput,
  WaffoCheckout,
  WaffoCheckoutRecord,
  WaffoEnv,
  WaffoMode,
  WaffoPaid,
  WaffoPort,
  WaffoWebhook,
} from "./port.js";
import {
  centsToDisplayString,
  WaffoProviderError,
  waffoEnvironment,
} from "./port.js";

export const DEFAULT_WAFFO_API_BASE = "https://api.waffo.ai";

export type WaffoConfig = {
  mode: Exclude<WaffoMode, "fixture">;
  environment: "test" | "prod";
  merchantId: string;
  privateKey: string;
  storeId: string;
  productId: string;
  publicBaseUrl: string;
  apiBase: string;
  webhookPublicKey: string;
  databasePath: string;
};

/** Kept for source compatibility; live configuration always requires a DB. */
export type ReadWaffoConfigOptions = { requireDatabase?: boolean };

function required(env: WaffoEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`BLOCKED-CONFIG: ${name}`);
  }
  return value;
}

/**
 * Deployment platforms use more than NODE_ENV for a production-like
 * process. Keep the check at the provider boundary so neither the factory
 * nor buildApp can silently choose the offline port under an alias.
 */
export function isProductionLike(env: WaffoEnv = process.env): boolean {
  return ["NODE_ENV", "VERCEL_ENV", "APP_ENV", "DEPLOY_ENV", "BUILD_ENV"]
    .some((name) => env[name]?.trim().toLowerCase() === "production" ||
      process.env[name]?.trim().toLowerCase() === "production");
}

function normalizeKeyMaterial(raw: string, kind: "private" | "public"): string {
  const value = raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
  if (value.includes("-----BEGIN")) return value;
  const base64 = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) return value;
  const wrapped = base64.match(/.{1,64}/g)?.join("\n");
  if (!wrapped) return value;
  const label = kind === "private" ? "PRIVATE KEY" : "PUBLIC KEY";
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
}

function requireRsaPrivateKey(raw: string): string {
  const normalized = normalizeKeyMaterial(raw, "private");
  try {
    const key = createPrivateKey(normalized);
    if (key.asymmetricKeyType !== "rsa") throw new Error("not RSA");
  } catch {
    throw new Error("BLOCKED-CONFIG: WAFFO_PRIVATE_KEY");
  }
  return normalized;
}

function requireRsaPublicKey(raw: string, name: string): string {
  const normalized = normalizeKeyMaterial(raw, "public");
  try {
    const key = createPublicKey(normalized);
    if (key.asymmetricKeyType !== "rsa") throw new Error("not RSA");
  } catch {
    throw new Error(`BLOCKED-CONFIG: ${name}`);
  }
  return normalized;
}

function requiredShortId(env: WaffoEnv, name: string, prefix: "MER" | "STO" | "PROD"): string {
  const raw = env[name];
  if (typeof raw !== "string" || raw.length === 0 || raw.trim() !== raw) {
    throw new Error(`BLOCKED-CONFIG: ${name}`);
  }
  const value = raw;
  if (!new RegExp(`^${prefix}_[0-9A-Za-z]{22}$`).test(value)) {
    throw new Error(`BLOCKED-CONFIG: ${name}`);
  }
  return value;
}

function privateKeyFromEnv(env: WaffoEnv): string {
  const inline = env.WAFFO_PRIVATE_KEY?.trim();
  if (inline) return requireRsaPrivateKey(inline);
  const path = env.WAFFO_PRIVATE_KEY_FILE?.trim();
  if (path) {
    try {
      const key = readFileSync(path, "utf8").trim();
      if (key) return requireRsaPrivateKey(key);
    } catch {
      // Do not disclose a filesystem path or fall back to fixture.
    }
  }
  throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY");
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
        result.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
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
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal")
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
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 2) ||
      (first === 198 && (second === 18 || second === 19 || second === 51)) ||
      (first === 203 && second === 0) ||
      first >= 224
    );
  }
  if (ipVersion === 6) {
    return (
      ipv6InPrefix(hostname, "::", 128) ||
      ipv6InPrefix(hostname, "::1", 128) ||
      ipv6InPrefix(hostname, "fc00::", 7) ||
      ipv6InPrefix(hostname, "fe80::", 10) ||
      ipv6InPrefix(hostname, "ff00::", 8) ||
      ipv6InPrefix(hostname, "2001:db8::", 32) ||
      ipv6InPrefix(hostname, "::ffff:0:0", 96)
    );
  }
  return false;
}

function requireHttpsPublicUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("BLOCKED-CONFIG: WAFFO_PUBLIC_BASE_URL");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.pathname !== "/" ||
    parsed.port !== "" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    unsafeHostname(parsed.hostname)
  ) {
    throw new Error("BLOCKED-CONFIG: WAFFO_PUBLIC_BASE_URL");
  }
  // Return only the origin so a path/query supplied by an operator cannot
  // become part of the provider callback route.
  return parsed.origin;
}

function requireHttpsApiBase(value: string, environment: "test" | "prod"): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("BLOCKED-CONFIG: WAFFO_API_BASE");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    unsafeHostname(parsed.hostname)
  ) {
    throw new Error("BLOCKED-CONFIG: WAFFO_API_BASE");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const testHost = environment === "test" && host === "api.waffo.test";
  if ((host !== "api.waffo.ai" && !testHost) || parsed.port) {
    throw new Error("BLOCKED-CONFIG: WAFFO_API_BASE");
  }
  return value.replace(/\/+$/, "");
}

/**
 * Waffo returns a hosted Pancake resource, not an arbitrary redirect URL.
 * Keep the provider's URL and session id bound together before anything is
 * persisted or sent to a browser. The same hosted origin is used for test and
 * production; the API/webhook environment is selected by the live client.
 */
function requireHttpsCheckoutUrl(value: string, expectedSessionId: string): string {
  if (typeof value !== "string" || value === "" || value.trim() !== value) {
    throw new Error("Waffo returned an invalid checkout URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Waffo returned an invalid checkout URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hostname.toLowerCase() !== "pancake.waffo.ai" ||
    parsed.search ||
    parsed.hash ||
    unsafeHostname(parsed.hostname)
  ) {
    throw new Error("Waffo returned an untrusted checkout URL");
  }
  // URL parsing hides an explicit default port and normalizes dot segments;
  // inspect the raw authority/path so those spellings cannot bypass the
  // documented hosted checkout shape.
  const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (
    authority !== "pancake.waffo.ai" ||
    authority.includes("@") ||
    authority.includes(":") ||
    /[^\x21-\x7e]/.test(authority)
  ) {
    throw new Error("Waffo returned an untrusted checkout URL");
  }
  const rawSuffix = value.slice("https://".length + authority.length);
  const rawPath = rawSuffix.split(/[?#]/, 1)[0] ?? "";
  if (
    rawSuffix.includes("?") ||
    rawSuffix.includes("#") ||
    rawPath !== parsed.pathname ||
    parsed.pathname.includes("%") ||
    parsed.toString() !== value
  ) {
    throw new Error("Waffo returned an invalid checkout URL");
  }
  const match = /^\/store\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))\/checkout\/([A-Za-z0-9_-]+)$/.exec(
    parsed.pathname,
  );
  if (!match || match[2] !== expectedSessionId) {
    throw new Error("Waffo returned an invalid checkout URL");
  }
  return parsed.toString();
}

export function readWaffoConfig(
  env: WaffoEnv = process.env,
  options: ReadWaffoConfigOptions = {},
): WaffoConfig {
  const rawMode = env.WAFFO_MODE?.trim();
  if (rawMode !== "waffo-test" && rawMode !== "waffo-prod") {
    throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
  }
  if (isProductionLike(env) && rawMode !== "waffo-prod") {
    throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
  }
  const mode = rawMode as Exclude<WaffoMode, "fixture">;
  const environment = waffoEnvironment(mode);
  if (!environment) {
    throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
  }
  const merchantId = requiredShortId(env, "WAFFO_MERCHANT_ID", "MER");
  const privateKey = privateKeyFromEnv(env);
  const storeId = requiredShortId(env, "WAFFO_STORE_ID", "STO");
  const productId = requiredShortId(env, "WAFFO_PRODUCT_ID", "PROD");
  const publicBaseUrl = requireHttpsPublicUrl(required(env, "WAFFO_PUBLIC_BASE_URL"));
  const publicKeyName =
    environment === "prod"
      ? "WAFFO_PROD_WEBHOOK_PUBLIC_KEY"
      : "WAFFO_TEST_WEBHOOK_PUBLIC_KEY";
  const webhookPublicKeyRaw = env[publicKeyName]?.trim() ?? "";
  if (!webhookPublicKeyRaw) {
    throw new Error(`BLOCKED-CONFIG: ${publicKeyName}`);
  }
  const webhookPublicKey = requireRsaPublicKey(webhookPublicKeyRaw, publicKeyName);
  const databasePath = required(env, "DATABASE_PATH");
  if (databasePath === ":memory:") {
    throw new Error("BLOCKED-CONFIG: DATABASE_PATH");
  }
  return {
    mode,
    environment,
    merchantId,
    privateKey,
    storeId,
    productId,
    publicBaseUrl,
    apiBase: requireHttpsApiBase(
      env.WAFFO_API_BASE?.trim() || DEFAULT_WAFFO_API_BASE,
      environment,
    ),
    webhookPublicKey,
    databasePath,
  };
}

export type LiveWaffoOptions = {
  env?: WaffoEnv;
  fetch?: typeof fetch;
  requireDatabase?: boolean;
  timeoutMs?: number;
};

const DEFAULT_CHECKOUT_TIMEOUT_MS = 15_000;

function checkoutTimeoutMs(env: WaffoEnv, override?: number): number {
  const raw = override ?? env.WAFFO_CHECKOUT_TIMEOUT_MS ?? env.WAFFO_PROVIDER_TIMEOUT_MS;
  const value = raw === undefined ? DEFAULT_CHECKOUT_TIMEOUT_MS : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new Error("BLOCKED-CONFIG: WAFFO_CHECKOUT_TIMEOUT_MS");
  }
  return value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new WaffoProviderError("unknown", "Waffo checkout outcome is unknown (timeout)"));
    }, timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function fetchWithDeadline(baseFetch: typeof fetch, timeoutMs: number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let rejectDeadline: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    // If fetch fails before a Response exists, no body wrapper consumes this
    // promise. Keep the timer rejection from becoming an unhandled rejection.
    void deadline.catch(() => undefined);
    const callerSignal = init?.signal;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    };
    function abortFromCaller(): void {
      if (!controller.signal.aborted) controller.abort(callerSignal?.reason);
      rejectDeadline?.(new Error("Waffo provider request aborted"));
      cleanup();
    }
    timer = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort(new Error("Waffo provider response timeout"));
      rejectDeadline?.(new Error("Waffo provider response timeout"));
      cleanup();
    }, timeoutMs);
    if (callerSignal) {
      if (callerSignal.aborted) abortFromCaller();
      else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    try {
      const response = await baseFetch(input, { ...init, signal: controller.signal });
      // The official SDK calls response.json() after fetch resolves. Keep the
      // same deadline alive through body consumption, including a headers-only
      // response whose body never completes.
      return wrapResponseBodyDeadline(response, deadline, cleanup);
    } catch (error) {
      cleanup();
      throw error;
    }
  }) as typeof fetch;
}

function wrapResponseBodyDeadline(
  response: Response,
  deadline: Promise<never>,
  cleanup: () => void,
): Response {
  const bodyMethods = new Set(["arrayBuffer", "blob", "bytes", "formData", "json", "text"]);
  return new Proxy(response, {
    get(target, property) {
      // Response accessors use private fields and require the real Response as
      // their receiver; do not invoke them through the proxy itself.
      const value = Reflect.get(target, property, target);
      if (typeof property !== "string" || !bodyMethods.has(property) || typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) =>
        Promise.race([
          Promise.resolve(Reflect.apply(value, target, args)),
          deadline,
        ]).finally(cleanup);
    },
  });
}

function requireFutureExpiry(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WaffoProviderError("unknown", "Waffo checkout outcome is unknown (invalid checkout expiry)");
  }
  const timestamp = Date.parse(value);
  // Never expose a session which is already expired (or has an
  // unparseable/provider-implausible timestamp) to the buyer.
  const now = Date.now();
  const maxPlausibleLifetime = 366 * 24 * 60 * 60 * 1000;
  if (
    !Number.isFinite(timestamp) ||
    timestamp <= now ||
    timestamp > now + maxPlausibleLifetime
  ) {
    throw new WaffoProviderError("unknown", "Waffo checkout outcome is unknown (invalid checkout expiry)");
  }
  return new Date(timestamp).toISOString();
}

function isInvalidResponseError(error: unknown): boolean {
  return error instanceof WaffoPancakeError && /Non-JSON response/.test(error.message);
}

function providerError(error: unknown): WaffoProviderError {
  if (error instanceof WaffoProviderError) return error;
  if (error instanceof WaffoPancakeError) {
    const ambiguousStatus = [408, 409, 425, 429].includes(error.status);
    const rejected = !isInvalidResponseError(error) &&
      !ambiguousStatus && error.status >= 400 && error.status < 500;
    return new WaffoProviderError(
      rejected ? "rejected" : "unknown",
      rejected ? "Waffo rejected checkout creation" : "Waffo checkout outcome is unknown",
      { status: error.status, cause: error },
    );
  }
  return new WaffoProviderError("unknown", "Waffo checkout outcome is unknown", {
    cause: error,
  });
}

export class LiveWaffo implements WaffoPort {
  readonly kind: Exclude<WaffoMode, "fixture">;
  readonly mode: Exclude<WaffoMode, "fixture">;
  readonly environment: "test" | "prod";
  readonly storeId: string;
  readonly productId: string;
  readonly publicBaseUrl: string;
  private readonly config: WaffoConfig;
  private readonly client: WaffoPancake;
  private readonly timeoutMs: number;
  private readonly sessions = new Map<string, WaffoCheckoutRecord>();

  constructor(options: LiveWaffoOptions = {}) {
    const env = options.env ?? process.env;
    this.config = readWaffoConfig(env, { requireDatabase: true });
    this.timeoutMs = checkoutTimeoutMs(env, options.timeoutMs);
    this.kind = this.config.mode;
    this.mode = this.config.mode;
    this.environment = this.config.environment;
    this.storeId = this.config.storeId;
    this.productId = this.config.productId;
    this.publicBaseUrl = this.config.publicBaseUrl;
    const sdkConfig: WaffoPancakeConfig = {
      merchantId: this.config.merchantId,
      privateKey: this.config.privateKey,
      baseUrl: this.config.apiBase,
      environment: this.config.environment,
      webhookPublicKey: this.config.webhookPublicKey,
      fetch: fetchWithDeadline(
        options.fetch ?? globalThis.fetch.bind(globalThis),
        this.timeoutMs,
      ),
    };
    this.client = new WaffoPancake(sdkConfig);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<WaffoCheckout> {
    const metadata: Record<string, string> = {
      intentId: input.intentId,
      intentFingerprint: input.intentFingerprint,
      episodeId: input.episodeId,
      listingId: input.listingId,
      kind: input.kind,
      name: input.name,
      siteUrl: input.siteUrl,
      canonicalUrl: input.siteUrl,
      oneLiner: input.oneLiner,
      boardWindowKey: input.episodeId,
      quoteBaseCents: String(input.quoteBaseCents),
      targetBidCents: String(input.targetBidCents),
      chargeCents: String(input.chargeCents),
      currency: "USD",
      taxCategory: "digital_goods",
      storeId: this.storeId,
      productId: this.productId,
      mode: this.mode,
    };
    try {
      const session = await withTimeout(this.client.checkout.anonymous.create({
        productId: this.productId,
        currency: "USD",
        priceSnapshot: {
          amount: centsToDisplayString(input.chargeCents),
          taxCategory: TaxCategory.DigitalGoods,
        },
        successUrl: `${this.publicBaseUrl}/checkout/complete?intent=${encodeURIComponent(input.intentId)}`,
        orderMerchantExternalId: input.intentId,
        metadata,
      }), this.timeoutMs);
      if (
        typeof session.sessionId !== "string" ||
        session.sessionId === "" ||
        session.sessionId.trim() !== session.sessionId
      ) {
        throw new WaffoProviderError("unknown", "Waffo returned an invalid checkout session");
      }
      if (typeof session.checkoutUrl !== "string" || session.checkoutUrl.trim() === "") {
        throw new WaffoProviderError("unknown", "Waffo returned an invalid checkout session");
      }
      const checkoutUrl = requireHttpsCheckoutUrl(session.checkoutUrl, session.sessionId);
      const expiresAt = requireFutureExpiry(session.expiresAt);
      const result: WaffoCheckout = {
        checkoutId: session.sessionId,
        url: checkoutUrl,
        expiresAt,
      };
      this.sessions.set(result.checkoutId, {
        ...input,
        checkoutId: result.checkoutId,
        url: result.url,
        expiresAt: result.expiresAt,
        status: "pending",
      });
      return result;
    } catch (error) {
      throw providerError(error);
    }
  }

  getCheckout(checkoutId: string): WaffoCheckoutRecord | undefined {
    const session = this.sessions.get(checkoutId);
    return session ? { ...session } : undefined;
  }

  async completeCheckout(checkoutId: string): Promise<WaffoPaid> {
    throw new Error(`live Waffo session ${checkoutId} completes via webhook only`);
  }

  verifyWebhook(rawBody: string, signature: string | undefined): WaffoWebhook {
    return verifyWebhook<Record<string, unknown>>(rawBody, signature, {
      environment: this.environment,
      publicKey: this.config.webhookPublicKey,
    });
  }
}
