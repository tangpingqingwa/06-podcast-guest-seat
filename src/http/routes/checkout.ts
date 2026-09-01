import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppDb } from "../../db.js";
import { getEpisode } from "../../episodes.js";
import { canonicalizeSiteUrl, HygieneError } from "../../hygiene.js";
import { listListingsForEpisode, type Listing } from "../../listings.js";
import {
  applyPaidOpen,
  applyPaidRaise,
  quoteOpenBid,
  quoteRaise,
  raiseableListing,
  RankError,
  type BidQuote,
} from "../../rank.js";
import { FixtureWaffo } from "../../waffo/fixture.js";
import { isProductionLike, LiveWaffo, readWaffoConfig } from "../../waffo/live.js";
import {
  centsToDisplayString,
  parseDisplayCents,
  type WaffoCheckoutRecord,
  type WaffoEnv,
  type WaffoMode,
  type WaffoPort,
  type WaffoWebhook,
  WaffoProviderError,
} from "../../waffo/port.js";
import { renderCheckoutErrorHtml, renderCheckoutStatusHtml } from "./pages.js";

/** POST /checkout starts a Waffo (or explicitly selected fixture) checkout. */
export const CHECKOUT_PATH = "/checkout" as const;
export const CHECKOUT_COMPLETE_PATH = "/checkout/complete" as const;
export const WAFFO_WEBHOOK_PATH = "/webhooks/waffo" as const;

export type CheckoutBody = {
  episodeId?: unknown;
  name?: unknown;
  siteUrl?: unknown;
  oneLiner?: unknown;
  bidUsd?: unknown;
  listingId?: unknown;
};

export class CheckoutError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "CheckoutError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Signature failures are deliberately not entered in the authoritative
 * delivery/identity ledger. The body is still available to operator logs at
 * the HTTP boundary, but it cannot reserve a later valid delivery. */
class WebhookVerificationError extends CheckoutError {
  constructor() {
    super("invalid_webhook", "invalid Waffo webhook", 400);
    this.name = "WebhookVerificationError";
  }
}

type CheckoutIntentStatus =
  | "creating"
  | "open"
  | "unknown"
  | "paid"
  | "rejected"
  | "needs_reconciliation";

type CheckoutIntentRow = {
  id: string;
  provider_checkout_id: string | null;
  provider_checkout_url: string | null;
  provider_expires_at: string | null;
  episode_id: string;
  listing_id: string;
  board_window_key: string;
  kind: "open" | "raise";
  name: string;
  site_url: string;
  one_liner: string;
  intent_fingerprint: string;
  normalized_payload: string;
  mode: WaffoMode;
  expected_store_id: string;
  expected_product_id: string;
  expected_currency: "USD";
  tax_category: "digital_goods";
  quote_base_cents: number;
  target_bid_cents: number;
  charge_cents: number;
  amount_cents: number;
  currency: "USD";
  next_usd: number;
  status: CheckoutIntentStatus;
  paid_at: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

type WaffoCheckoutEventRow = {
  delivery_id: string;
  event_type: string;
  business_event_id: string;
  payment_id: string;
  order_id: string;
  intent_id: string;
  mode: string;
  store_id: string;
  payload_hash: string;
  event_fingerprint: string;
  business_payload: string;
  business_payload_version: number;
  outcome: "accepted";
  reason: string | null;
  event_timestamp: string;
  received_at: string;
};

type WaffoWebhookAttemptRow = {
  attempt_id: string;
  delivery_id: string | null;
  payload_hash: string;
  event_fingerprint: string | null;
  outcome: "rejected" | "needs_reconciliation";
  reason: string;
};

type PresentField = { present: boolean; value: unknown; conflict: boolean };

export type VerifiedWaffoOrderCompleted = {
  deliveryId: string;
  eventType: "order.completed";
  businessEventId: string;
  paymentId: string;
  orderId: string;
  intentId: string;
  mode: WaffoMode;
  storeId: string;
  eventTimestamp: string;
  payloadHash: string;
  eventFingerprint: string;
  /** Canonical verified payload, excluding only the delivery id. */
  businessPayload?: string;
  metadata: Record<string, string>;
  amountCents: number;
  subtotalCents?: number;
  /** True when the raw event included subtotal, even if its value was malformed. */
  subtotalPresent?: boolean;
  taxCents: number;
  totalCents?: number;
  /** True when the raw event included total, even if its value was malformed. */
  totalPresent?: boolean;
  checkoutId?: string;
  /** True when the provider included checkoutId, including a malformed value. */
  checkoutIdPresent?: boolean;
  productId?: string;
  /** True when the provider included productId, including a malformed value. */
  productIdPresent?: boolean;
  buyerEmail?: string;
  productName?: string;
};

type RawWebhookRequest = FastifyRequest & { rawBody?: Buffer };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readProviderString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    ? value
    : undefined;
}

function readAlias(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in record) return record[name];
  }
  return undefined;
}

function presentAlias(record: Record<string, unknown>, ...names: string[]): PresentField {
  const presentNames = names.filter((name) => Object.prototype.hasOwnProperty.call(record, name));
  if (presentNames.length === 0) {
    return { present: false, value: undefined, conflict: false };
  }
  const value = record[presentNames[0]!];
  return {
    present: true,
    value,
    conflict: presentNames.slice(1).some((name) => stableJson(record[name]) !== stableJson(value)),
  };
}

function metadataRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined;
    result[key] = item;
  }
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalBusinessPayload(rawBody: Buffer): string {
  const parsed = parseRawWebhookBody(rawBody);
  return stableJson(
    Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "id")),
  );
}

function parseRawWebhookBody(rawBody: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw invalidWebhook("Waffo webhook body is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw invalidWebhook("Waffo webhook body must be an object");
  }
  return parsed;
}

function legacyEventFingerprint(
  payment: Omit<VerifiedWaffoOrderCompleted, "eventFingerprint">,
): string {
  return sha256(
    stableJson({
      eventType: payment.eventType,
      businessEventId: payment.businessEventId,
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      intentId: payment.intentId,
      buyerEmail: payment.buyerEmail,
      productName: payment.productName,
      mode: payment.mode,
      storeId: payment.storeId,
      eventTimestamp: payment.eventTimestamp,
      metadata: payment.metadata,
      amountCents: payment.amountCents,
      subtotalCents: payment.subtotalCents,
      subtotalPresent: payment.subtotalPresent,
      taxCents: payment.taxCents,
      totalCents: payment.totalCents,
      totalPresent: payment.totalPresent,
      checkoutId: payment.checkoutId,
      checkoutIdPresent: payment.checkoutIdPresent,
      productId: payment.productId,
      productIdPresent: payment.productIdPresent,
    }),
  );
}

function eventFingerprint(payment: Omit<VerifiedWaffoOrderCompleted, "eventFingerprint">): string {
  return payment.businessPayload !== undefined
    ? sha256(payment.businessPayload)
    : legacyEventFingerprint(payment);
}

/** Explicit mode selection. Missing mode never silently falls back to live. */
export function createWaffoPort(env: WaffoEnv = process.env): WaffoPort {
  const mode = env.WAFFO_MODE?.trim();
  const production = isProductionLike(env);
  if (mode === "fixture") {
    if (production) {
      throw new Error("BLOCKED-CONFIG: fixture provider is forbidden in production");
    }
    return new FixtureWaffo();
  }
  if (mode !== "waffo-test" && mode !== "waffo-prod") {
    throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
  }
  if (production && mode !== "waffo-prod") {
    throw new Error("BLOCKED-CONFIG: WAFFO_MODE");
  }
  // This is the only live construction path used by src/server.ts. The
  // durable DB requirement is checked before a provider client can be used.
  readWaffoConfig(env, { requireDatabase: true });
  return new LiveWaffo({ env, requireDatabase: true });
}

