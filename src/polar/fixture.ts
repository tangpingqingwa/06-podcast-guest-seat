import { randomUUID } from "node:crypto";
import type {
  CreateCheckoutInput,
  PolarCheckout,
  PolarCheckoutRecord,
  PolarPaid,
  PolarPort,
} from "./port.js";

export function fixtureCheckoutUrl(checkoutId: string): string {
  return `/checkout/complete?checkoutId=${encodeURIComponent(checkoutId)}`;
}

function copyRecord(session: PolarCheckoutRecord): PolarCheckoutRecord {
  return { ...session };
}

/** In-process Polar. Deterministic ids. No network. */
export class FixturePolar implements PolarPort {
  readonly kind = "fixture" as const;
  private readonly sessions = new Map<string, PolarCheckoutRecord>();

  async createCheckout(input: CreateCheckoutInput): Promise<PolarCheckout> {
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

  getCheckout(checkoutId: string): PolarCheckoutRecord | undefined {
    const session = this.sessions.get(checkoutId);
    return session ? copyRecord(session) : undefined;
  }

  async completeCheckout(checkoutId: string): Promise<PolarPaid> {
    const session = this.sessions.get(checkoutId);
    if (!session) {
      throw new Error(`unknown checkout ${checkoutId}`);
    }
    session.status = "paid";
    return {
      paid: true,
      amountUsd: session.amountUsd,
      checkoutId: session.checkoutId,
    };
  }
}
