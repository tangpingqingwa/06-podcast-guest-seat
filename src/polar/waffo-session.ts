/**
 * Retired handwritten adapter. It remains as a throwing compatibility shim
 * so an old import fails closed instead of bypassing the Waffo SDK.
 */
export type WaffoEnv = Record<string, string | undefined>;

const DISABLED = "BLOCKED-CONFIG: retired payment adapter disabled; use Waffo SDK";

export const DEFAULT_WAFFO_API_BASE = "";

export function polarFixtureOnly(_env: WaffoEnv = process.env): false {
  return false;
}

export function isWaffoLive(_env: WaffoEnv = process.env): false {
  return false;
}

export function waffoApiBase(_env: WaffoEnv = process.env): never {
  throw new Error(DISABLED);
}

export function requireWaffoSecret(
  _name: "WAFFO_MERCHANT_ID" | "WAFFO_PRODUCT_ID" | "WAFFO_STORE_ID",
  _env: WaffoEnv = process.env,
): never {
  throw new Error(DISABLED);
}

export function waffoPrivateKey(_env: WaffoEnv = process.env): never {
  throw new Error(DISABLED);
}

export function requireWaffoLiveSecrets(_env: WaffoEnv = process.env): never {
  throw new Error(DISABLED);
}

export async function createWaffoCheckoutSession(_input: {
  env?: WaffoEnv;
  amountUsd: number;
  successUrl: string;
  metadata?: Record<string, string>;
}): Promise<never> {
  throw new Error(DISABLED);
}

export const signedWaffoFetch = async (
  _env: WaffoEnv,
  _fetchFn: unknown,
  _method: string,
  _path: string,
  _payload: unknown,
): Promise<never> => {
  throw new Error(DISABLED);
};