function usdToCents(amountUsd: number): number {
  const cents = amountUsd * 100;
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new CheckoutError("invalid_checkout", "checkout amount is invalid");
  }
  return cents;
}

function selectProviderValues(port: WaffoPort): {
  mode: WaffoMode;
  storeId: string;
  productId: string;
} {
  const mode = port.mode;
  const storeId = readString(port.storeId);
  const productId = readString(port.productId);
  if (!storeId || !productId) {
    throw new CheckoutError("waffo_unavailable", "BLOCKED-CONFIG: WAFFO_STORE_ID", 503);
  }
  return { mode, storeId, productId };
}

function intentNormalizedPayload(
  intentId: string,
  draft: CheckoutDraft,
  values: ReturnType<typeof selectProviderValues>,
): Record<string, string | number> {
  return {
    intentId,
    episodeId: draft.episodeId,
    listingId: draft.listingId,
    boardWindowKey: draft.episodeId,
    kind: draft.quote.kind,
    name: draft.name,
    siteUrl: draft.siteUrl,
    canonicalUrl: draft.siteUrl,
    oneLiner: draft.oneLiner,
    quoteBaseCents: usdToCents(draft.quote.nextUsd) - usdToCents(draft.quote.chargeUsd),
    targetBidCents: usdToCents(draft.quote.nextUsd),
    chargeCents: usdToCents(draft.quote.chargeUsd),
    currency: "USD",
    taxCategory: "digital_goods",
    mode: values.mode,
    storeId: values.storeId,
    productId: values.productId,
  };
}

function insertCheckoutIntent(
  db: AppDb,
  intentId: string,
  draft: CheckoutDraft,
  values: ReturnType<typeof selectProviderValues>,
): { fingerprint: string; normalizedPayload: string } {
  const normalized = intentNormalizedPayload(intentId, draft, values);
  const normalizedPayload = stableJson(normalized);
  const fingerprint = sha256(normalizedPayload);
  const now = new Date().toISOString();
  const targetBidCents = usdToCents(draft.quote.nextUsd);
  const chargeCents = usdToCents(draft.quote.chargeUsd);
  const quoteBaseCents = targetBidCents - chargeCents;
  db.prepare(
    `INSERT INTO checkout_intents (
       id, provider_checkout_id, provider_checkout_url, provider_expires_at,
       episode_id, listing_id, board_window_key, kind, name, site_url, one_liner,
       intent_fingerprint, normalized_payload, mode, expected_store_id,
       expected_product_id, expected_currency, tax_category,
       quote_base_cents, target_bid_cents, charge_cents,
       amount_cents, currency, next_usd, status, paid_at,
       provider_order_id, provider_payment_id, failure_code, created_at, updated_at
     ) VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD',
       'digital_goods', ?, ?, ?, ?, 'USD', ?, 'creating', NULL, NULL, NULL, NULL, ?, ?)`
  ).run(
    intentId,
    draft.episodeId,
    draft.listingId,
    draft.episodeId,
    draft.quote.kind,
    draft.name,
    draft.siteUrl,
    draft.oneLiner,
    fingerprint,
    normalizedPayload,
    values.mode,
    values.storeId,
    values.productId,
    quoteBaseCents,
    targetBidCents,
    chargeCents,
    chargeCents,
    draft.quote.nextUsd,
    now,
    now,
  );
  return { fingerprint, normalizedPayload };
}

function markCheckoutIntentProviderFailure(
  db: AppDb,
  intentId: string,
  error: unknown,
): void {
  const state = error instanceof WaffoProviderError ? error.state : "unknown";
  const failureCode =
    error instanceof WaffoProviderError
      ? state === "rejected"
        ? "waffo_checkout_rejected"
        : "waffo_checkout_unknown"
      : "waffo_checkout_unknown";
  db.prepare(
    `UPDATE checkout_intents
        SET status = ?, failure_code = ?, updated_at = ?
      WHERE id = ? AND status IN ('creating', 'open', 'unknown')`,
  ).run(state === "rejected" ? "rejected" : "unknown", failureCode, new Date().toISOString(), intentId);
}

function bindProviderCheckout(
  db: AppDb,
  intentId: string,
  created: { checkoutId: string; url: string; expiresAt?: string },
): void {
  const result = db
    .prepare(
      `UPDATE checkout_intents
          SET provider_checkout_id = ?, provider_checkout_url = ?,
              provider_expires_at = ?,
              status = CASE WHEN status = 'creating' THEN 'open' ELSE status END,
              updated_at = ?
        WHERE id = ?`,
    )
    .run(
      created.checkoutId,
      created.url,
      created.expiresAt ?? null,
      new Date().toISOString(),
      intentId,
    );
  if (result.changes !== 1) {
    throw new CheckoutError("checkout_persistence", "checkout intent could not be persisted", 503);
  }
}

function intentSelect(): string {
  return `SELECT id, provider_checkout_id, provider_checkout_url, provider_expires_at,
      episode_id, listing_id, board_window_key, kind, name, site_url, one_liner,
      intent_fingerprint, normalized_payload, mode, expected_store_id,
      expected_product_id, expected_currency, tax_category,
      quote_base_cents, target_bid_cents, charge_cents,
      amount_cents, currency, next_usd, status, paid_at,
      provider_order_id, provider_payment_id, failure_code, created_at, updated_at
    FROM checkout_intents`;
}

function getCheckoutIntentById(db: AppDb, id: string): CheckoutIntentRow | undefined {
  return db.prepare<[string], CheckoutIntentRow>(`${intentSelect()} WHERE id = ?`).get(id);
}

function getCheckoutIntentByProviderId(
  db: AppDb,
  checkoutId: string,
): CheckoutIntentRow | undefined {
  return db
    .prepare<[string], CheckoutIntentRow>(`${intentSelect()} WHERE provider_checkout_id = ?`)
    .get(checkoutId);
}

function getCheckoutIntentByExternalId(
  db: AppDb,
  intentId: string,
): CheckoutIntentRow | undefined {
  return getCheckoutIntentById(db, intentId);
}

function getAcceptedEventByDelivery(
  db: AppDb,
  deliveryId: string,
): WaffoCheckoutEventRow | undefined {
  return db
    .prepare<[string], WaffoCheckoutEventRow>(
      "SELECT * FROM waffo_checkout_events WHERE delivery_id = ?",
    )
    .get(deliveryId);
}

function getAcceptedEventByIdentity(
  db: AppDb,
  field: "business_event_id" | "payment_id" | "order_id" | "intent_id",
  value: string,
): WaffoCheckoutEventRow | undefined {
  // Field names are fixed literals above, never request-controlled SQL.
  return db
    .prepare<[string], WaffoCheckoutEventRow>(
      `SELECT * FROM waffo_checkout_events WHERE ${field} = ?`,
    )
    .get(value);
}

function getAttemptByDeliveryHash(
  db: AppDb,
  deliveryId: string | undefined,
  payloadHash: string,
): WaffoWebhookAttemptRow | undefined {
  if (!deliveryId) return undefined;
  return db
    .prepare<[string, string], WaffoWebhookAttemptRow>(
      "SELECT attempt_id, delivery_id, payload_hash, event_fingerprint, outcome, reason FROM waffo_webhook_attempts WHERE delivery_id = ? AND payload_hash = ?",
    )
    .get(deliveryId, payloadHash);
}

function getAttemptByDelivery(
  db: AppDb,
  deliveryId: string,
): WaffoWebhookAttemptRow | undefined {
  return db
    .prepare<[string], WaffoWebhookAttemptRow>(
      "SELECT attempt_id, delivery_id, payload_hash, event_fingerprint, outcome, reason FROM waffo_webhook_attempts WHERE delivery_id = ? ORDER BY received_at ASC LIMIT 1",
    )
    .get(deliveryId);
}

