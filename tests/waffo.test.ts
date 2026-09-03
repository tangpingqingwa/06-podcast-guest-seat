import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { migrate, openDatabase } from "../src/db.js";
import { countEpisodes, createEpisode, getCurrentEpisode, getEpisode } from "../src/episodes.js";
import {
  CheckoutError,
  completePaidCheckout,
  createWaffoPort,
  quoteCheckout,
  settleVerifiedWaffoOrder,
  startCheckout,
} from "../src/http/routes/checkout.js";
import { insertListing, listListingsForEpisode } from "../src/listings.js";
import { lockEpisode } from "../src/veto.js";
import { FixtureWaffo } from "../src/waffo/fixture.js";
import { LiveWaffo, readWaffoConfig } from "../src/waffo/live.js";
import { centsToDisplayString, parseDisplayCents, type WaffoPort } from "../src/waffo/port.js";
import { LivePolar } from "../src/polar/live.js";

const MERCHANT_ID = "MER_1234567890123456789012";
const STORE_ID = "STO_1234567890123456789012";
const PRODUCT_ID = "PROD_1234567890123456789012";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

function env(overrides: Record<string, string> = {}) {
  return {
    WAFFO_MODE: "waffo-test",
    WAFFO_MERCHANT_ID: MERCHANT_ID,
    WAFFO_PRIVATE_KEY: privateKey,
    WAFFO_STORE_ID: STORE_ID,
    WAFFO_PRODUCT_ID: PRODUCT_ID,
    WAFFO_PUBLIC_BASE_URL: "https://guest-seat.example.test",
    WAFFO_TEST_WEBHOOK_PUBLIC_KEY: publicKey,
    DATABASE_PATH: "/tmp/guest-seat-waffo-test.sqlite",
    ...overrides,
  };
}

function memoryDb() {
  const db = openDatabase(":memory:");
  after(() => db.close());
  return db;
}

function episode(db: ReturnType<typeof memoryDb>, id = "ep_12") {
  return createEpisode(db, {
    id,
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
  });
}

function bodyForIntent(episodeId = "ep_12") {
  return {
    episodeId,
    name: "Ada Lovelace",
    siteUrl: "https://example.com/ada?utm_source=guest-seat",
    oneLiner: "Analytical engines for everyone.",
    bidUsd: 12,
  };
}

function countingFixturePort(calls: { value: number }): WaffoPort {
  const fixture = new FixtureWaffo();
  return {
    kind: fixture.kind,
    mode: fixture.mode,
    storeId: fixture.storeId,
    productId: fixture.productId,
    createCheckout: async (input) => {
      calls.value += 1;
      return fixture.createCheckout(input);
    },
    getCheckout: (checkoutId) => fixture.getCheckout(checkoutId),
    completeCheckout: (checkoutId) => fixture.completeCheckout(checkoutId),
    verifyWebhook: (rawBody, signature) => fixture.verifyWebhook(rawBody, signature),
  };
}

type Captured = { path: string; body: Record<string, unknown>; calls: number };

function livePort(captured: Captured, overrides: Record<string, string> = {}) {
  const liveEnv = env(overrides);
  return new LiveWaffo({
    env: liveEnv,
    fetch: (async (url, init) => {
      captured.calls += 1;
      captured.path = new URL(String(url)).pathname;
      captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return {
        status: 200,
        json: async () => ({
          data: {
            sessionId: "SES_1234567890123456789012",
            checkoutUrl: "https://pancake.waffo.ai/store/test/checkout/SES_1234567890123456789012",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      } as Response;
    }) as typeof fetch,
  });
}

function signedEvent(
  body: Record<string, unknown>,
  timestamp = new Date().toISOString(),
  deliveryId = "delivery-1",
  topChanges: Record<string, unknown> = {},
) {
  const raw = JSON.stringify({
    id: deliveryId,
    timestamp,
    eventType: "order.completed",
    eventId: String(body.paymentId ?? "event-1"),
    storeId: STORE_ID,
    storeName: "Guest Seat",
    mode: "test",
    data: body,
    ...topChanges,
  });
  const t = String(Date.now());
  const signer = createSign("RSA-SHA256");
  signer.update(`${t}.${raw}`);
  signer.end();
  return {
    raw,
    signature: `t=${t},v1=${signer.sign(privateKey, "base64")}`,
  };
}

function completedData(captured: Captured, changes: Record<string, unknown> = {}) {
  const metadata = captured.body.metadata as Record<string, string>;
  return {
    orderId: "ORD_1234567890123456789012",
    orderStatus: "completed",
    buyerEmail: "guest@example.test",
    orderMerchantExternalId: String(captured.body.orderMerchantExternalId),
    currency: "USD",
    amount: "12.00",
    taxAmount: "0.00",
    subtotal: "12.00",
    total: "12.00",
    productName: "Guest seat",
    paymentId: "PAY_1234567890123456789012",
    paymentStatus: "succeeded",
    orderMetadata: metadata,
    ...changes,
  };
}

function stableFingerprintJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableFingerprintJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableFingerprintJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) as string;
}

function legacyFingerprintFor(captured: Captured, eventTimestamp: string): string {
  const body = completedData(captured);
  const metadata = body.orderMetadata;
  return createHash("sha256")
    .update(
      stableFingerprintJson({
        eventType: "order.completed",
        businessEventId: body.paymentId,
        paymentId: body.paymentId,
        orderId: body.orderId,
        intentId: body.orderMerchantExternalId,
        buyerEmail: body.buyerEmail,
        productName: body.productName,
        mode: "waffo-test",
        storeId: STORE_ID,
        eventTimestamp,
        metadata,
        amountCents: 1200,
        subtotalCents: 1200,
        subtotalPresent: true,
        taxCents: 0,
        totalCents: 1200,
        totalPresent: true,
        checkoutId: undefined,
        checkoutIdPresent: false,
        productId: undefined,
        productIdPresent: false,
      }),
      "utf8",
    )
    .digest("hex");
}

async function startLive(captured: Captured) {
  const db = memoryDb();
  episode(db);
  const port = livePort(captured);
  const started = await startCheckout(db, port, bodyForIntent());
  return { db, port, started };
}

test("malformed locksAt quarantines before Waffo and creates no intent", async () => {
  const db = memoryDb();
  const corrupt = createEpisode(db, {
    id: "ep_malformed_locks_at",
    showId: "show_english",
    label: "Episode 12",
    seatKind: "guest_seat",
    opensAt: "2026-08-22T00:00:00.000Z",
    locksAt: "not-a-timestamp",
  });
  const calls = { value: 0 };
  const app = await buildApp({ db, waffo: countingFixturePort(calls) });
  after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/checkout",
    headers: { accept: "application/json" },
    payload: bodyForIntent(corrupt.id),
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), { error: "episode_locked" });
  assert.equal(calls.value, 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM checkout_intents").get() as { n: number }).n,
    0,
  );
  const quarantined = getEpisode(db, corrupt.id);
  assert.ok(quarantined?.lockedAt);
  assert.equal(quarantined?.locksAt, "not-a-timestamp");
  const current = getCurrentEpisode(db);
  assert.ok(current);
  assert.notEqual(current.id, corrupt.id);
  assert.equal(current.label, "Episode 13");
  assert.equal(current.lockedAt, null);
  assert.deepEqual(listListingsForEpisode(db, current.id), []);
  assert.equal(countEpisodes(db), 2);
  assert.throws(
    () => quoteCheckout(db, bodyForIntent(corrupt.id)),
    (error: unknown) => error instanceof CheckoutError && error.code === "episode_locked",
  );
});

