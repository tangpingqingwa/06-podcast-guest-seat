import type {
  CreateCheckoutInput,
  PolarCheckout,
  PolarCheckoutRecord,
  PolarEnv,
  PolarPaid,
  PolarPort,
} from "./port.js";

export type LivePolarOptions = { env?: PolarEnv };

/**
 * Compatibility symbol for old imports. The payment boundary is Waffo;
 * this class is deliberately inert and can never issue a provider request.
 */
export class LivePolar implements PolarPort {
  readonly kind = "live" as const;
  readonly productId: string | undefined = undefined;
  readonly successUrl: string | undefined = undefined;

  constructor(_options: LivePolarOptions = {}) {
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

  requireWebhookSecret(): string {
    throw new Error("BLOCKED-CONFIG: legacy payment adapter disabled; use Waffo");
  }
}
