import type { WebhookEvent } from "@waffo/pancake-ts";

export const WAFFO_MODES = ["fixture", "waffo-test", "waffo-prod"] as const;
export type WaffoMode = (typeof WAFFO_MODES)[number];
export type WaffoEnvironment = "test" | "prod";

export type WaffoEnv = Record<string, string | undefined>;

export type CheckoutKind = "open" | "raise";

export type CreateCheckoutInput = {
  intentId: string;
  intentFingerprint: string;
  episodeId: string;
  listingId: string;
  chargeCents: number;
  quoteBaseCents: number;
  targetBidCents: number;
  kind: CheckoutKind;
  name: string;
  siteUrl: string;
  oneLiner: string;
};

export type WaffoCheckout = {
  checkoutId: string;
  url: string;
  expiresAt?: string;
};

export type WaffoCheckoutRecord = CreateCheckoutInput & {
  checkoutId: string;
  url: string;
  expiresAt?: string;
  status: "pending" | "paid";
};

export type WaffoPaid = {
  paid: true;
  amountCents: number;
  checkoutId: string;
};

export type WaffoWebhook = WebhookEvent<Record<string, unknown>>;

/** Provider boundary used by the HTTP layer; legacy adapters are absent. */
export type WaffoPort = {
  readonly kind: WaffoMode;
  readonly mode: WaffoMode;
  readonly environment?: WaffoEnvironment;
  readonly storeId: string;
  readonly productId: string;
  readonly publicBaseUrl?: string;
  createCheckout(input: CreateCheckoutInput): Promise<WaffoCheckout>;
  getCheckout(checkoutId: string): WaffoCheckoutRecord | undefined;
  /** Fixture completion only. Live ports always reject this operation. */
  completeCheckout(checkoutId: string): Promise<WaffoPaid>;
  /** Verify the exact raw request body with the official Waffo SDK. */
  verifyWebhook(rawBody: string, signature: string | undefined): WaffoWebhook;
};

export class WaffoProviderError extends Error {
  readonly state: "rejected" | "unknown";
  readonly status?: number;
  readonly causeValue: unknown;

  constructor(
    state: "rejected" | "unknown",
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "WaffoProviderError";
    this.state = state;
    this.status = options.status;
    this.causeValue = options.cause;
  }
}

export function waffoEnvironment(mode: WaffoMode): WaffoEnvironment | undefined {
  if (mode === "waffo-test") return "test";
  if (mode === "waffo-prod") return "prod";
  return undefined;
}

export function centsToDisplayString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("amount must be positive integer cents");
  }
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

/** Parse a USD display amount without floating point arithmetic. */
export function parseDisplayCents(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  // Provider money is an authenticated display string. Whitespace is not a
  // harmless presentation detail: accepting it would make a malformed
  // present field indistinguishable from the exact value we reconciled.
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) return undefined;
  const whole = Number(match[1]);
  const fraction = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : undefined;
}

export function modeToEnvironment(mode: WaffoMode): WaffoEnvironment | undefined {
  return waffoEnvironment(mode);
}
