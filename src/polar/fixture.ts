import type {
  CreateCheckoutInput,
  PolarCheckout,
  PolarCheckoutRecord,
  PolarPaid,
  PolarPort,
} from "./port.js";

/** Compatibility-only fixture symbol. Waffo owns even offline checkout. */
export const FIXTURE_WAFFO_STORE_ID = "";
export const FIXTURE_WAFFO_PRODUCT_ID = "";

export function fixtureCheckoutUrl(_checkoutId: string): never {
  throw new Error("BLOCKED-CONFIG: legacy payment adapter disabled; use Waffo");
}

export class FixturePolar implements PolarPort {
  readonly kind = "fixture" as const;
  readonly productId: string | undefined = undefined;
  readonly successUrl: string | undefined = undefined;

  constructor() {
    throw new Error("BLOCKED-CONFIG: legacy payment adapter disabled; use Waffo");
  }

  async createCheckout(_input: CreateCheckoutInput): Promise<PolarCheckout> {
    throw new Error("BLOCKED-CONFIG: legacy payment adapter disabled; use Waffo");
  }

  getCheckout(_checkoutId: string): PolarCheckoutRecord | undefined {
    return undefined;
  }

  async completeCheckout(_checkoutId: string): Promise<PolarPaid> {
    throw new Error("BLOCKED-CONFIG: legacy payment adapter disabled; use Waffo");
  }
}
