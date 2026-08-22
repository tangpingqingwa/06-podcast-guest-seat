import Fastify, { type FastifyInstance } from "fastify";
import { openDatabase, type AppDb } from "./db.js";
import { checkoutRoutes, createPolarPort } from "./http/routes/checkout.js";
import { goRoutes } from "./http/routes/go.js";
import { healthRoutes } from "./http/routes/health.js";
import { pageRoutes } from "./http/routes/pages.js";
import type { PolarPort } from "./polar/port.js";

declare module "fastify" {
  interface FastifyInstance {
    db: AppDb;
    polar: PolarPort;
  }
}

export type BuildAppOptions = {
  logger?: boolean;
  db?: AppDb;
  databasePath?: string;
  polar?: PolarPort;
};

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const ownsDb = options.db === undefined;
  const db =
    options.db ??
    openDatabase(options.databasePath ?? ":memory:");
  const polar = options.polar ?? createPolarPort();
  app.decorate("db", db);
  app.decorate("polar", polar);
  if (ownsDb) {
    app.addHook("onClose", async () => {
      db.close();
    });
  }
  await app.register(healthRoutes);
  await app.register(pageRoutes);
  await app.register(goRoutes);
  await app.register(checkoutRoutes);
  return app;
}
