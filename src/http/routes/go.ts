import type { FastifyPluginAsync } from "fastify";
import { canonicalizeSiteUrl, HygieneError } from "../../hygiene.js";
import { getListing, incrementListingClicks } from "../../listings.js";
import { isPaidListing } from "../../rank.js";

export const GO_PATH = "/go/:listingId" as const;

export const goRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { listingId: string } }>(
    GO_PATH,
    async (request, reply) => {
      const listing = getListing(app.db, request.params.listingId);
      if (!listing || !isPaidListing(listing)) {
        return reply.code(404).send({ error: "listing_not_found" });
      }

      let target: string;
      try {
        target = canonicalizeSiteUrl(listing.siteUrl);
      } catch (err) {
        if (err instanceof HygieneError) {
          return reply.code(404).send({ error: "listing_not_found" });
        }
        throw err;
      }

      incrementListingClicks(app.db, listing.id);
      return reply.redirect(target, 302);
    },
  );
};