test("Waffo mode truth table is explicit and Waffo variables are inert", () => {
  assert.equal(createWaffoPort({ WAFFO_MODE: "fixture", POLAR_LIVE: "1" }).kind, "fixture");
  assert.throws(() => createWaffoPort({ WAFFO_LIVE: "1" }), /BLOCKED-CONFIG: WAFFO_MODE/);
  assert.throws(() => createWaffoPort({ WAFFO_MODE: "waffo-test" }), /BLOCKED-CONFIG: WAFFO_MERCHANT_ID/);
  assert.throws(
    () => createWaffoPort({ ...env(), DATABASE_PATH: ":memory:" }),
    /BLOCKED-CONFIG: DATABASE_PATH/,
  );
  assert.throws(
    () => new LiveWaffo({ env: { ...env(), WAFFO_TEST_WEBHOOK_PUBLIC_KEY: "" } }),
    /BLOCKED-CONFIG: WAFFO_TEST_WEBHOOK_PUBLIC_KEY/,
  );
});

test("normal app construction honors the fixture/live/missing/invalid Waffo mode matrix", async () => {
  const names = [
    ...new Set([
      ...Object.keys(env()),
      "WAFFO_PROD_WEBHOOK_PUBLIC_KEY",
      "HOST_SESSION_SECRET",
      "NODE_ENV",
      "VERCEL_ENV",
      "APP_ENV",
      "DEPLOY_ENV",
      "BUILD_ENV",
    ]),
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const directory = mkdtempSync(join(tmpdir(), "guest-seat-mode-matrix-"));
  const clear = () => {
    for (const name of names) delete process.env[name];
  };
  const set = (values: Record<string, string>) => {
    clear();
    for (const [name, value] of Object.entries(values)) process.env[name] = value;
  };
  try {
    set({ NODE_ENV: "development", WAFFO_MODE: "fixture" });
    const fixtureApp = await buildApp({ databasePath: ":memory:" });
    assert.equal(fixtureApp.waffo.kind, "fixture");
    assert.equal(fixtureApp.waffo.mode, "fixture");
    await fixtureApp.close();

    for (const mode of ["waffo-test", "waffo-prod"] as const) {
      const databasePath = join(directory, `${mode}.sqlite`);
      set({
        ...env({
          WAFFO_MODE: mode,
          DATABASE_PATH: databasePath,
          WAFFO_PROD_WEBHOOK_PUBLIC_KEY: publicKey,
        }),
        NODE_ENV: "development",
      });
      const liveApp = await buildApp({ databasePath });
      assert.equal(liveApp.waffo.kind, mode);
      assert.equal(liveApp.waffo.mode, mode);
      await liveApp.close();
    }

    set({ NODE_ENV: "development" });
    const defaultFixtureApp = await buildApp({ databasePath: ":memory:" });
    assert.equal(defaultFixtureApp.waffo.kind, "fixture");
    assert.equal(defaultFixtureApp.waffo.mode, "fixture");
    await defaultFixtureApp.close();

    set({ NODE_ENV: "development", WAFFO_MODE: "invalid-mode" });
    await assert.rejects(
      () => buildApp({ databasePath: ":memory:" }),
      /BLOCKED-CONFIG: WAFFO_MODE/,
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production cannot construct a fixture or settle through the default app", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousWaffoMode = process.env.WAFFO_MODE;
  process.env.NODE_ENV = "production";
  process.env.WAFFO_MODE = "fixture";
  try {
    assert.throws(
      () => createWaffoPort({ WAFFO_MODE: "fixture", NODE_ENV: "production" }),
      /BLOCKED-CONFIG: fixture provider is forbidden in production/,
    );
    assert.throws(
      () => createWaffoPort({ WAFFO_MODE: "fixture", NODE_ENV: "development" }),
      /BLOCKED-CONFIG: fixture provider is forbidden in production/,
    );
    await assert.rejects(
      () => buildApp(),
      /BLOCKED-CONFIG: WAFFO_MODE/,
    );
    await assert.rejects(
      () => buildApp({ waffo: new FixtureWaffo() }),
      /BLOCKED-CONFIG: production Waffo injection is forbidden/,
    );
    const db = memoryDb();
    episode(db);
    const fixture = new FixtureWaffo();
    const started = await startCheckout(db, fixture, bodyForIntent());
    await assert.rejects(
      () => completePaidCheckout(db, fixture, started.checkoutId),
      /live Waffo checkout completes via webhook only/,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousWaffoMode === undefined) delete process.env.WAFFO_MODE;
    else process.env.WAFFO_MODE = previousWaffoMode;
  }
});

test("production app requires the configured durable database", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const productionHostSessionSecret = "production-host-session-secret";
  const productionConfig = env({
    WAFFO_MODE: "waffo-prod",
    WAFFO_PROD_WEBHOOK_PUBLIC_KEY: publicKey,
    HOST_SESSION_SECRET: productionHostSessionSecret,
  });
  const previousProductionConfig = Object.fromEntries(
    Object.keys(productionConfig).map((name) => [name, process.env[name]]),
  );
  const productionPort = {
    kind: "waffo-prod" as const,
    mode: "waffo-prod" as const,
    environment: "prod" as const,
    storeId: STORE_ID,
    productId: PRODUCT_ID,
    publicBaseUrl: "https://guest-seat.example.test",
    createCheckout: async () => ({
      checkoutId: "unused",
      url: "https://pancake.waffo.ai/store/test/checkout/unused",
    }),
    getCheckout: () => undefined,
    completeCheckout: async () => ({
      paid: true as const,
      amountCents: 500,
      checkoutId: "unused",
    }),
    verifyWebhook: () => {
      throw new Error("unused");
    },
  };
  process.env.NODE_ENV = "production";
  try {
    for (const [name, value] of Object.entries(productionConfig)) {
      if (name !== "DATABASE_PATH") process.env[name] = value;
    }
    delete process.env.DATABASE_PATH;
    await assert.rejects(() => buildApp(), /BLOCKED-CONFIG: DATABASE_PATH/);
    process.env.DATABASE_PATH = ":memory:";
    await assert.rejects(() => buildApp(), /BLOCKED-CONFIG: DATABASE_PATH/);
    const injected = openDatabase(":memory:");
    try {
      process.env.DATABASE_PATH = "/tmp/guest-seat-production.sqlite";
      await assert.rejects(
        () => buildApp({ db: injected }),
        /BLOCKED-CONFIG: production database injection/,
      );
    } finally {
      injected.close();
    }
    const directory = mkdtempSync(join(tmpdir(), "guest-seat-production-db-"));
    try {
      const durablePath = join(directory, "guest-seat.sqlite");
      for (const [name, value] of Object.entries(productionConfig)) {
        process.env[name] = value;
      }
      process.env.DATABASE_PATH = durablePath;
      delete process.env.HOST_SESSION_SECRET;
      await assert.rejects(() => buildApp(), /BLOCKED-CONFIG: HOST_SESSION_SECRET/);
      process.env.HOST_SESSION_SECRET = "   ";
      await assert.rejects(() => buildApp(), /BLOCKED-CONFIG: HOST_SESSION_SECRET/);
      process.env.HOST_SESSION_SECRET = productionHostSessionSecret;
      await assert.rejects(
        () => buildApp({ waffo: productionPort }),
        /BLOCKED-CONFIG: production Waffo injection is forbidden/,
      );
      const app = await buildApp({ databasePath: `${durablePath}   ` });
      const databases = app.db.prepare("PRAGMA database_list").all() as Array<{ file: string }>;
      assert.equal(databases.some((row) => row.file.endsWith("/guest-seat.sqlite")), true);
      const health = await app.inject({ method: "GET", url: "/healthz" });
      assert.equal(health.statusCode, 200);
      assert.deepEqual(health.json(), { ok: true });
      await app.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    for (const [name, value] of Object.entries(previousProductionConfig)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("live configuration pins origins, mode keys, and durable storage", () => {
  for (const apiBase of ["http://127.0.0.1:9", "https://api.waffo.ai.evil.example", "https://api.waffo.ai/v1"]) {
    assert.throws(
      () => readWaffoConfig(env({ WAFFO_API_BASE: apiBase })),
      /BLOCKED-CONFIG: WAFFO_API_BASE/,
    );
  }
  for (const publicBaseUrl of ["https://[::1]", "https://169.254.169.254", "https://100.64.0.1"]) {
    assert.throws(
      () => readWaffoConfig(env({ WAFFO_PUBLIC_BASE_URL: publicBaseUrl })),
      /BLOCKED-CONFIG: WAFFO_PUBLIC_BASE_URL/,
    );
  }
  assert.throws(
    () => readWaffoConfig({ ...env(), DATABASE_PATH: ":memory:" }),
    /BLOCKED-CONFIG: DATABASE_PATH/,
  );
  assert.throws(
    () => readWaffoConfig({ ...env(), DATABASE_PATH: "" }),
    /BLOCKED-CONFIG: DATABASE_PATH/,
  );
  assert.throws(
    () => readWaffoConfig({ ...env(), WAFFO_TEST_WEBHOOK_PUBLIC_KEY: "", WAFFO_WEBHOOK_PUBLIC_KEY: publicKey }),
    /BLOCKED-CONFIG: WAFFO_TEST_WEBHOOK_PUBLIC_KEY/,
  );
  for (const [name, value] of [
    ["WAFFO_MERCHANT_ID", "merchant"],
    ["WAFFO_STORE_ID", "store"],
    ["WAFFO_PRODUCT_ID", "product"],
    ["WAFFO_PRIVATE_KEY", "not-an-rsa-key"],
    ["WAFFO_TEST_WEBHOOK_PUBLIC_KEY", "not-an-rsa-key"],
  ] as const) {
    assert.throws(
      () => readWaffoConfig(env({ [name]: value })),
      new RegExp(`BLOCKED-CONFIG: ${name}`),
      name,
    );
  }
  const prod = readWaffoConfig({
    ...env({ WAFFO_MODE: "waffo-prod", WAFFO_PROD_WEBHOOK_PUBLIC_KEY: publicKey }),
  });
  assert.equal(prod.environment, "prod");
  assert.equal(prod.apiBase, "https://api.waffo.ai");
});

test("ambiguous transport, 5xx, and invalid responses retain recoverable intents", async () => {
  for (const fetchImpl of [
    (async () => {
      throw new Error("socket reset");
    }) as typeof fetch,
    (async () =>
      ({
        status: 503,
        json: async () => ({ errors: [{ message: "temporarily unavailable" }] }),
      }) as Response) as typeof fetch,
    (async () =>
      ({ status: 200, json: async () => { throw new Error("not json"); } }) as unknown as Response) as typeof fetch,
  ]) {
    const db = memoryDb();
    episode(db);
    const port = new LiveWaffo({ env: env(), fetch: fetchImpl });
    await assert.rejects(
      () => startCheckout(db, port, bodyForIntent()),
      (error: unknown) => error instanceof Error && /Waffo checkout outcome is unknown/.test(error.message),
    );
    const row = db.prepare("SELECT status, failure_code FROM checkout_intents ORDER BY created_at DESC LIMIT 1").get() as { status: string; failure_code: string };
    assert.equal(row.status, "unknown");
    assert.equal(row.failure_code, "waffo_checkout_unknown");
  }

  for (const status of [408, 409, 425, 429]) {
    const captured: Captured = { path: "", body: {}, calls: 0 };
    const db = memoryDb();
    episode(db);
    const port = new LiveWaffo({
      env: env(),
      fetch: (async (url, init) => {
        captured.calls += 1;
        captured.path = new URL(String(url)).pathname;
        captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return {
          status,
          json: async () => ({ errors: [{ message: "provider response is ambiguous" }] }),
        } as Response;
      }) as typeof fetch,
    });
    await assert.rejects(() => startCheckout(db, port, bodyForIntent()));
    const unknown = db.prepare("SELECT id, status FROM checkout_intents LIMIT 1").get() as {
      id: string;
      status: string;
    };
    assert.equal(unknown.status, "unknown", String(status));
    const app = await buildApp({ db, waffo: port });
    const signed = signedEvent(completedData(captured), new Date().toISOString(), `ambiguous-${status}`);
    const recovered = await app.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
      payload: signed.raw,
    });
    assert.equal(recovered.statusCode, 200, String(status));
    assert.equal(recovered.json().status, "paid", String(status));
    assert.equal(listListingsForEpisode(db, "ep_12").length, 1, String(status));
    await app.close();
  }
});

test("provider timeout leaves an unknown intent that a later signed payment can recover", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const db = memoryDb();
  episode(db);
  const pendingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.calls += 1;
    captured.path = new URL(String(url)).pathname;
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    await new Promise<never>(() => undefined);
  }) as unknown as typeof fetch;
  const port = new LiveWaffo({ env: env(), fetch: pendingFetch, timeoutMs: 50 });
  const startedAt = Date.now();
  await assert.rejects(
    () => startCheckout(db, port, bodyForIntent()),
    (error: unknown) => error instanceof Error && /Waffo checkout outcome is unknown/.test(error.message),
  );
  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(captured.calls, 1);
  const unknown = db.prepare("SELECT status FROM checkout_intents LIMIT 1").get() as { status: string };
  assert.equal(unknown.status, "unknown");

  const app = await buildApp({ db, waffo: port });
  const signed = signedEvent(completedData(captured), new Date().toISOString(), "timeout-recovery");
  const response = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "paid");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 1);
  await app.close();
});