function getAttemptByBusinessEvent(
  db: AppDb,
  businessEventId: string,
): WaffoWebhookAttemptRow | undefined {
  return db
    .prepare<[string], WaffoWebhookAttemptRow>(
      "SELECT attempt_id, delivery_id, payload_hash, event_fingerprint, outcome, reason FROM waffo_webhook_attempts WHERE business_event_id = ? ORDER BY received_at ASC LIMIT 1",
    )
    .get(businessEventId);
}

function recordWebhookAttempt(
  db: AppDb,
  input: {
    deliveryId?: string;
    eventType?: string;
    businessEventId?: string;
    paymentId?: string;
    orderId?: string;
    intentId?: string;
    payloadHash: string;
    eventFingerprint?: string;
    outcome: "rejected" | "needs_reconciliation";
    reason: string;
  },
): void {
  const existing = getAttemptByDeliveryHash(db, input.deliveryId, input.payloadHash);
  if (existing) return;
  db.prepare(
    `INSERT INTO waffo_webhook_attempts (
       attempt_id, delivery_id, event_type, business_event_id, payment_id,
       order_id, intent_id, payload_hash, event_fingerprint, outcome, reason, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.deliveryId ?? null,
    input.eventType ?? null,
    input.businessEventId ?? null,
    input.paymentId ?? null,
    input.orderId ?? null,
    input.intentId ?? null,
    input.payloadHash,
    input.eventFingerprint ?? null,
    input.outcome,
    input.reason,
    new Date().toISOString(),
  );
}

function sessionFromIntent(intent: CheckoutIntentRow): WaffoCheckoutRecord {
  // A signed completion is authoritative even when the create-session
  // response was lost after Waffo accepted the request. Ranking uses only the
  // immutable local intent fields below; checkoutId is informational here.
  return {
    intentId: intent.id,
    intentFingerprint: intent.intent_fingerprint,
    episodeId: intent.episode_id,
    listingId: intent.listing_id,
    chargeCents: intent.charge_cents,
    quoteBaseCents: intent.quote_base_cents,
    targetBidCents: intent.target_bid_cents,
    kind: intent.kind,
    name: intent.name,
    siteUrl: intent.site_url,
    oneLiner: intent.one_liner,
    checkoutId: intent.provider_checkout_id ?? "",
    url: intent.provider_checkout_url ?? "",
    expiresAt: intent.provider_expires_at ?? undefined,
    status: intent.status === "paid" ? "paid" : "pending",
  };
}

function parseBidUsd(raw: unknown): number {
  if (typeof raw === "boolean") {
    throw new CheckoutError("invalid_bid", "bid must be a whole-dollar USD amount");
  }
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      throw new CheckoutError("invalid_bid", "bid must be a whole-dollar USD amount");
    }
    return raw;
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CheckoutError("invalid_bid", "bid must be a whole-dollar USD amount");
  }
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new CheckoutError("invalid_bid", "bid must be a whole-dollar USD amount");
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new CheckoutError("invalid_bid", "bid must be a whole-dollar USD amount");
  }
  return parsed;
}

export type CheckoutDraft = {
  episodeId: string;
  listingId: string;
  name: string;
  siteUrl: string;
  oneLiner: string;
  quote: BidQuote;
};

export function quoteCheckout(db: AppDb, body: CheckoutBody): CheckoutDraft {
  const episodeId = readString(body.episodeId);
  const name = readString(body.name);
  const rawSiteUrl = readString(body.siteUrl);
  const oneLiner = readString(body.oneLiner);
  if (!episodeId) throw new CheckoutError("invalid_checkout", "episodeId is required");
  if (!name) throw new CheckoutError("invalid_checkout", "name is required");
  if (!rawSiteUrl) throw new CheckoutError("invalid_checkout", "siteUrl is required");
  if (!oneLiner) throw new CheckoutError("invalid_checkout", "oneLiner is required");
  if (/[\r\n]/.test(oneLiner) || oneLiner.length > 140) {
    throw new CheckoutError("invalid_checkout", "oneLiner must be a single line of at most 140 characters");
  }
  const episode = getEpisode(db, episodeId);
  if (!episode) throw new CheckoutError("episode_not_found", "episode not found", 404);
  if (episode.lockedAt) throw new CheckoutError("episode_locked", "episode is locked", 409);
  const siteUrl = canonicalizeSiteUrl(rawSiteUrl);
  const bidUsd = parseBidUsd(body.bidUsd);
  const listings = listListingsForEpisode(db, episodeId);
  const now = new Date();
  const existing = raiseableListing(listings, siteUrl, episodeId, now);
  const listingIdHint = readString(body.listingId);
  if (existing) {
    if (listingIdHint !== undefined && listingIdHint !== existing.id) {
      throw new RankError("full_bid_required", "other bidders pay a full new bid");
    }
    const quote = quoteRaise(existing, bidUsd, listings, episodeId, now);
    return {
      episodeId,
      listingId: existing.id,
      name: existing.name,
      siteUrl: existing.siteUrl,
      oneLiner: existing.oneLiner,
      quote,
    };
  }
  if (listingIdHint !== undefined) {
    throw new RankError("full_bid_required", "other bidders pay a full new bid");
  }
  return {
    episodeId,
    listingId: `lst_${randomUUID()}`,
    name,
    siteUrl,
    oneLiner,
    quote: quoteOpenBid(bidUsd),
  };
}

export async function startCheckout(
  db: AppDb,
  waffo: WaffoPort,
  body: CheckoutBody,
): Promise<{ checkoutId: string; url: string; kind: BidQuote["kind"]; chargeUsd: number }> {
  const draft = quoteCheckout(db, body);
  const values = selectProviderValues(waffo);
  const intentId = `intent_${randomUUID()}`;
  const { fingerprint } = insertCheckoutIntent(db, intentId, draft, values);
  let created: { checkoutId: string; url: string; expiresAt?: string };
  try {
    created = await waffo.createCheckout({
      intentId,
      intentFingerprint: fingerprint,
      episodeId: draft.episodeId,
      listingId: draft.listingId,
      chargeCents: usdToCents(draft.quote.chargeUsd),
      quoteBaseCents: usdToCents(draft.quote.nextUsd) - usdToCents(draft.quote.chargeUsd),
      targetBidCents: usdToCents(draft.quote.nextUsd),
      kind: draft.quote.kind,
      name: draft.name,
      siteUrl: draft.siteUrl,
      oneLiner: draft.oneLiner,
    });
    bindProviderCheckout(db, intentId, created);
  } catch (error) {
    markCheckoutIntentProviderFailure(db, intentId, error);
    throw error;
  }
  return {
    checkoutId: created.checkoutId,
    url: created.url,
    kind: draft.quote.kind,
    chargeUsd: draft.quote.chargeUsd,
  };
}

function paidAtNow(): string {
  return new Date().toISOString();
}

export function claimPaidCheckout(
  db: AppDb,
  session: WaffoCheckoutRecord,
  paidAt: string = paidAtNow(),
): Listing {
  const episode = getEpisode(db, session.episodeId);
  if (!episode) throw new CheckoutError("episode_not_found", "episode not found", 404);
  if (episode.lockedAt) throw new CheckoutError("episode_locked", "episode is locked", 409);
  if (session.kind === "raise") {
    return applyPaidRaise(db, {
      episodeId: session.episodeId,
      listingId: session.listingId,
      siteUrl: session.siteUrl,
      newTotalUsd: session.targetBidCents / 100,
      paidAt,
    }).listing;
  }
  return applyPaidOpen(db, {
    id: session.listingId,
    episodeId: session.episodeId,
    name: session.name,
    siteUrl: session.siteUrl,
    oneLiner: session.oneLiner,
    bidUsd: session.targetBidCents / 100,
    firstBidAt: paidAt,
    paidAt,
  }).listing;
}

function invalidWebhook(message = "invalid Waffo webhook"): CheckoutError {
  return new CheckoutError("invalid_webhook", message, 400);
}

const MAX_PROVIDER_EVENT_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const MAX_PROVIDER_EVENT_FUTURE_MS = 5 * 60 * 1000;

function parseProviderEventTimestamp(value: unknown): number | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  if (new Date(timestamp).toISOString() !== value) return undefined;
  const now = Date.now();
  if (
    timestamp < now - MAX_PROVIDER_EVENT_AGE_MS ||
    timestamp > now + MAX_PROVIDER_EVENT_FUTURE_MS
  ) {
    return undefined;
  }
  return timestamp;
}

function eventRecord(event: WaffoWebhook): Record<string, unknown> {
  return event as unknown as Record<string, unknown>;
}

function dataRecord(event: WaffoWebhook): Record<string, unknown> | undefined {
  const data = readAlias(eventRecord(event), "data");
  return isRecord(data) ? data : undefined;
}

function modeFromEvent(value: unknown): WaffoMode | undefined {
  if (value === "test") return "waffo-test";
  if (value === "prod") return "waffo-prod";
  if (value === "fixture") return "fixture";
  return undefined;
}

function auditFieldsFromRawBody(rawBody: Buffer): {
  deliveryId?: string;
  eventType?: string;
  businessEventId?: string;
  paymentId?: string;
  orderId?: string;
  intentId?: string;
  eventFingerprint?: string;
} {
  try {
    const raw = parseRawWebhookBody(rawBody);
    const data = isRecord(presentAlias(raw, "data").value)
      ? (presentAlias(raw, "data").value as Record<string, unknown>)
      : undefined;
    return {
      deliveryId: readString(readAlias(raw, "id")),
      eventType: readString(readAlias(raw, "eventType", "event_type")),
      businessEventId: readString(readAlias(raw, "eventId", "event_id")),
      paymentId: data ? readString(readAlias(data, "paymentId", "payment_id")) : undefined,
      orderId: data ? readString(readAlias(data, "orderId", "order_id")) : undefined,
      intentId: data
        ? readString(readAlias(data, "orderMerchantExternalId", "order_merchant_external_id"))
        : undefined,
      eventFingerprint: sha256(canonicalBusinessPayload(rawBody)),
    };
  } catch {
    return {};
  }
}

function parseVerifiedWaffoOrderCompleted(
  rawBody: Buffer,
  waffo: WaffoPort,
  signature: string | undefined,
): VerifiedWaffoOrderCompleted {
  let verified: WaffoWebhook;
  try {
    // The port delegates to the official RSA verifier. rawBody is converted
    // only after capture; no parsed/re-serialized JSON is ever verified.
    verified = waffo.verifyWebhook(rawBody.toString("utf8"), signature);
  } catch {
    throw new WebhookVerificationError();
  }
  const businessPayload = canonicalBusinessPayload(rawBody);
  const rawTop = parseRawWebhookBody(rawBody);
  const rawDataField = presentAlias(rawTop, "data");
  const rawData = isRecord(rawDataField.value) ? rawDataField.value : undefined;
  const top = eventRecord(verified);
  const data = dataRecord(verified);
  const deliveryField = presentAlias(rawTop, "id");
  const eventTypeField = presentAlias(rawTop, "eventType", "event_type");
  const businessEventField = presentAlias(rawTop, "eventId", "event_id");
  const storeField = presentAlias(rawTop, "storeId", "store_id");
  const modeField = presentAlias(rawTop, "mode");
  const timestampField = presentAlias(rawTop, "timestamp");
  const deliveryId = readProviderString(deliveryField.value) ?? readProviderString(readAlias(top, "id"));
  const eventType = readProviderString(eventTypeField.value) ?? readProviderString(readAlias(top, "eventType", "event_type"));
  const businessEventId = readProviderString(businessEventField.value) ?? readProviderString(readAlias(top, "eventId", "event_id"));
  const storeId = readProviderString(storeField.value) ?? readProviderString(readAlias(top, "storeId", "store_id"));
  const mode = modeFromEvent(modeField.present ? modeField.value : readAlias(top, "mode"));
  const eventTimestamp = readProviderString(timestampField.value) ?? readProviderString(readAlias(top, "timestamp"));
  const eventMs = parseProviderEventTimestamp(eventTimestamp);
  if (
    !deliveryField.present || typeof deliveryField.value !== "string" || !deliveryId ||
    !eventTypeField.present || typeof eventTypeField.value !== "string" || !eventType ||
    !businessEventField.present || typeof businessEventField.value !== "string" || !businessEventId ||
    !storeField.present || typeof storeField.value !== "string" || !storeId ||
    !modeField.present || !mode ||
    !timestampField.present || typeof timestampField.value !== "string" || !eventTimestamp ||
    eventMs === undefined
  ) {
    throw invalidWebhook("Waffo event identity is incomplete");
  }
  if (eventType !== "order.completed") {
    throw invalidWebhook("only order.completed can settle a checkout");
  }
  if (!data || !rawDataField.present || !rawData) throw invalidWebhook("order.completed data is missing");
  const orderField = presentAlias(rawData, "orderId", "order_id");
  const paymentField = presentAlias(rawData, "paymentId", "payment_id");
  const intentField = presentAlias(rawData, "orderMerchantExternalId", "order_merchant_external_id");
  const orderStatusField = presentAlias(rawData, "orderStatus", "order_status");
  const paymentStatusField = presentAlias(rawData, "paymentStatus", "payment_status");
  const buyerEmailField = presentAlias(rawData, "buyerEmail", "buyer_email");
  const productNameField = presentAlias(rawData, "productName", "product_name");
  const currencyField = presentAlias(rawData, "currency");
  const metadataField = presentAlias(rawData, "orderMetadata", "order_metadata");
  const amountField = presentAlias(rawData, "amount");
  const subtotalField = presentAlias(rawData, "subtotal");
  const taxField = presentAlias(rawData, "taxAmount", "tax_amount");
  const totalField = presentAlias(rawData, "total");
  const checkoutField = presentAlias(rawData, "checkoutId", "checkout_id");
  const productField = presentAlias(rawData, "productId", "product_id");
  const orderId = readProviderString(orderField.value) ?? readProviderString(readAlias(data, "orderId", "order_id"));
  const paymentId = readProviderString(paymentField.value) ?? readProviderString(readAlias(data, "paymentId", "payment_id"));
  const intentId = readProviderString(intentField.value) ?? readProviderString(readAlias(data, "orderMerchantExternalId", "order_merchant_external_id"));
  const orderStatus = readProviderString(orderStatusField.value) ?? readProviderString(readAlias(data, "orderStatus", "order_status"));
  const paymentStatus = readProviderString(paymentStatusField.value) ?? readProviderString(readAlias(data, "paymentStatus", "payment_status"));
  const buyerEmail = readProviderString(buyerEmailField.value) ?? readProviderString(readAlias(data, "buyerEmail", "buyer_email"));
  const productName = readProviderString(productNameField.value) ?? readProviderString(readAlias(data, "productName", "product_name"));
  const currency = readProviderString(currencyField.value) ?? readProviderString(readAlias(data, "currency"));
  const metadata = metadataRecord(metadataField.value);
  const amountCents = parseDisplayCents(amountField.value);
  const subtotalRaw = subtotalField.value;
  const subtotalPresent = subtotalField.present;
  const subtotalCents =
    subtotalPresent ? parseDisplayCents(subtotalRaw) : undefined;
  const taxCents = parseDisplayCents(taxField.value);
  const totalPresent = totalField.present;
  const totalCents = totalPresent ? parseDisplayCents(totalField.value) : undefined;
  const checkoutId = checkoutField.present ? readProviderString(checkoutField.value) : undefined;
  const productId = productField.present ? readProviderString(productField.value) : undefined;
  if (
    deliveryField.conflict || eventTypeField.conflict || businessEventField.conflict ||
    storeField.conflict || modeField.conflict || timestampField.conflict ||
    orderField.conflict || paymentField.conflict || intentField.conflict ||
    orderStatusField.conflict || paymentStatusField.conflict || buyerEmailField.conflict ||
    productNameField.conflict || currencyField.conflict || metadataField.conflict ||
    amountField.conflict || subtotalField.conflict || taxField.conflict || totalField.conflict ||
    checkoutField.conflict || productField.conflict ||
    !orderField.present || typeof orderField.value !== "string" || !orderId ||
    !paymentField.present || typeof paymentField.value !== "string" || !paymentId ||
    !intentField.present || typeof intentField.value !== "string" || !intentId ||
    !orderStatusField.present || typeof orderStatusField.value !== "string" ||
    !paymentStatusField.present || typeof paymentStatusField.value !== "string" ||
    !buyerEmailField.present || typeof buyerEmailField.value !== "string" || !buyerEmail ||
    !productNameField.present || typeof productNameField.value !== "string" || !productName ||
    !currencyField.present || typeof currencyField.value !== "string" ||
    !amountField.present || typeof amountField.value !== "string" || amountCents === undefined ||
    !taxField.present || typeof taxField.value !== "string" || taxCents === undefined ||
    !metadataField.present ||
    (subtotalField.present && subtotalCents === undefined) ||
    (totalField.present && totalCents === undefined) ||
    (checkoutField.present && (!checkoutId || typeof checkoutField.value !== "string")) ||
    (productField.present && (!productId || typeof productField.value !== "string")) ||
    businessEventId !== paymentId ||
    orderStatus !== "completed" ||
    paymentStatus !== "succeeded" ||
    currency !== "USD" ||
    !metadata ||
    !data
  ) {
    throw invalidWebhook("order.completed is missing reconciliation fields");
  }
  const partial = {
    deliveryId,
    eventType: "order.completed" as const,
    businessEventId,
    paymentId,
    orderId,
    intentId,
    mode,
    storeId,
    eventTimestamp: new Date(eventMs).toISOString(),
    payloadHash: sha256(rawBody.toString("utf8")),
    businessPayload,
    metadata,
    amountCents,
    subtotalCents,
    subtotalPresent,
    taxCents,
    totalCents,
    totalPresent,
    checkoutId,
    checkoutIdPresent: checkoutField.present,
    productId,
    productIdPresent: productField.present,
    buyerEmail,
    productName,
  };
  return { ...partial, eventFingerprint: eventFingerprint(partial) };
}

function listingForIntent(db: AppDb, intent: CheckoutIntentRow): Listing | undefined {
  return listListingsForEpisode(db, intent.episode_id).find((listing) => listing.id === intent.listing_id);
}

function updateIntentReconciliation(
  db: AppDb,
  intent: CheckoutIntentRow,
  reason: string,
): void {
  db.prepare(
    `UPDATE checkout_intents
        SET status = 'needs_reconciliation', failure_code = ?, updated_at = ?
      WHERE id = ? AND status IN ('creating', 'open', 'unknown')`,
  ).run(reason, new Date().toISOString(), intent.id);
}

function markIntentPaid(
  db: AppDb,
  intent: CheckoutIntentRow,
  payment: VerifiedWaffoOrderCompleted,
): void {
  const result = db
    .prepare(
      `UPDATE checkout_intents
          SET status = 'paid', paid_at = ?, provider_order_id = ?,
              provider_payment_id = ?, failure_code = NULL, updated_at = ?
        WHERE id = ? AND status IN ('creating', 'open', 'unknown', 'paid')`,
    )
    .run(
      payment.eventTimestamp,
      payment.orderId,
      payment.paymentId,
      new Date().toISOString(),
      intent.id,
    );
  if (result.changes !== 1) {
    throw new CheckoutError("checkout_not_open", "checkout intent is no longer payable", 409);
  }
}

function recordAcceptedEvent(
  db: AppDb,
  payment: VerifiedWaffoOrderCompleted,
): void {
  db.prepare(
    `INSERT INTO waffo_checkout_events (
       delivery_id, event_type, business_event_id, payment_id, order_id,
       intent_id, mode, store_id, payload_hash, event_fingerprint,
       business_payload, business_payload_version, outcome, reason,
       event_timestamp, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', NULL, ?, ?)`,
  ).run(
    payment.deliveryId,
    payment.eventType,
    payment.businessEventId,
    payment.paymentId,
    payment.orderId,
    payment.intentId,
    payment.mode,
    payment.storeId,
    payment.payloadHash,
    payment.eventFingerprint,
    payment.businessPayload ?? "",
    payment.businessPayload === undefined ? 0 : 1,
    payment.eventTimestamp,
    new Date().toISOString(),
  );
}

function replayMatchesAcceptedEvent(
  event: WaffoCheckoutEventRow,
  payment: VerifiedWaffoOrderCompleted,
): boolean {
  // New rows carry the complete canonical payload. Rows accepted before
  // migration 004 have version 0 and an empty payload; compare them against
  // the exact version-0 projection that produced their stored fingerprint.
  // Once an exact retry is observed, backfill the full payload below so future
  // retries can reject changes to fields the legacy projection did not retain.
  const version = event.business_payload_version ?? 0;
  if (version >= 1) {
    return event.business_payload !== "" && event.business_payload === payment.businessPayload;
  }
  return event.business_payload === "" && event.event_fingerprint === legacyEventFingerprint(payment);
}

function backfillLegacyBusinessPayload(
  db: AppDb,
  event: WaffoCheckoutEventRow,
  payment: VerifiedWaffoOrderCompleted,
): void {
  if (
    (event.business_payload_version ?? 0) !== 0 ||
    event.business_payload !== "" ||
    payment.businessPayload === undefined
  ) {
    return;
  }
  const result = db
    .prepare(
      `UPDATE waffo_checkout_events
          SET business_payload = ?, business_payload_version = 1
        WHERE delivery_id = ? AND business_payload = ''
          AND business_payload_version = 0 AND event_fingerprint = ?`,
    )
    .run(payment.businessPayload, event.delivery_id, event.event_fingerprint);
  if (result.changes !== 1) {
    throw new Error("legacy Waffo replay backfill could not be persisted");
  }
}

function existingEventResult(
  db: AppDb,
  payment: VerifiedWaffoOrderCompleted,
  event: WaffoCheckoutEventRow,
): WaffoSettlementResult {
  if (replayMatchesAcceptedEvent(event, payment)) {
    backfillLegacyBusinessPayload(db, event, payment);
    const intent = getCheckoutIntentById(db, event.intent_id);
    const listing = intent ? listingForIntent(db, intent) : undefined;
    if (listing) return { status: "already_paid", alreadyPaid: true, listing };
    recordWebhookAttempt(db, {
      deliveryId: payment.deliveryId,
      eventType: payment.eventType,
      businessEventId: payment.businessEventId,
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      intentId: payment.intentId,
      payloadHash: payment.payloadHash,
      eventFingerprint: payment.eventFingerprint,
      outcome: "rejected",
      reason: "accepted payment has no listing",
    });
    return { status: "rejected", alreadyPaid: false, reason: "payment_not_applied" };
  }
  recordWebhookAttempt(db, {
    deliveryId: payment.deliveryId,
    eventType: payment.eventType,
    businessEventId: payment.businessEventId,
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    intentId: payment.intentId,
    payloadHash: payment.payloadHash,
    eventFingerprint: payment.eventFingerprint,
    outcome: "rejected",
    reason: "changed replay for an existing Waffo identity",
  });
  return { status: "rejected", alreadyPaid: false, reason: "changed_replay" };
}

function metadataMatchesIntent(
  intent: CheckoutIntentRow,
  payment: VerifiedWaffoOrderCompleted,
): boolean {
  const expected: Record<string, string> = {
    ...expectedMetadataForIntent(intent),
    intentFingerprint: intent.intent_fingerprint,
  };
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(payment.metadata).sort();
  // Provider metadata is an authenticated projection of the immutable local
  // intent. Every key and every value must match; a merely matching subset is
  // unsafe because an attacker could append a second business projection.
  return (
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every((key, index) => key === actualKeys[index]) &&
    stableJson(payment.metadata) === stableJson(expected)
  );
}

function validateMoney(
  intent: CheckoutIntentRow,
  payment: VerifiedWaffoOrderCompleted,
): string | undefined {
  if (payment.taxCents < 0) return "invalid tax amount";
  const subtotalPresent = payment.subtotalPresent ?? payment.subtotalCents !== undefined;
  const totalPresent = payment.totalPresent ?? payment.totalCents !== undefined;
  if (subtotalPresent && payment.subtotalCents === undefined) {
    return "subtotal is malformed";
  }
  if (totalPresent && payment.totalCents === undefined) {
    return "total is malformed";
  }
  if (subtotalPresent) {
    if (payment.subtotalCents !== intent.charge_cents) return "subtotal does not match quote";
    if (!totalPresent || payment.totalCents === undefined) return "total is required when subtotal is present";
    if (payment.totalCents !== payment.subtotalCents + payment.taxCents) {
      return "total does not match subtotal and tax";
    }
    if (payment.amountCents !== payment.totalCents) return "amount does not match total";
    return undefined;
  }
  if (payment.taxCents !== 0 || payment.amountCents !== intent.charge_cents) {
    return "amount without subtotal must equal a tax-free quote";
  }
  if (totalPresent) {
    if (payment.totalCents === undefined) return "total is malformed";
    if (payment.totalCents !== intent.charge_cents) return "total does not match quote";
    if (payment.amountCents !== payment.totalCents) return "amount does not match total";
  }
  return undefined;
}

function paymentMatchesIntent(
  intent: CheckoutIntentRow,
  payment: VerifiedWaffoOrderCompleted,
): string | undefined {
  if (intent.id !== payment.intentId) return "external intent ID does not match";
  const expectedEventMode = intent.mode === "waffo-test" ? "waffo-test" : intent.mode === "waffo-prod" ? "waffo-prod" : "fixture";
  if (payment.mode !== expectedEventMode) return "event mode does not match checkout mode";
  if (payment.storeId !== intent.expected_store_id) return "store ID does not match checkout";
  if (!metadataMatchesIntent(intent, payment)) return "order metadata does not match checkout intent";
  if (payment.productIdPresent && payment.productId !== intent.expected_product_id) {
    return "product ID does not match checkout intent";
  }
  if (payment.checkoutIdPresent && !payment.checkoutId) {
    return "checkout session is malformed";
  }
  // A missing checkout id is the documented lost-response recovery path. A
  // present id cannot be trusted when the create response never durably
  // attached one, so require the known immutable id in that case.
  if (payment.checkoutIdPresent && !intent.provider_checkout_id) {
    return "checkout session is not known locally";
  }
  if (payment.checkoutIdPresent && intent.provider_checkout_id && payment.checkoutId !== intent.provider_checkout_id) {
    return "checkout session does not match checkout intent";
  }
  return validateMoney(intent, payment);
}

export type WaffoSettlementResult = {
  status: "paid" | "already_paid" | "rejected" | "needs_reconciliation";
  listing?: Listing;
  alreadyPaid: boolean;
  reason?: string;
};

/**
 * Apply a cryptographically verified order.completed and its receipt in one
 * immediate transaction. No provider session map is consulted, so a restart
 * or a second process can safely recover from the durable intent.
 */
export function settleVerifiedWaffoOrder(
  db: AppDb,
  payment: VerifiedWaffoOrderCompleted,
): WaffoSettlementResult {
  const transaction = db.transaction((): WaffoSettlementResult => {
    const attempted = getAttemptByDeliveryHash(db, payment.deliveryId, payment.payloadHash);
    if (attempted) {
      return {
        status: attempted.outcome,
        alreadyPaid: false,
        reason: attempted.reason,
      };
    }
    if (payment.deliveryId) {
      const priorDelivery = getAttemptByDelivery(db, payment.deliveryId);
      if (priorDelivery) {
        if (priorDelivery.payload_hash === payment.payloadHash) {
          return {
            status: priorDelivery.outcome,
            alreadyPaid: false,
            reason: priorDelivery.reason,
          };
        }
        recordWebhookAttempt(db, {
          deliveryId: payment.deliveryId,
          eventType: payment.eventType,
          businessEventId: payment.businessEventId,
          paymentId: payment.paymentId,
          orderId: payment.orderId,
          intentId: payment.intentId,
          payloadHash: payment.payloadHash,
          eventFingerprint: payment.eventFingerprint,
          outcome: "rejected",
          reason: "changed replay for an existing Waffo delivery",
        });
        return { status: "rejected", alreadyPaid: false, reason: "changed_replay" };
      }
    }
    const priorBusinessAttempt = getAttemptByBusinessEvent(db, payment.businessEventId);
    if (priorBusinessAttempt) {
      if (priorBusinessAttempt.event_fingerprint === payment.eventFingerprint) {
        return {
          status: priorBusinessAttempt.outcome,
          alreadyPaid: false,
          reason: priorBusinessAttempt.reason,
        };
      }
      recordWebhookAttempt(db, {
        deliveryId: payment.deliveryId,
        eventType: payment.eventType,
        businessEventId: payment.businessEventId,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        intentId: payment.intentId,
        payloadHash: payment.payloadHash,
        eventFingerprint: payment.eventFingerprint,
        outcome: "rejected",
        reason: "changed replay for an existing Waffo business event",
      });
      return { status: "rejected", alreadyPaid: false, reason: "changed_replay" };
    }
    const eventByDelivery = getAcceptedEventByDelivery(db, payment.deliveryId);
    if (eventByDelivery) return existingEventResult(db, payment, eventByDelivery);
    if (payment.businessEventId !== payment.paymentId) {
      recordWebhookAttempt(db, {
        deliveryId: payment.deliveryId,
        eventType: payment.eventType,
        businessEventId: payment.businessEventId,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        intentId: payment.intentId,
        payloadHash: payment.payloadHash,
        eventFingerprint: payment.eventFingerprint,
        outcome: "rejected",
        reason: "business event ID must equal payment ID",
      });
      return { status: "rejected", alreadyPaid: false, reason: "payment_mismatch" };
    }
    for (const [field, value] of [
      ["business_event_id", payment.businessEventId],
      ["payment_id", payment.paymentId],
      ["order_id", payment.orderId],
      ["intent_id", payment.intentId],
    ] as const) {
      const event = getAcceptedEventByIdentity(db, field, value);
      if (event) {
        if (replayMatchesAcceptedEvent(event, payment)) {
          backfillLegacyBusinessPayload(db, event, payment);
          const intent = getCheckoutIntentById(db, event.intent_id);
          const listing = intent ? listingForIntent(db, intent) : undefined;
          if (listing) return { status: "already_paid", alreadyPaid: true, listing };
        }
        recordWebhookAttempt(db, {
          deliveryId: payment.deliveryId,
          eventType: payment.eventType,
          businessEventId: payment.businessEventId,
          paymentId: payment.paymentId,
          orderId: payment.orderId,
          intentId: payment.intentId,
          payloadHash: payment.payloadHash,
          eventFingerprint: payment.eventFingerprint,
          outcome: "rejected",
          reason: "changed replay for an existing Waffo identity",
        });
        return { status: "rejected", alreadyPaid: false, reason: "changed_replay" };
      }
    }

    const intent = getCheckoutIntentByExternalId(db, payment.intentId);
    if (!intent) {
      recordWebhookAttempt(db, {
        deliveryId: payment.deliveryId,
        eventType: payment.eventType,
        businessEventId: payment.businessEventId,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        intentId: payment.intentId,
        payloadHash: payment.payloadHash,
        eventFingerprint: payment.eventFingerprint,
        outcome: "rejected",
        reason: "unknown local checkout intent",
      });
      return { status: "rejected", alreadyPaid: false, reason: "unknown_checkout" };
    }
    const mismatch = paymentMatchesIntent(intent, payment);
    if (mismatch) {
      // A verified event tied to a known intent may represent captured money,
      // even when its facts do not reconcile. Quarantine the immutable intent
      // before recording the delivery so a second payment cannot bypass the
      // conflict and claim the same board seat.
      updateIntentReconciliation(db, intent, mismatch);
      recordWebhookAttempt(db, {
        deliveryId: payment.deliveryId,
        eventType: payment.eventType,
        businessEventId: payment.businessEventId,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        intentId: payment.intentId,
        payloadHash: payment.payloadHash,
        eventFingerprint: payment.eventFingerprint,
        outcome: "needs_reconciliation",
        reason: mismatch,
      });
      return { status: "needs_reconciliation", alreadyPaid: false, reason: "payment_mismatch" };
    }
    if (intent.status === "rejected") {
      recordWebhookAttempt(db, {
        deliveryId: payment.deliveryId,
        eventType: payment.eventType,
        businessEventId: payment.businessEventId,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        intentId: payment.intentId,
        payloadHash: payment.payloadHash,
        eventFingerprint: payment.eventFingerprint,
        outcome: "rejected",
        reason: "rejected checkout cannot settle",
      });
      return { status: "rejected", alreadyPaid: false, reason: "checkout_not_open" };
    }
    if (intent.status === "paid") {
      const listing = listingForIntent(db, intent);
      if (listing) {
        if (
          intent.provider_order_id !== payment.orderId ||
          intent.provider_payment_id !== payment.paymentId
        ) {
          recordWebhookAttempt(db, {
            deliveryId: payment.deliveryId,
            eventType: payment.eventType,
            businessEventId: payment.businessEventId,
            paymentId: payment.paymentId,
            orderId: payment.orderId,
            intentId: payment.intentId,
            payloadHash: payment.payloadHash,
            eventFingerprint: payment.eventFingerprint,
            outcome: "rejected",
            reason: "paid intent is tied to another provider payment",
          });
          return { status: "rejected", alreadyPaid: false, reason: "payment_mismatch" };
        }
        // A crash cannot leave a paid status without the event because both
        // writes are in this transaction, but this remains a safe repair path.
        return { status: "already_paid", alreadyPaid: true, listing };
      }
    }
    if (!["creating", "open", "unknown"].includes(intent.status)) {
      updateIntentReconciliation(db, intent, "checkout is not payable");
      recordWebhookAttempt(db, {
        deliveryId: payment.deliveryId,
        eventType: payment.eventType,
        businessEventId: payment.businessEventId,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        intentId: payment.intentId,
        payloadHash: payment.payloadHash,
        eventFingerprint: payment.eventFingerprint,
        outcome: "needs_reconciliation",
        reason: "checkout is not payable",
      });
      return { status: "needs_reconciliation", alreadyPaid: false, reason: "checkout_not_open" };
    }
    // Keep the rank mutation and both payment writes atomic even when a
    // downstream unique constraint or persistence error occurs. The outer
    // transaction then records the reconciliation outcome after rolling the
    // savepoint back, so a captured payment can never leave an unreceipted
    // listing on the board.
    db.exec("SAVEPOINT waffo_settlement_apply");
    try {
      const listing = claimPaidCheckout(db, sessionFromIntent(intent), payment.eventTimestamp);
      markIntentPaid(db, intent, payment);
      recordAcceptedEvent(db, payment);
      db.exec("RELEASE SAVEPOINT waffo_settlement_apply");
      return { status: "paid", alreadyPaid: false, listing };
    } catch (error) {
      db.exec("ROLLBACK TO SAVEPOINT waffo_settlement_apply");
      db.exec("RELEASE SAVEPOINT waffo_settlement_apply");
      const reason = error instanceof Error ? error.message : "ranking application failed";
      updateIntentReconciliation(db, intent, reason);
      recordWebhookAttempt(db, {
        deliveryId: payment.deliveryId,
        eventType: payment.eventType,
        businessEventId: payment.businessEventId,
        paymentId: payment.paymentId,
        orderId: payment.orderId,
        intentId: payment.intentId,
        payloadHash: payment.payloadHash,
        eventFingerprint: payment.eventFingerprint,
        outcome: "needs_reconciliation",
        reason,
      });
      return { status: "needs_reconciliation", alreadyPaid: false, reason: "ranking_application_failed" };
    }
  });
  return transaction.immediate();
}

function expectedMetadataForIntent(intent: CheckoutIntentRow): Record<string, string> {
  const expected = JSON.parse(intent.normalized_payload) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [key, String(value)]),
  );
}

