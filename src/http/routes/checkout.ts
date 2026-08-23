import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { AppDb } from "../../db.js";
import { getEpisode } from "../../episodes.js";
import { canonicalizeSiteUrl, HygieneError } from "../../hygiene.js";
import {
  listListingsForEpisode,
  siteIdentity,
  type Listing,
} from "../../listings.js";
import {
  applyPaidOpen,
  applyPaidRaise,
  quoteOpenBid,
  quoteRaise,
  RankError,
  type BidQuote,
} from "../../rank.js";
import { FixturePolar } from "../../polar/fixture.js";
import { LivePolar } from "../../polar/live.js";
import {
  polarAccessToken,
  polarLiveEnabled,
  type PolarCheckoutRecord,
  type PolarEnv,
  type PolarPort,
} from "../../polar/port.js";
import { renderCheckoutErrorHtml } from "./pages.js";

/** POST /checkout starts Polar (or fixture) checkout for a bid / raise. */
export const CHECKOUT_PATH = "/checkout" as const;
export const CHECKOUT_COMPLETE_PATH = "/checkout/complete" as const;
export const POLAR_WEBHOOK_PATH = "/webhooks/polar" as const;

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

/** Fixture unless live is enabled. `POLAR_FIXTURE_ONLY=1` always wins. */
export function createPolarPort(env: PolarEnv = process.env): PolarPort {
  if (polarLiveEnabled(env)) {
    if (!polarAccessToken(env)) {
      throw new Error("BLOCKED-SECRET: POLAR_ACCESS_TOKEN");
    }
    return new LivePolar({ env });
  }
  return new FixturePolar();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseBidUsd(raw: unknown): number {
  if (typeof raw === "boolean") {
    throw new CheckoutError("invalid_bid", "bid must be a whole-dollar USD amount");
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
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
  return Number(trimmed);
}

function listingForIdentity(
  listings: readonly Listing[],
  siteUrl: string,
): Listing | undefined {
  const identity = siteIdentity(siteUrl);
  return listings.find((row) => siteIdentity(row.siteUrl) === identity);
}

export type CheckoutDraft = {
  episodeId: string;
  listingId: string;
  name: string;
  siteUrl: string;
  oneLiner: string;
  quote: BidQuote;
};

export function quoteCheckout(
  db: AppDb,
  body: CheckoutBody,
): CheckoutDraft {
  const episodeId = readString(body.episodeId);
  const name = readString(body.name);
  const rawSiteUrl = readString(body.siteUrl);
  const oneLiner = readString(body.oneLiner);
  if (!episodeId) {
    throw new CheckoutError("invalid_checkout", "episodeId is required");
  }
  if (!name) {
    throw new CheckoutError("invalid_checkout", "name is required");
  }
  if (!rawSiteUrl) {
    throw new CheckoutError("invalid_checkout", "siteUrl is required");
  }
  if (!oneLiner) {
    throw new CheckoutError("invalid_checkout", "oneLiner is required");
  }
  if (/[\r\n]/.test(oneLiner) || oneLiner.length > 140) {
    throw new CheckoutError(
      "invalid_checkout",
      "oneLiner must be a single line of at most 140 characters",
    );
  }
  const episode = getEpisode(db, episodeId);
  if (!episode) {
    throw new CheckoutError("episode_not_found", "episode not found", 404);
  }
  if (episode.lockedAt) {
    throw new CheckoutError("episode_locked", "episode is locked", 409);
  }
  const siteUrl = canonicalizeSiteUrl(rawSiteUrl);

  const bidUsd = parseBidUsd(body.bidUsd);
  const listings = listListingsForEpisode(db, episodeId);
  const existing = listingForIdentity(listings, siteUrl);
  const listingIdHint = readString(body.listingId);

  if (existing) {
    if (listingIdHint !== undefined && listingIdHint !== existing.id) {
      throw new RankError("full_bid_required", "other bidders pay a full new bid");
    }
    const quote = quoteRaise(existing, bidUsd, listings, episodeId);
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

  const quote = quoteOpenBid(bidUsd);
  return {
    episodeId,
    listingId: `lst_${randomUUID()}`,
    name,
    siteUrl,
    oneLiner,
    quote,
  };
}

export async function startCheckout(
  db: AppDb,
  polar: PolarPort,
  body: CheckoutBody,
): Promise<{ checkoutId: string; url: string; kind: BidQuote["kind"]; chargeUsd: number }> {
  const draft = quoteCheckout(db, body);
  const created = await polar.createCheckout({
    episodeId: draft.episodeId,
    listingId: draft.listingId,
    amountUsd: draft.quote.chargeUsd,
    kind: draft.quote.kind,
    name: draft.name,
    siteUrl: draft.siteUrl,
    oneLiner: draft.oneLiner,
    nextUsd: draft.quote.nextUsd,
  });
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
  session: PolarCheckoutRecord,
  paidAt: string = paidAtNow(),
): Listing {
  const episode = getEpisode(db, session.episodeId);
  if (!episode) {
    throw new CheckoutError("episode_not_found", "episode not found", 404);
  }
  if (episode.lockedAt) {
    throw new CheckoutError("episode_locked", "episode is locked", 409);
  }
  if (session.kind === "raise") {
    return applyPaidRaise(db, {
      episodeId: session.episodeId,
      listingId: session.listingId,
      siteUrl: session.siteUrl,
      newTotalUsd: session.nextUsd,
      paidAt,
    }).listing;
  }
  return applyPaidOpen(db, {
    id: session.listingId,
    episodeId: session.episodeId,
    name: session.name,
    siteUrl: session.siteUrl,
    oneLiner: session.oneLiner,
    bidUsd: session.nextUsd,
    firstBidAt: paidAt,
    paidAt,
  }).listing;
}

export async function completePaidCheckout(
  db: AppDb,
  polar: PolarPort,
  checkoutId: string,
): Promise<{ listing: Listing; amountUsd: number; alreadyPaid: boolean }> {
  const session = polar.getCheckout(checkoutId);
  if (!session) {
    throw new CheckoutError("unknown_checkout", "checkout not found", 404);
  }
  if (session.status === "paid") {
    const existing = listListingsForEpisode(db, session.episodeId).find(
      (row) => row.id === session.listingId,
    );
    if (existing) {
      return { listing: existing, amountUsd: session.amountUsd, alreadyPaid: true };
    }
    const listing = claimPaidCheckout(db, session);
    return { listing, amountUsd: session.amountUsd, alreadyPaid: false };
  }

  const paid = await polar.completeCheckout(checkoutId);
  if (!paid.paid) {
    throw new CheckoutError("payment_incomplete", "checkout is not paid", 402);
  }
  const listing = claimPaidCheckout(db, { ...session, status: "paid" });
  return { listing, amountUsd: paid.amountUsd, alreadyPaid: false };
}

export function extractCheckoutId(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const direct =
    readString(body.checkoutId) ??
    readString(body.polarCheckoutId) ??
    readString(body.id);
  if (direct) {
    return direct;
  }
  const data = isRecord(body.data) ? body.data : undefined;
  return data ? (readString(data.checkoutId) ?? readString(data.id)) : undefined;
}

function wantsHtml(request: { headers: Record<string, unknown> }): boolean {
  const type = String(request.headers["content-type"] ?? "");
  const accept = String(request.headers.accept ?? "");
  return (
    type.includes("application/x-www-form-urlencoded") ||
    (/\btext\/html\b/.test(accept) && !/\bapplication\/json\b/.test(accept))
  );
}

function sendCheckoutError(
  reply: FastifyReply,
  err: unknown,
  asHtml = false,
): FastifyReply {
  const statusAndCode = (() => {
    if (err instanceof CheckoutError) {
      return { status: err.statusCode, code: err.code };
    }
    if (err instanceof RankError || err instanceof HygieneError) {
      return { status: 400, code: err.code };
    }
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("BLOCKED-SECRET") || message === "polar checkout failed closed") {
      return { status: 503, code: "polar_unavailable" };
    }
    return null;
  })();
  if (!statusAndCode) {
    throw err;
  }
  if (asHtml) {
    return reply
      .code(statusAndCode.status)
      .type("text/html; charset=utf-8")
      .send(renderCheckoutErrorHtml(statusAndCode.code));
  }
  return reply.code(statusAndCode.status).send({ error: statusAndCode.code });
}

export const checkoutRoutes: FastifyPluginAsync = async (app) => {
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
      const started = await startCheckout(app.db, app.polar, body);
      if (html) {
        return reply.redirect(started.url, 303);
      }
      return {
        checkoutId: started.checkoutId,
        url: started.url,
        kind: started.kind,
        chargeUsd: started.chargeUsd,
      };
    } catch (err) {
      return sendCheckoutError(reply, err, html);
    }
  });

  app.get<{ Querystring: { checkoutId?: string } }>(
    CHECKOUT_COMPLETE_PATH,
    async (request, reply) => {
      const checkoutId = readString(request.query.checkoutId);
      if (!checkoutId) {
        return reply.redirect("/", 303);
      }
      if (app.polar.kind === "live") {
        return reply.redirect("/", 303);
      }
      try {
        await completePaidCheckout(app.db, app.polar, checkoutId);
      } catch (err) {
        if (err instanceof CheckoutError && err.code === "unknown_checkout") {
          return reply.redirect("/", 303);
        }
        return sendCheckoutError(reply, err);
      }
      return reply.redirect("/", 303);
    },
  );

  app.post(POLAR_WEBHOOK_PATH, async (request, reply) => {
    const checkoutId = extractCheckoutId(request.body);
    if (!checkoutId) {
      return reply.code(400).send({ error: "invalid_webhook" });
    }
    try {
      const result = await completePaidCheckout(app.db, app.polar, checkoutId);
      return { ok: true, status: "paid", listingId: result.listing.id };
    } catch (err) {
      return sendCheckoutError(reply, err);
    }
  });
};