test("provider deadline remains active while the SDK consumes a response body", async () => {
  const db = memoryDb();
  episode(db);
  let providerSignal: AbortSignal | undefined;
  const port = new LiveWaffo({
    env: env(),
    timeoutMs: 40,
    fetch: (async (_url, init) => {
      providerSignal = init?.signal ?? undefined;
      return {
        status: 200,
        json: async () => new Promise<never>(() => undefined),
      } as unknown as Response;
    }) as typeof fetch,
  });
  const startedAt = Date.now();
  await assert.rejects(
    () => startCheckout(db, port, bodyForIntent()),
    (error: unknown) => error instanceof Error && /Waffo checkout outcome is unknown/.test(error.message),
  );
  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(providerSignal?.aborted, true);
  assert.equal(
    (db.prepare("SELECT status FROM checkout_intents LIMIT 1").get() as { status: string }).status,
    "unknown",
  );
});

test("provider rejection remains a durable rejected intent without a listing", async () => {
  const db = memoryDb();
  episode(db);
  const port = new LiveWaffo({
    env: env(),
    fetch: (async () =>
      ({
        status: 402,
        json: async () => ({ errors: [{ message: "declined" }] }),
      }) as Response) as typeof fetch,
  });
  await assert.rejects(
    () => startCheckout(db, port, bodyForIntent()),
    (error: unknown) => error instanceof Error && /Waffo rejected checkout creation/.test(error.message),
  );
  const row = db.prepare("SELECT status, failure_code FROM checkout_intents LIMIT 1").get() as {
    status: string;
    failure_code: string;
  };
  assert.deepEqual(row, { status: "rejected", failure_code: "waffo_checkout_rejected" });
  assert.equal(listListingsForEpisode(db, "ep_12").length, 0);
});