function fixturePaymentForIntent(
  intent: CheckoutIntentRow,
  checkoutId: string,
  paidAt: string,
): VerifiedWaffoOrderCompleted {
  const metadata = {
    ...expectedMetadataForIntent(intent),
    intentFingerprint: intent.intent_fingerprint,
  };
  const paymentId = `fixture-payment:${checkoutId}`;
  const partial = {
    deliveryId: `fixture-delivery:${checkoutId}`,
    eventType: "order.completed" as const,
    businessEventId: paymentId,
    paymentId,
    orderId: `fixture-order:${checkoutId}`,
    intentId: intent.id,
    mode: "fixture" as const,
    storeId: intent.expected_store_id,
    eventTimestamp: paidAt,
    payloadHash: sha256(`fixture:${checkoutId}`),
    metadata,
    amountCents: intent.charge_cents,
    subtotalCents: intent.charge_cents,
    taxCents: 0,
    totalCents: intent.charge_cents,
    checkoutId,
  };
  return { ...partial, eventFingerprint: eventFingerprint(partial) };
}

export async function completePaidCheckout(
  db: AppDb,
  waffo: WaffoPort,
  checkoutId: string,
): Promise<{ listing: Listing; amountUsd: number; alreadyPaid: boolean }> {
  if (isProductionLike()) {
    throw new CheckoutError("webhook_only", "live Waffo checkout completes via webhook only", 409);
  }
  const intent = getCheckoutIntentByProviderId(db, checkoutId);
  if (!intent) throw new CheckoutError("unknown_checkout", "checkout not found", 404);
  if (intent.mode !== "fixture") {
    throw new CheckoutError("webhook_only", "live Waffo checkout completes via webhook only", 409);
  }
  const session = waffo.getCheckout(checkoutId);
  if (session && session.status !== "paid") {
    await waffo.completeCheckout(checkoutId);
  }
  // A fixture retry must have the same event timestamp/fingerprint. The
  // durable paid_at value is the source of truth after the first completion.
  const result = settleVerifiedWaffoOrder(
    db,
    fixturePaymentForIntent(intent, checkoutId, intent.paid_at ?? paidAtNow()),
  );
  if (!result.listing) {
    throw new CheckoutError(
      result.reason === "unknown_checkout" ? "unknown_checkout" : result.reason ?? "payment_incomplete",
      result.reason ?? "fixture payment was not applied",
      result.status === "needs_reconciliation" ? 409 : 400,
    );
  }
  return {
    listing: result.listing,
    amountUsd: intent.charge_cents / 100,
    alreadyPaid: result.alreadyPaid,
  };
}

