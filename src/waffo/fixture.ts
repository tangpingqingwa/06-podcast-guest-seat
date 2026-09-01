import { randomUUID } from "node:crypto";
import type {
  CreateCheckoutInput,
  WaffoCheckout,
  WaffoCheckoutRecord,
  WaffoPaid,
  WaffoPort,
  WaffoWebhook,
} from "./port.js";

export const FIXTURE_WAFFO_STORE_ID = "fixture-store";
export const FIXTURE_WAFFO_PRODUCT_ID = "fixture-product";

export function fixtureCheckoutUrl(checkoutId: string): string {
  return `/checkout/complete?checkoutId=${encodeURIComponent(checkoutId)}`;
}

/** Offline provider. It never consults credentials or calls a network. */
export class FixtureWaffo implements WaffoPort {
  readonly kind = "fixture" as const;
  readonly mode = "fixture" as const;
  readonly storeId = FIXTURE_WAFFO_STORE_ID;
  readonly productId = FIXTURE_WAFFO_PRODUCT_ID;
  private readonly sessions = new Map<string, WaffoCheckoutRecord>();

  async createCheckout(input: CreateCheckoutInput): Promise<WaffoCheckout> {
    const checkoutId = `fix_${randomUUID()}`;
    const url = fixtureCheckoutUrl(checkoutId);
    this.sessions.set(checkoutId, {
      ...input,
      checkoutId,
      url,
      status: "pending",
    });
    return { checkoutId, url };
  }

  getCheckout(checkoutId: string): WaffoCheckoutRecord | undefined {
    const session = this.sessions.get(checkoutId);
    return session ? { ...session } : undefined;
  }

  async completeCheckout(checkoutId: string): Promise<WaffoPaid> {
    const session = this.sessions.get(checkoutId);
    if (!session) {
      throw new Error(`unknown checkout ${checkoutId}`);
    }
    session.status = "paid";
    return { paid: true, amountCents: session.chargeCents, checkoutId };
  }

  verifyWebhook(_rawBody: string, _signature: string | undefined): WaffoWebhook {
    throw new Error("fixture webhooks are disabled; use the local return flow");
  }
}