test("live rejects a private provider checkout origin as an unknown outcome", async () => {
  const db = memoryDb();
  episode(db);
  const port = new LiveWaffo({
    env: env(),
    fetch: (async () =>
      ({
        status: 200,
        json: async () => ({
          data: {
            sessionId: "SES_unsafe_123456789012345678",
            checkoutUrl: "https://169.254.169.254/checkout",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      }) as Response) as typeof fetch,
  });
  await assert.rejects(
    () => startCheckout(db, port, bodyForIntent()),
    (error: unknown) => error instanceof Error && /Waffo checkout outcome is unknown/.test(error.message),
  );
  const row = db.prepare("SELECT status FROM checkout_intents LIMIT 1").get() as { status: string };
  assert.equal(row.status, "unknown");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 0);
});

test("live checkout URL follows the documented hosted session shape", async () => {
  const sessionId = "SES_checkout_shape_123456789012345678";
  for (const checkoutUrl of [
    "https://pancake.waffo.ai/checkout/SES_checkout_shape_123456789012345678",
    "https://pancake.waffo.ai/store/test/checkout/SES_other_123456789012345678",
    ` https://pancake.waffo.ai/store/test/checkout/${sessionId}`,
  ]) {
    const db = memoryDb();
    episode(db);
    const port = new LiveWaffo({
      env: env(),
      fetch: (async () =>
        ({
          status: 200,
          json: async () => ({
            data: {
              sessionId,
              checkoutUrl,
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          }),
        }) as Response) as typeof fetch,
    });
    await assert.rejects(
      () => startCheckout(db, port, bodyForIntent()),
      (error: unknown) => error instanceof Error && /Waffo checkout outcome is unknown/.test(error.message),
    );
    assert.equal(
      (db.prepare("SELECT status FROM checkout_intents LIMIT 1").get() as { status: string }).status,
      "unknown",
    );
  }
});

test("unknown intent without a provider checkout settles from a signed event across restart and two DB connections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "guest-seat-waffo-recovery-"));
  const databasePath = join(directory, "guest-seat.sqlite");
  const captured: Captured = { path: "", body: {}, calls: 0 };
  let firstDb: ReturnType<typeof openDatabase> | undefined;
  let secondDb: ReturnType<typeof openDatabase> | undefined;
  let thirdDb: ReturnType<typeof openDatabase> | undefined;
  let secondApp: Awaited<ReturnType<typeof buildApp>> | undefined;
  let thirdApp: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    firstDb = openDatabase(databasePath);
    episode(firstDb);
    const unknownPort = new LiveWaffo({
      env: env({ DATABASE_PATH: databasePath }),
      fetch: (async (url, init) => {
        captured.calls += 1;
        captured.path = new URL(String(url)).pathname;
        captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        throw new Error("socket reset after Waffo accepted the request");
      }) as typeof fetch,
    });
    await assert.rejects(() => startCheckout(firstDb!, unknownPort, bodyForIntent()));
    const unknown = firstDb
      .prepare("SELECT status, provider_checkout_id FROM checkout_intents LIMIT 1")
      .get() as { status: string; provider_checkout_id: string | null };
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.provider_checkout_id, null);
    assert.equal(captured.calls, 1);
    firstDb.close();
    firstDb = undefined;

    secondDb = openDatabase(databasePath);
    secondApp = await buildApp({ db: secondDb, waffo: livePort(captured) });
    const signed = signedEvent(
      completedData(captured),
      new Date().toISOString(),
      "unknown-recovery-delivery",
    );
    const firstRecovery = await secondApp.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
      payload: signed.raw,
    });
    assert.equal(firstRecovery.statusCode, 200);
    assert.equal(firstRecovery.json().status, "paid");
    assert.equal(listListingsForEpisode(secondDb, "ep_12").length, 1);
    await secondApp.close();
    secondApp = undefined;

    // Keep the first recovered connection open while a second connection
    // retries the same signed delivery, matching a restart/two-instance path.
    thirdDb = openDatabase(databasePath);
    thirdApp = await buildApp({ db: thirdDb, waffo: livePort(captured) });
    const retry = await thirdApp.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
      payload: signed.raw,
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().status, "already_paid");
    assert.equal(listListingsForEpisode(thirdDb, "ep_12").length, 1);
    assert.equal(
      (thirdDb.prepare("SELECT COUNT(*) AS n FROM waffo_checkout_events").get() as { n: number }).n,
      1,
    );
    assert.equal(captured.calls, 1);
  } finally {
    if (thirdApp) await thirdApp.close();
    thirdDb?.close();
    if (secondApp) await secondApp.close();
    secondDb?.close();
    firstDb?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("money helpers use exact decimal cents", () => {
  assert.equal(centsToDisplayString(500), "5.00");
  assert.equal(centsToDisplayString(1203), "12.03");
  assert.equal(parseDisplayCents("12"), 1200);
  assert.equal(parseDisplayCents("12.3"), 1230);
  assert.equal(parseDisplayCents("12.30"), 1230);
  assert.equal(parseDisplayCents("12.345"), undefined);
  assert.equal(parseDisplayCents("$12.00"), undefined);
  assert.equal(parseDisplayCents(" 12.00"), undefined);
  assert.equal(parseDisplayCents("12.00 "), undefined);
});

test("official anonymous checkout receives immutable Waffo parameters", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, started } = await startLive(captured);
  assert.equal(captured.calls, 1);
  assert.equal(captured.path, "/v1/actions/checkout/create-session");
  assert.equal(captured.body.productId, PRODUCT_ID);
  assert.equal(captured.body.currency, "USD");
  assert.deepEqual(captured.body.priceSnapshot, {
    amount: "12.00",
    taxCategory: "digital_goods",
  });
  assert.match(String(captured.body.successUrl), /\/checkout\/complete\?intent=intent_/);
  assert.equal(typeof captured.body.orderMerchantExternalId, "string");
  const metadata = captured.body.metadata as Record<string, unknown>;
  assert.equal(metadata.currency, "USD");
  assert.equal(metadata.taxCategory, "digital_goods");
  assert.equal(metadata.canonicalUrl, "https://example.com/ada");
  assert.equal(metadata.boardWindowKey, "ep_12");
  assert.equal(metadata.productId, PRODUCT_ID);
  assert.equal(typeof metadata.intentFingerprint, "string");
  assert.equal(started.chargeUsd, 12);
  db.close();
});