export function extractCheckoutId(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const direct = readString(body.checkoutId) ?? readString(body.waffoCheckoutId);
  if (direct) return direct;
  const data = isRecord(body.data) ? body.data : undefined;
  return data ? readString(data.checkoutId) ?? readString(data.checkout_id) : undefined;
}

function wantsHtml(request: { headers: Record<string, unknown> }): boolean {
  const type = String(request.headers["content-type"] ?? "");
  const accept = String(request.headers.accept ?? "");
  return type.includes("application/x-www-form-urlencoded") ||
    (/\btext\/html\b/.test(accept) && !/\bapplication\/json\b/.test(accept));
}

function wantsJson(request: { headers: Record<string, unknown> }): boolean {
  return /\bapplication\/json\b/.test(String(request.headers.accept ?? ""));
}

function sendCheckoutStatus(
  reply: FastifyReply,
  intent: CheckoutIntentRow,
  asHtml: boolean,
): FastifyReply | object {
  if (asHtml) {
    return reply
      .code(200)
      .type("text/html; charset=utf-8")
      .send(
        renderCheckoutStatusHtml({
          intentId: intent.id,
          status: intent.status,
          checkoutUrl: intent.provider_checkout_url,
          listingId: intent.status === "paid" ? intent.listing_id : undefined,
        }),
      );
  }
  return {
    ok: true,
    intentId: intent.id,
    status: intent.status,
    listingId: intent.status === "paid" ? intent.listing_id : undefined,
  };
}

