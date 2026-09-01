import { buildApp } from "./app.js";
import { defaultDatabasePath } from "./db.js";

const LISTEN_HOSTS = new Set(["127.0.0.1", "0.0.0.0"]);

export function readListenHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LISTEN_HOST?.trim();
  const host = configured || "127.0.0.1";
  if (!LISTEN_HOSTS.has(host)) {
    throw new Error(`invalid LISTEN_HOST: ${env.LISTEN_HOST ?? ""}`);
  }
  return host;
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`invalid PORT: ${process.env.PORT ?? ""}`);
}
const listenHost = readListenHost();

const app = await buildApp({
  logger: true,
  databasePath: defaultDatabasePath(),
});
await app.listen({ host: listenHost, port });