test("present checkout/product fields and metadata projections cannot authorize rank", async () => {
  const cases: Array<[string, Record<string, unknown>, number]> = [
    ["empty-checkout", { checkoutId: "" }, 400],
    ["non-string-checkout", { checkoutId: 42 }, 400],
    ["empty-product", { productId: "" }, 400],
    ["non-string-product", { productId: 42 }, 400],
    ["wrong-product", { productId: "PROD_other_12345678901234567890" }, 200],
    ["extra-metadata", { orderMetadata: { extra: "attacker" } }, 200],
    ["missing-metadata", {}, 400],
    ["non-string-metadata", { orderMetadata: { chargeCents: 12 } }, 400],
    ["missing-buyer", {}, 400],
    ["missing-product-name", {}, 400],
    ["padded-amount", { amount: " 12.00 " }, 400],
    ["conflicting-tax-alias", { tax_amount: "1.00" }, 400],
  ];
  for (const [label, changes, expectedStatus] of cases) {
    const captured: Captured = { path: "", body: {}, calls: 0 };
    const { db, port } = await startLive(captured);
    const app = await buildApp({ db, waffo: port });
    const data: Record<string, unknown> = completedData(captured, changes);
    if (label === "missing-metadata") delete data.orderMetadata;
    if (label === "extra-metadata") {
      data.orderMetadata = {
        ...(captured.body.metadata as Record<string, string>),
        extra: "attacker",
      };
    }
    if (label === "non-string-metadata") {
      data.orderMetadata = {
        ...(captured.body.metadata as Record<string, string>),
        chargeCents: 12,
      };
    }
    if (label === "missing-buyer") delete data.buyerEmail;
    if (label === "missing-product-name") delete data.productName;
    const signed = signedEvent(data, new Date().toISOString(), `field-${label}`);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
      payload: signed.raw,
    });
    assert.equal(response.statusCode, expectedStatus, label);
    assert.equal(listListingsForEpisode(db, "ep_12").length, 0, label);
    await app.close();
  }
});

test("invalid Waffo session expiry and callback bases remain fail-closed", async () => {
  for (const publicBaseUrl of [
    "https://guest-seat.example.test/base",
    "https://guest-seat.example.test:8443",
    "https://guest-seat.example.test/?return=unsafe",
  ]) {
    assert.throws(
      () => readWaffoConfig(env({ WAFFO_PUBLIC_BASE_URL: publicBaseUrl })),
      /BLOCKED-CONFIG: WAFFO_PUBLIC_BASE_URL/,
    );
  }
  for (const expiresAt of [
    "not-a-date",
    "2020-01-01T00:00:00.000Z",
    new Date(Date.now() + 367 * 24 * 60 * 60 * 1000).toISOString(),
  ]) {
    const db = memoryDb();
    episode(db);
    const port = new LiveWaffo({
      env: env(),
      fetch: (async () =>
        ({
          status: 200,
          json: async () => ({
            data: {
              sessionId: "SES_invalid_expiry_123456789012345678",
              checkoutUrl: "https://pancake.waffo.ai/store/test/checkout/SES_invalid_expiry_123456789012345678",
              expiresAt,
            },
          }),
        }) as Response) as typeof fetch,
    });
    await assert.rejects(
      () => startCheckout(db, port, bodyForIntent()),
      (error: unknown) => error instanceof Error && /Waffo checkout outcome is unknown/.test(error.message),
    );
    const row = db.prepare("SELECT status FROM checkout_intents LIMIT 1").get() as { status: string };
    assert.equal(row.status, "unknown");
  }
});

test("retired Polar compatibility adapter is inert and throws before any request", async () => {
  assert.throws(() => new LivePolar(), /legacy payment adapter disabled/);
});

test("signed raw order.completed settles once, exact retry is a no-op, changed replay rejects", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const eventTimestamp = new Date().toISOString();
  const signed = signedEvent(completedData(captured), eventTimestamp);
  const first = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().status, "paid");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 1);

  const retry = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().status, "already_paid");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 1);

  const changed = signedEvent(completedData(captured, { amount: "13.00", total: "13.00" }));
  const changedResponse = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": changed.signature },
    payload: changed.raw,
  });
  assert.equal(changedResponse.statusCode, 200);
  assert.equal(changedResponse.json().status, "rejected");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 1);

  for (const [deliveryId, dataChanges, topChanges] of [
    ["changed-extra-top", {}, { storeName: "Changed store label" }],
    ["changed-extra-data", { buyerEmail: "changed@example.test" }, {}],
  ] as const) {
    const changedExtra = signedEvent(
      completedData(captured, dataChanges),
      eventTimestamp,
      deliveryId,
      topChanges,
    );
    const changedExtraResponse = await app.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": changedExtra.signature },
      payload: changedExtra.raw,
    });
    assert.equal(changedExtraResponse.statusCode, 200, deliveryId);
    assert.equal(changedExtraResponse.json().status, "rejected", deliveryId);
    assert.equal(changedExtraResponse.json().reason, "changed_replay", deliveryId);
  }

  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM waffo_checkout_events").get() as { n: number }).n,
    1,
  );
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_attempts").get() as { n: number }).n, 3);
  await app.close();
});