function sendCheckoutError(reply: FastifyReply, err: unknown, asHtml = false): FastifyReply {
  const statusAndCode = (() => {
    if (err instanceof CheckoutError) return { status: err.statusCode, code: err.code };
    if (err instanceof RankError || err instanceof HygieneError) return { status: 400, code: err.code };
    if (err instanceof WaffoProviderError) {
      return {
        status: err.state === "rejected" && err.status && err.status < 500 ? 400 : 503,
        code: err.state === "rejected" ? "waffo_checkout_rejected" : "waffo_unavailable",
      };
    }
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("BLOCKED-SECRET") || message.startsWith("BLOCKED-CONFIG")) {
      return { status: 503, code: "waffo_unavailable" };
    }
    return null;
  })();
  if (!statusAndCode) throw err;
  if (asHtml) {
    return reply.code(statusAndCode.status).type("text/html; charset=utf-8").send(renderCheckoutErrorHtml(statusAndCode.code));
  }
  return reply.code(statusAndCode.status).send({ error: statusAndCode.code });
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function settlementReply(reply: FastifyReply, result: WaffoSettlementResult): FastifyReply | object {
  if (result.listing && (result.status === "paid" || result.status === "already_paid")) {
    return {
      ok: true,
      status: result.status,
      listingId: result.listing.id,
    };
  }
  if (result.status === "needs_reconciliation") {
    // The signed delivery and its durable reconciliation outcome are owned by
    // this transaction. A 2xx tells Waffo not to redeliver forever; the board
    // remains unchanged until the operator reconciles the captured payment.
    return {
      ok: true,
      status: "needs_reconciliation",
      reason: result.reason,
    };
  }
  if (result.status === "rejected") {
    // A verified, durably recorded rejection is also terminal from the
    // provider's perspective. Verification failures and DB/audit failures
    // never reach this branch and remain non-2xx.
    return {
      ok: true,
      status: "rejected",
      reason: result.reason,
    };
  }
  const status = result.reason === "unknown_checkout" ? 404 : result.reason === "changed_replay" ? 409 : 400;
  return reply.code(status).send({ error: result.reason ?? "invalid_webhook" });
}

