import Fastify, { type FastifyInstance } from "fastify";
import { openDatabase, type AppDb } from "./db.js";
import { checkoutRoutes, createWaffoPort } from "./http/routes/checkout.js";
import { registerAssetRoutes } from "./http/routes/assets.js";
import { goRoutes } from "./http/routes/go.js";
import { healthRoutes } from "./http/routes/health.js";
import {
  hostRoutes,
  hostSessionSecret,
  requireHostSessionSecret,
} from "./http/routes/host.js";
import { pageRoutes } from "./http/routes/pages.js";
import { FixtureWaffo } from "./waffo/fixture.js";
import { isProductionLike, readWaffoConfig } from "./waffo/live.js";
import type { WaffoPort } from "./waffo/port.js";

declare module "fastify" {
  interface FastifyInstance {
    db: AppDb;
    /** Waffo is the sole payment provider at runtime. */
    waffo: WaffoPort;
    hostSessionSecret: string;
  }
}

export type BuildAppOptions = {
  logger?: boolean;
  db?: AppDb;
  databasePath?: string;
  waffo?: WaffoPort;
  hostSessionSecret?: string;
};

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const production = isProductionLike();
  const injectedWaffo = options.waffo;
  if (production && injectedWaffo !== undefined) {
    throw new Error("BLOCKED-CONFIG: production Waffo injection is forbidden");
  }
  const productionConfig = production
    ? readWaffoConfig(process.env, { requireDatabase: true })
    : undefined;
  if (production) {
    if (
      options.databasePath !== undefined &&
      options.databasePath.trim() !== productionConfig!.databasePath
    ) {
      throw new Error("BLOCKED-CONFIG: DATABASE_PATH");
    }
    // A caller-provided connection cannot be proven to be the configured
    // durable production database. Reject it so buildApp cannot bypass the
    // startup storage boundary with an in-memory/test connection.
    if (options.db !== undefined) {
      throw new Error("BLOCKED-CONFIG: production database injection");
    }
    // Host lifecycle authorization must come from deployment configuration;
    // an in-process option must not turn an unready production process into a
    // healthy one or replace its operator secret.
    if (options.hostSessionSecret !== undefined) {
      throw new Error("BLOCKED-CONFIG: production host session injection");
    }
  }
  const productionHostSessionSecret = production
    ? requireHostSessionSecret(process.env)
    : undefined;
  const app = Fastify({ logger: options.logger ?? false });
  const ownsDb = options.db === undefined;
  const db =
    options.db ??
    openDatabase(production ? productionConfig!.databasePath : options.databasePath ?? ":memory:");
  // Every explicitly selected mode goes through the strict provider factory,
  // including non-production server processes. Missing mode remains the
  // test/development fixture default; an explicit live mode can never fall
  // through to a fixture. Injected ports are reserved for unit tests/callers.
  const configuredWaffoMode = process.env.WAFFO_MODE;
  const waffo =
    injectedWaffo ??
    (configuredWaffoMode === undefined
      ? new FixtureWaffo()
      : createWaffoPort(process.env));
  app.decorate("db", db);
  app.decorate("waffo", waffo);
  app.decorate(
    "hostSessionSecret",
    productionHostSessionSecret ?? options.hostSessionSecret ?? hostSessionSecret(),
  );
  if (ownsDb) {
    app.addHook("onClose", async () => {
      db.close();
    });
  }
  registerAssetRoutes(app);
  await app.register(healthRoutes);
  await app.register(pageRoutes);
  await app.register(goRoutes);
  await app.register(checkoutRoutes);
  await app.register(hostRoutes);
  return app;
}