test("pre-business-payload accepted events use legacy replay once, then backfill", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const eventTimestamp = new Date().toISOString();
  const signed = signedEvent(completedData(captured), eventTimestamp, "legacy-replay");
  const first = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().status, "paid");

  db.prepare(
    `UPDATE waffo_checkout_events
        SET business_payload = '', business_payload_version = 0,
            event_fingerprint = ?
      WHERE delivery_id = ?`,
  ).run(legacyFingerprintFor(captured, eventTimestamp), "legacy-replay");

  const retry = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().status, "already_paid");
  const migrated = db
    .prepare("SELECT business_payload, business_payload_version FROM waffo_checkout_events WHERE delivery_id = ?")
    .get("legacy-replay") as { business_payload: string; business_payload_version: number };
  assert.notEqual(migrated.business_payload, "");
  assert.equal(migrated.business_payload_version, 1);

  const changed = signedEvent(
    completedData(captured, { buyerEmail: "changed@example.test" }),
    eventTimestamp,
    "legacy-changed",
  );
  const changedResponse = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": changed.signature },
    payload: changed.raw,
  });
  assert.equal(changedResponse.statusCode, 200);
  assert.equal(changedResponse.json().status, "rejected");
  assert.equal(changedResponse.json().reason, "changed_replay");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 1);
  await app.close();
});

test("invalid signature, wrong event, mode, store, status, metadata, and amount never rank", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const invalid = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": "t=1,v1=bad" },
    payload: "{}",
  });
  assert.equal(invalid.statusCode, 400);
  for (const [deliveryId, changes, expectedStatus] of [
    ["wrong-event", {}, 400],
    ["wrong-event-id", {}, 400],
    ["wrong-store", { storeId: "STO_9999999999999999999999" }, 200],
    ["wrong-status", { orderStatus: "pending" }, 400],
    ["wrong-payment", { paymentStatus: "pending" }, 400],
    ["wrong-currency", { currency: "EUR" }, 400],
    ["wrong-amount", { amount: "11.00", subtotal: "11.00", total: "11.00" }, 200],
    ["wrong-tax-amount", { amount: "12.00", taxAmount: "1.00", subtotal: "12.00", total: "13.00" }, 200],
    ["wrong-tax-total", { amount: "13.00", taxAmount: "1.00", subtotal: "12.00", total: "12.00" }, 200],
    ["wrong-metadata", { orderMetadata: { ...(captured.body.metadata as object), siteUrl: "https://evil.example/" } }, 200],
  ] as const) {
    const signed = signedEvent(
      completedData(captured, changes),
      new Date().toISOString(),
      deliveryId,
      deliveryId === "wrong-store"
        ? { storeId: "STO_9999999999999999999999" }
        : deliveryId === "wrong-event"
          ? { eventType: "order.paid" }
          : deliveryId === "wrong-event-id"
            ? { eventId: "NOT_PAYMENT" }
            : {},
    );
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
      payload: signed.raw,
    });
    assert.equal(response.statusCode, expectedStatus, deliveryId);
  }
  assert.equal(listListingsForEpisode(db, "ep_12").length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM waffo_checkout_events").get() as { n: number }).n, 0);
  assert.ok(((db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_attempts").get() as { n: number }).n) >= 7);
  await app.close();
});

test("invalid signature does not reserve a valid delivery identity", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const signed = signedEvent(completedData(captured), new Date().toISOString(), "signature-retry");
  const invalid = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": "t=1,v1=invalid" },
    payload: signed.raw,
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_attempts").get() as { n: number }).n,
    0,
  );

  const valid = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.json().status, "paid");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 1);
  await app.close();
});

test("known-intent fact mismatch quarantines the intent against a second payment", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const mismatch = signedEvent(
    completedData(captured, { amount: "11.00", subtotal: "11.00", total: "11.00" }),
    new Date().toISOString(),
    "mismatch-first",
  );
  const first = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": mismatch.signature },
    payload: mismatch.raw,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().status, "needs_reconciliation");
  assert.equal(
    (db.prepare("SELECT status FROM checkout_intents LIMIT 1").get() as { status: string }).status,
    "needs_reconciliation",
  );

  const corrected = signedEvent(
    completedData(captured, {
      paymentId: "PAY_correct_12345678901234567890",
      orderId: "ORD_correct_12345678901234567890",
    }),
    new Date().toISOString(),
    "mismatch-second",
  );
  const second = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": corrected.signature },
    payload: corrected.raw,
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().status, "needs_reconciliation");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 0);
  await app.close();
});

test("provider event timestamp bounds reject stale and implausibly future settlements", async () => {
  for (const [label, timestamp] of [
    ["stale", "2020-01-01T00:00:00.000Z"],
    ["future", "2099-01-01T00:00:00.000Z"],
    ["date-only", new Date().toISOString().slice(0, 10)],
    ["rfc-1123", new Date().toUTCString()],
    ["offset", new Date().toISOString().replace("Z", "+00:00")],
    ["no-milliseconds", new Date().toISOString().replace(/\.\d{3}Z$/, "Z")],
  ] as const) {
    const captured: Captured = { path: "", body: {}, calls: 0 };
    const { db, port } = await startLive(captured);
    const app = await buildApp({ db, waffo: port });
    const signed = signedEvent(completedData(captured), timestamp, `timestamp-${label}`);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
      payload: signed.raw,
    });
    assert.equal(response.statusCode, 400, label);
    assert.equal(listListingsForEpisode(db, "ep_12").length, 0, label);
    await app.close();
  }
});

test("signed order.completed accepts nonzero tax only when subtotal, total, and amount reconcile exactly", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const signed = signedEvent(
    completedData(captured, {
      amount: "13.50",
      taxAmount: "1.50",
      subtotal: "12.00",
      total: "13.50",
    }),
    new Date().toISOString(),
    "nonzero-tax-valid",
  );
  const response = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "paid");
  assert.equal(listListingsForEpisode(db, "ep_12")[0]?.bidUsd, 12);
  await app.close();
});