export const checkoutRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (request.url.split("?", 1)[0] !== WAFFO_WEBHOOK_PATH) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks);
    (request as RawWebhookRequest).rawBody = rawBody;
    return Readable.from([rawBody]);
  });

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      const raw = typeof body === "string" ? body : body.toString("utf8");
      done(null, Object.fromEntries(new URLSearchParams(raw)));
    },
  );

  app.post(CHECKOUT_PATH, async (request, reply) => {
    const body = (isRecord(request.body) ? request.body : {}) as CheckoutBody;
    const html = wantsHtml(request);
    try {
      const started = await startCheckout(app.db, app.waffo, body);
      if (html) return reply.redirect(started.url, 303);
      return {
        checkoutId: started.checkoutId,
        url: started.url,
        kind: started.kind,
        chargeUsd: started.chargeUsd,
      };
    } catch (error) {
      return sendCheckoutError(reply, error, html);
    }
  });

  app.get<{ Querystring: { checkoutId?: string; checkout_id?: string; intent?: string } }>(
    CHECKOUT_COMPLETE_PATH,
    async (request, reply) => {
      const checkoutId = readString(request.query.checkoutId) ?? readString(request.query.checkout_id);
      const intentId = readString(request.query.intent);
      // Waffo's configured callback carries the immutable local intent id.
      // Looking it up is deliberately read-only and works after a restart or
      // in a second instance; no browser return can settle a live payment.
      if (intentId && (!checkoutId || app.waffo.mode !== "fixture")) {
        const intent = getCheckoutIntentById(app.db, intentId);
        if (!intent) {
          if (wantsJson(request)) return reply.code(404).send({ error: "unknown_checkout" });
          return reply
            .code(404)
            .type("text/html; charset=utf-8")
            .send(renderCheckoutErrorHtml("unknown_checkout"));
        }
        return sendCheckoutStatus(reply, intent, !wantsJson(request));
      }
      if (!checkoutId) {
        if (wantsJson(request)) return reply.code(400).send({ error: "intent_required" });
        return reply
          .code(400)
          .type("text/html; charset=utf-8")
          .send(renderCheckoutErrorHtml("intent_required"));
      }
      if (app.waffo.mode !== "fixture" || isProductionLike()) {
        if (wantsJson(request)) return reply.code(409).send({ error: "webhook_only" });
        return reply
          .code(409)
          .type("text/html; charset=utf-8")
          .send(renderCheckoutErrorHtml("webhook_only"));
      }
      try {
        await completePaidCheckout(app.db, app.waffo, checkoutId);
      } catch (error) {
        if (error instanceof CheckoutError && error.code === "unknown_checkout") return reply.redirect("/", 303);
        return sendCheckoutError(reply, error);
      }
      return reply.redirect("/", 303);
    },
  );

  app.post(WAFFO_WEBHOOK_PATH, async (request, reply) => {
    if (app.waffo.mode === "fixture") {
      return reply.code(503).send({ error: "waffo_webhook_unavailable" });
    }
    const rawBody = (request as RawWebhookRequest).rawBody;
    if (!rawBody) return reply.code(400).send({ error: "invalid_webhook" });
    const payloadHash = sha256(rawBody.toString("utf8"));
    try {
      const payment = parseVerifiedWaffoOrderCompleted(
        rawBody,
        app.waffo,
        headerValue(request, "x-waffo-signature"),
      );
      return settlementReply(reply, settleVerifiedWaffoOrder(app.db, payment));
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        // Never persist identities extracted from an unverified body. A later
        // valid delivery must be able to use the same provider/payment/order
        // identifiers without being shadowed by invalid traffic.
        return sendCheckoutError(reply, error);
      }
      const audit = auditFieldsFromRawBody(rawBody);
      try {
        recordWebhookAttempt(app.db, {
          ...audit,
          payloadHash,
          outcome: "rejected",
          reason: error instanceof Error ? error.message : "invalid Waffo webhook",
        });
      } catch {
        // A rejection is only safe to acknowledge after its audit record is
        // durable. Let the framework return a 5xx when that write fails.
        return reply.code(503).send({ error: "webhook_audit_unavailable" });
      }
      return sendCheckoutError(reply, error);
    }
  });
};

// Re-export money helpers from the payment boundary for focused tests/tools.
export { centsToDisplayString, parseDisplayCents };
