import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const ICON_NAMES = [
  "bitcoin.svg",
  "bot.svg",
  "chevron-down.svg",
  "chevron-right.svg",
  "code-xml.svg",
  "globe.svg",
  "heart-pulse.svg",
  "layout-grid-light.svg",
  "linkie.svg",
  "megaphone.svg",
  "moon.svg",
  "outbid-mark.svg",
  "rail-bot.svg",
  "rail-megaphone.svg",
  "scale.svg",
  "search-check-accent.svg",
  "search-check.svg",
  "search.svg",
  "share-2.svg",
  "shield-check.svg",
  "trophy.svg",
] as const;

const compiledIconDirectory = fileURLToPath(
  new URL("../../public/icons/", import.meta.url),
);
const repositoryIconDirectory = fileURLToPath(
  new URL("../../../public/icons/", import.meta.url),
);
const iconDirectory = existsSync(compiledIconDirectory)
  ? compiledIconDirectory
  : repositoryIconDirectory;
const icons = new Map(
  ICON_NAMES.map((name) => [
    name,
    readFileSync(resolve(iconDirectory, name), "utf8"),
  ]),
);

export function registerAssetRoutes(app: FastifyInstance): void {
  app.get<{ Params: { name: string } }>("/icons/:name", async (request, reply) => {
    const icon = icons.get(request.params.name as (typeof ICON_NAMES)[number]);
    if (!icon) {
      await reply.code(404).type("text/plain; charset=utf-8").send("Not found");
      return;
    }
    await reply
      .header("Cache-Control", "public, max-age=86400")
      .type("image/svg+xml; charset=utf-8")
      .send(icon);
  });
}