test("money-field omission is distinct from malformed present subtotal or total", async () => {
  const omittedCaptured: Captured = { path: "", body: {}, calls: 0 };
  const omittedRun = await startLive(omittedCaptured);
  const omittedApp = await buildApp({ db: omittedRun.db, waffo: omittedRun.port });
  const omittedData: Record<string, unknown> = completedData(omittedCaptured);
  delete omittedData.subtotal;
  delete omittedData.total;
  const omitted = signedEvent(omittedData, new Date().toISOString(), "money-omitted");
  const omittedResponse = await omittedApp.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": omitted.signature },
    payload: omitted.raw,
  });
  assert.equal(omittedResponse.statusCode, 200);
  assert.equal(listListingsForEpisode(omittedRun.db, "ep_12").length, 1);
  await omittedApp.close();

  for (const field of ["subtotal", "total"] as const) {
    const captured: Captured = { path: "", body: {}, calls: 0 };
    const run = await startLive(captured);
    const app = await buildApp({ db: run.db, waffo: run.port });
    const malformed: Record<string, unknown> = completedData(captured);
    malformed[field] = "oops";
    const signed = signedEvent(malformed, new Date().toISOString(), `money-malformed-${field}`);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/waffo",
      headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
      payload: signed.raw,
    });
    assert.equal(response.statusCode, 400, field);
    assert.equal(listListingsForEpisode(run.db, "ep_12").length, 0);
    await app.close();
  }
});

test("return URL never settles a live checkout", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const intent = db.prepare("SELECT id FROM checkout_intents LIMIT 1").get() as { id: string };
  const response = await app.inject({
    method: "GET",
    url: `/checkout/complete?intent=${encodeURIComponent(intent.id)}`,
    headers: { accept: "text/html" },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /data-checkout-status="open"/);
  assert.match(response.body, /Payment has not been confirmed yet/);
  const json = await app.inject({
    method: "GET",
    url: `/checkout/complete?intent=${encodeURIComponent(intent.id)}`,
    headers: { accept: "application/json" },
  });
  assert.equal(json.statusCode, 200);
  assert.deepEqual(json.json(), { ok: true, intentId: intent.id, status: "open" });
  assert.equal(listListingsForEpisode(db, "ep_12").length, 0);
  await app.close();
});

test("durable signed reconciliation and exact retries are acknowledged", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port } = await startLive(captured);
  const app = await buildApp({ db, waffo: port });
  const intent = db.prepare("SELECT id FROM checkout_intents LIMIT 1").get() as { id: string };
  lockEpisode(db, "ep_12", new Date().toISOString());
  const signed = signedEvent(completedData(captured), new Date().toISOString(), "reconcile-delivery");

  const first = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().status, "needs_reconciliation");
  assert.equal((db.prepare("SELECT status FROM checkout_intents WHERE id = ?").get(intent.id) as { status: string }).status, "needs_reconciliation");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 0);

  const exactRetry = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(exactRetry.statusCode, 200);
  assert.equal(exactRetry.json().status, "needs_reconciliation");

  // Keep the business payload exactly equal while changing only delivery id.
  const secondRaw = signed.raw.replace('"id":"reconcile-delivery"', '"id":"reconcile-delivery-2"');
  const secondTimestamp = String(Date.now());
  const secondSigner = createSign("RSA-SHA256");
  secondSigner.update(`${secondTimestamp}.${secondRaw}`);
  secondSigner.end();
  const secondSignature = `t=${secondTimestamp},v1=${secondSigner.sign(privateKey, "base64")}`;
  const second = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": secondSignature },
    payload: secondRaw,
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().status, "needs_reconciliation");

  const changed = signedEvent(
    completedData(captured, { buyerEmail: "changed@example.test" }),
    new Date().toISOString(),
    "reconcile-delivery",
  );
  const changedResponse = await app.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": changed.signature },
    payload: changed.raw,
  });
  assert.equal(changedResponse.statusCode, 200);
  assert.equal(changedResponse.json().status, "rejected");
  assert.equal(changedResponse.json().reason, "changed_replay");
  assert.equal(listListingsForEpisode(db, "ep_12").length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM waffo_webhook_attempts").get() as { n: number }).n, 2);
  await app.close();
});

