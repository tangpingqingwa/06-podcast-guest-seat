import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const ICON_NAMES = [
  "brand-mark.svg",
  "brand-mark.png",
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
    readFileSync(resolve(iconDirectory, name)),
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
      .type(request.params.name.endsWith(".png") ? "image/png" : "image/svg+xml; charset=utf-8")
      .send(icon);
  });

  app.get("/favicon.ico", async (_request, reply) => {
    await reply
      .header("Cache-Control", "public, max-age=86400")
      .type("image/png")
      .send(icons.get("brand-mark.png"));
  });

  app.get("/robots.txt", async (_request, reply) => {
    await reply
      .header("Cache-Control", "public, max-age=3600")
      .type("text/plain; charset=utf-8")
      .send("User-agent: *\nAllow: /\nDisallow: /checkout/\nDisallow: /go/\nDisallow: /host/\nSitemap: https://podcastseat.lol/sitemap.xml\n");
  });

  app.get("/sitemap.xml", async (_request, reply) => {
    await reply
      .header("Cache-Control", "public, max-age=3600")
      .type("application/xml; charset=utf-8")
      .send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://podcastseat.lol</loc><changefreq>daily</changefreq><priority>1.0</priority></url><url><loc>https://podcastseat.lol/about</loc><changefreq>monthly</changefreq></url><url><loc>https://podcastseat.lol/rules</loc><changefreq>monthly</changefreq></url></urlset>');
  });

  app.get("/site.webmanifest", async (_request, reply) => {
    await reply
      .header("Cache-Control", "public, max-age=3600")
      .type("application/manifest+json")
      .send({ name: "Podcast Guest Seat", short_name: "Guest Seat", start_url: "/", display: "standalone", background_color: "#fffdfb", theme_color: "#d9785b", icons: [{ src: "/icons/brand-mark.png", sizes: "512x512", type: "image/png" }] });
  });
}
