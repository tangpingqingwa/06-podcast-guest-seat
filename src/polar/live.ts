import {
  polarAccessToken,
  polarFixtureOnly,
  polarLiveEnabled,
  polarWebhookSecret,
  type CreateCheckoutInput,
  type PolarCheckout,
  type PolarCheckoutRecord,
  type PolarEnv,
  type PolarPaid,
  type PolarPort,
} from "./port.js";

export type LivePolarOptions = {
  env?: PolarEnv;
  fetch?: typeof fetch;
};

function polarApiRoot(env: PolarEnv): string {
  const fromEnv = env.POLAR_API_BASE?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const host = ["api", "polar", "sh"].join(".");
  return `https://${host}`;
}

/** Live Polar Checkout. Constructor refuses unless `POLAR_LIVE=1` and fixture-only is off. */
export class LivePolar implements PolarPort {
  readonly kind = "live" as const;
  private readonly env: PolarEnv;
  private readonly fetchFn: typeof fetch;
  private readonly sessions = new Map<string, PolarCheckoutRecord>();

  constructor(options: LivePolarOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetch ?? fetch;
    if (polarFixtureOnly(this.env)) {
      throw new Error("LivePolar is disabled when POLAR_FIXTURE_ONLY=1");
    }
    if (!polarLiveEnabled(this.env)) {
      throw new Error("LivePolar requires POLAR_LIVE=1");
    }
    if (!polarAccessToken(this.env)) {
      throw new Error("BLOCKED-SECRET: POLAR_ACCESS_TOKEN");
    }
  }

  async createCheckout(input: CreateCheckoutInput): Promise<PolarCheckout> {
    if (polarFixtureOnly(this.env) || !polarLiveEnabled(this.env)) {
      throw new Error("LivePolar createCheckout is env-gated");
    }
    const token = polarAccessToken(this.env);
    if (!token) {
      throw new Error("BLOCKED-SECRET: POLAR_ACCESS_TOKEN");
    }
    const response = await this.fetchFn(`${polarApiRoot(this.env)}/v1/checkouts/`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        amount: input.amountUsd * 100,
        currency: "usd",
        metadata: {
          episodeId: input.episodeId,
          listingId: input.listingId,
          kind: input.kind,
          amountUsd: String(input.amountUsd),
          nextUsd: String(input.nextUsd),
        },
      }),
    });
    if (!response.ok) {
      throw new Error("polar checkout failed closed");
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const checkoutId = readString(payload.id);
    const url = readString(payload.url);
    if (!checkoutId || !url) {
      throw new Error("polar checkout failed closed");
    }
    this.sessions.set(checkoutId, {
      ...input,
      checkoutId,
      url,
      status: "pending",
    });
    return { checkoutId, url };
  }

  getCheckout(checkoutId: string): PolarCheckoutRecord | undefined {
    const session = this.sessions.get(checkoutId);
    return session ? { ...session } : undefined;
  }

  async completeCheckout(checkoutId: string): Promise<PolarPaid> {
    throw new Error(`live Polar session ${checkoutId} completes via webhook only`);
  }

  requireWebhookSecret(): string {
    const secret = polarWebhookSecret(this.env);
    if (!secret) {
      throw new Error("BLOCKED-SECRET: POLAR_WEBHOOK_SECRET");
    }
    return secret;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
