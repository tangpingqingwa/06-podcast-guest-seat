/**
 * Source compatibility only. Runtime payment selection lives in
 * `src/waffo`; these types and helpers intentionally have no provider I/O and
 * never read or interpret legacy configuration.
 */
export type CheckoutKind = "open" | "raise";

export type CreateCheckoutInput = {
  intentId?: string;
  episodeId: string;
  listingId: string;
  amountUsd: number;
  kind: CheckoutKind;
  name: string;
  siteUrl: string;
  oneLiner: string;
  nextUsd: number;
};

export type PolarCheckout = { checkoutId: string; url: string };

export type PolarPaid = {
  paid: true;
  amountUsd: number;
  checkoutId: string;
};

export type PolarCheckoutRecord = CreateCheckoutInput & {
  checkoutId: string;
  url: string;
  status: "pending" | "paid";
};

export type PolarPort = {
  readonly kind: "fixture" | "live";
  readonly productId?: string;
  readonly successUrl?: string;
  createCheckout(input: CreateCheckoutInput): Promise<PolarCheckout>;
  getCheckout(checkoutId: string): PolarCheckoutRecord | undefined;
  completeCheckout(checkoutId: string): Promise<PolarPaid>;
  requireWebhookSecret?: () => string;
};

export type PolarEnv = NodeJS.ProcessEnv;

/** Legacy provider flags are inert. Waffo owns all runtime mode selection. */
export function polarFixtureOnly(_env: PolarEnv = process.env): false {
  return false;
}

export function polarLiveEnabled(_env: PolarEnv = process.env): false {
  return false;
}

export function polarAccessToken(_env: PolarEnv = process.env): string {
  return "";
}

export function polarWebhookSecret(_env: PolarEnv = process.env): string {
  return "";
}

export function polarProductId(_env: PolarEnv = process.env): string {
  return "";
}

export function polarSuccessUrl(_env: PolarEnv = process.env): string {
  return "";
}

export function polarApiBase(_env: PolarEnv = process.env): never {
  throw new Error("BLOCKED-CONFIG: legacy payment adapter disabled; use Waffo");
}
