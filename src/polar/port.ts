export type CheckoutKind = "open" | "raise";

export type CreateCheckoutInput = {
  episodeId: string;
  listingId: string;
  amountUsd: number;
  kind: CheckoutKind;
  name: string;
  siteUrl: string;
  oneLiner: string;
  nextUsd: number;
};

export type PolarCheckout = {
  checkoutId: string;
  url: string;
};

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

/** HTTP talks to Polar only through this port. */
export type PolarPort = {
  readonly kind: "fixture" | "live";
  createCheckout(input: CreateCheckoutInput): Promise<PolarCheckout>;
  getCheckout(checkoutId: string): PolarCheckoutRecord | undefined;
  /** Fixture complete or verified webhook. */
  completeCheckout(checkoutId: string): Promise<PolarPaid>;
};

export type PolarEnv = NodeJS.ProcessEnv;

/** `POLAR_FIXTURE_ONLY=1` always wins. */
export function polarFixtureOnly(env: PolarEnv = process.env): boolean {
  return env.POLAR_FIXTURE_ONLY === "1";
}

export function polarLiveEnabled(env: PolarEnv = process.env): boolean {
  if (polarFixtureOnly(env)) {
    return false;
  }
  return env.POLAR_LIVE === "1";
}

export function polarAccessToken(env: PolarEnv = process.env): string {
  return env.POLAR_ACCESS_TOKEN?.trim() ?? "";
}

export function polarWebhookSecret(env: PolarEnv = process.env): string {
  return env.POLAR_WEBHOOK_SECRET?.trim() ?? "";
}

export function polarProductId(env: PolarEnv = process.env): string {
  return env.POLAR_PRODUCT_ID?.trim() ?? "";
}

/** Override with `POLAR_API_BASE`. Default is production Polar; tests must not fetch it. */
export function polarApiBase(env: PolarEnv = process.env): string {
  const fromEnv = env.POLAR_API_BASE?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const host = ["api", "polar", "sh"].join(".");
  return `https://${host}`;
}