test("a signed event settles after restart on a second Waffo port without a provider call", async () => {
  const captured: Captured = { path: "", body: {}, calls: 0 };
  const { db, port: firstPort } = await startLive(captured);
  const firstApp = await buildApp({ db, waffo: firstPort });
  await firstApp.close();
  const secondPort = livePort(captured);
  const secondApp = await buildApp({ db, waffo: secondPort });
  const signed = signedEvent(completedData(captured), new Date().toISOString(), "restart-delivery");
  const response = await secondApp.inject({
    method: "POST",
    url: "/webhooks/waffo",
    headers: { "content-type": "application/json", "x-waffo-signature": signed.signature },
    payload: signed.raw,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "paid");
  assert.equal(captured.calls, 1);
  await secondApp.close();
});

test("fixture return settles atomically and is durable through a second app instance", async () => {
  const db = memoryDb();
  episode(db);
  const fixture = new FixtureWaffo();
  const app = await buildApp({ db, waffo: fixture });
  const started = await startCheckout(db, fixture, bodyForIntent());
  const first = await app.inject({ method: "GET", url: `/checkout/complete?checkoutId=${started.checkoutId}` });
  assert.equal(first.statusCode, 303);
  assert.equal(listListingsForEpisode(db, "ep_12").length, 1);
  const second = await app.inject({ method: "GET", url: `/checkout/complete?checkoutId=${started.checkoutId}` });
  assert.equal(second.statusCode, 303);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM waffo_checkout_events").get() as { n: number }).n, 1);
  await app.close();
});

test("stale captured raise enters reconciliation and never adds the difference", async () => {
  const db = memoryDb();
  const ep = episode(db);
  insertListing(db, {
    id: "lst_first",
    episodeId: ep.id,
    name: "First",
    siteUrl: "https://example.com/ada",
    oneLiner: "Initial claim",
    bidUsd: 12,
    firstBidAt: "2026-08-22T01:00:00.000Z",
    paidAt: "2026-08-22T01:00:01.000Z",
  });
  const fixture = new FixtureWaffo();
  const app = await buildApp({ db, waffo: fixture });
  const started = await startCheckout(db, fixture, { ...bodyForIntent(), bidUsd: 13 });
  insertListing(db, {
    id: "lst_race",
    episodeId: ep.id,
    name: "Race",
    siteUrl: "https://race.example/",
    oneLiner: "Won the race",
    bidUsd: 20,
    firstBidAt: "2026-08-22T02:00:00.000Z",
    paidAt: "2026-08-22T02:00:01.000Z",
  });
  const response = await app.inject({ method: "GET", url: `/checkout/complete?checkoutId=${started.checkoutId}` });
  assert.equal(response.statusCode, 409);
  assert.equal(listListingsForEpisode(db, ep.id).find((row) => row.id === "lst_first")?.bidUsd, 12);
  assert.equal((db.prepare("SELECT status FROM checkout_intents WHERE id = (SELECT id FROM checkout_intents WHERE provider_checkout_id = ?)").get(started.checkoutId) as { status: string }).status, "needs_reconciliation");
  await app.close();
});

test("vetoed and aged identities never receive a hidden difference quote", async () => {
  const scenarios = [
    {
      id: "vetoed",
      siteUrl: "https://vetoed.example/",
      paidAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      vetoedAt: new Date().toISOString(),
    },
    {
      id: "aged",
      siteUrl: "https://aged.example/",
      paidAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      vetoedAt: null,
    },
  ] as const;
  for (const scenario of scenarios) {
    const db = memoryDb();
    const ep = episode(db, `ep_${scenario.id}`);
    insertListing(db, {
      id: `lst_${scenario.id}`,
      episodeId: ep.id,
      name: `${scenario.id} guest`,
      siteUrl: scenario.siteUrl,
      oneLiner: "An existing identity.",
      bidUsd: 10,
      firstBidAt: scenario.paidAt,
      paidAt: scenario.paidAt,
      vetoedAt: scenario.vetoedAt,
      vetoReason: scenario.vetoedAt ? "Editorial fit" : null,
    });
    const body = {
      ...bodyForIntent(ep.id),
      siteUrl: scenario.siteUrl,
      bidUsd: 13,
    };
    const quote = quoteCheckout(db, body);
    assert.equal(quote.quote.kind, "open", scenario.id);
    assert.equal(quote.quote.chargeUsd, 13, scenario.id);

    const fixture = new FixtureWaffo();
    const app = await buildApp({ db, waffo: fixture });
    const started = await startCheckout(db, fixture, body);
    const response = await app.inject({
      method: "GET",
      url: `/checkout/complete?checkoutId=${started.checkoutId}`,
    });
    assert.equal(response.statusCode, 409, scenario.id);
    assert.equal(listListingsForEpisode(db, ep.id).length, 1, scenario.id);
    assert.equal(listListingsForEpisode(db, ep.id)[0]?.bidUsd, 10, scenario.id);
    const intent = db.prepare("SELECT status FROM checkout_intents LIMIT 1").get() as { status: string };
    assert.equal(intent.status, "needs_reconciliation", scenario.id);
    await app.close();
  }
});

test("direct settlement serializes two deliveries and rejects an unknown intent", () => {
  const db = memoryDb();
  episode(db);
  const unknown = settleVerifiedWaffoOrder(db, {
    deliveryId: "unknown-delivery",
    eventType: "order.completed",
    businessEventId: "unknown-event",
    paymentId: "unknown-payment",
    orderId: "unknown-order",
    intentId: "intent-does-not-exist",
    mode: "waffo-test",
    storeId: STORE_ID,
    eventTimestamp: new Date().toISOString(),
    payloadHash: "hash",
    eventFingerprint: "fingerprint",
    metadata: {},
    amountCents: 500,
    taxCents: 0,
  });
  assert.equal(unknown.status, "rejected");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n, 0);
});

test("failed Waffo migration rolls back and restores foreign-key enforcement", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run("003_waffo_checkout_state.sql");
    db.pragma("foreign_keys = OFF");
    db.exec("DROP TABLE checkout_intents");
    assert.equal(Number(db.pragma("foreign_keys", { simple: true })), 0);
    assert.throws(() => migrate(db), /no such table|checkout_intents|incomplete or incompatible Waffo state schema/);
    assert.equal(db.inTransaction, false);
    assert.equal(Number(db.pragma("foreign_keys", { simple: true })), 1);
  } finally {
    db.close();
  }
});

test("migration restart recovers committed schema and partial additive migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "guest-seat-migration-restart-"));
  const databasePath = join(directory, "guest-seat.sqlite");
  let db = openDatabase(databasePath);
  try {
    // Reproduce the old runner's durable state after DDL committed but before
    // its marker write, and after only the first 004 ALTER was applied.
    db.prepare("DELETE FROM schema_migrations WHERE id IN (?, ?)").run(
      "003_waffo_checkout_state.sql",
      "004_waffo_business_payload.sql",
    );
    db.exec("ALTER TABLE waffo_checkout_events DROP COLUMN business_payload_version");
    db.close();

    db = openDatabase(databasePath);
    const markers = db
      .prepare("SELECT id FROM schema_migrations ORDER BY id")
      .all() as Array<{ id: string }>;
    assert.deepEqual(
      markers.map((row) => row.id),
      [
        "001_init.sql",
        "002_polar_checkout_intents.sql",
        "003_waffo_checkout_state.sql",
        "004_waffo_business_payload.sql",
      ],
    );
    const columns = db
      .prepare("PRAGMA table_info(waffo_checkout_events)")
      .all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === "business_payload"));
    assert.ok(columns.some((column) => column.name === "business_payload_version"));
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migration refuses an incompatible 003 lookalike instead of repairing its marker", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("DELETE FROM schema_migrations WHERE id IN (?, ?)").run(
      "003_waffo_checkout_state.sql",
      "004_waffo_business_payload.sql",
    );
    db.pragma("foreign_keys = OFF");
    db.exec("DROP TABLE waffo_webhook_attempts");
    db.exec(`
      CREATE TABLE waffo_webhook_attempts (
        attempt_id TEXT,
        delivery_id TEXT,
        event_type TEXT,
        business_event_id TEXT,
        payment_id TEXT,
        order_id TEXT,
        intent_id TEXT,
        payload_hash TEXT,
        event_fingerprint TEXT,
        outcome TEXT,
        reason TEXT,
        received_at TEXT
      )
    `);
    db.pragma("foreign_keys = ON");

    assert.throws(() => migrate(db), /incomplete or incompatible Waffo state schema/);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = ?").get("003_waffo_checkout_state.sql") as { n: number }).n,
      0,
    );
    assert.equal(Number(db.pragma("foreign_keys", { simple: true })), 1);
  } finally {
    db.close();
  }
});

test("migration refuses malformed 004 columns instead of trusting their names", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run("004_waffo_business_payload.sql");
    db.pragma("foreign_keys = OFF");
    db.exec("ALTER TABLE waffo_checkout_events DROP COLUMN business_payload_version");
    db.exec("ALTER TABLE waffo_checkout_events ADD COLUMN business_payload_version TEXT");
    db.pragma("foreign_keys = ON");

    assert.throws(() => migrate(db), /incompatible Waffo business-payload schema/);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = ?").get("004_waffo_business_payload.sql") as { n: number }).n,
      0,
    );
    assert.equal(Number(db.pragma("foreign_keys", { simple: true })), 1);
  } finally {
    db.close();
  }
});
