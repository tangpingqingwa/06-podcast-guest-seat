import Fastify, { type FastifyInstance } from "fastify";
import { openDatabase, type AppDb } from "./db.js";
import { goRoutes } from "./http/routes/go.js";
import { healthRoutes } from "./http/routes/health.js";
import { pageRoutes } from "./http/routes/pages.js";

declare module "fastify" {
  interface FastifyInstance {
    db: AppDb;
  }
}

export type BuildAppOptions = {
  logger?: boolean;
  db?: AppDb;
  databasePath?: string;
};

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const ownsDb = options.db === undefined;
  const db =
    options.db ??
    openDatabase(options.databasePath ?? ":memory:");
  app.decorate("db", db);
  if (ownsDb) {
    app.addHook("onClose", async () => {
      db.close();
    });
  }
  await app.register(healthRoutes);
  await app.register(pageRoutes);
  await app.register(goRoutes);
  return app;
}
