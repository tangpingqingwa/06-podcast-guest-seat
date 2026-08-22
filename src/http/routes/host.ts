import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  lockEpisode,
  setVetoEnabled,
  VetoError,
  vetoListing,
} from "../../veto.js";

export const HOST_VETO_PATH = "/host/veto" as const;
export const HOST_LOCK_PATH = "/host/lock" as const;
export const HOST_VETO_ENABLED_PATH = "/host/veto-enabled" as const;

/** Fixture / local tests only. Production must set `HOST_SESSION_SECRET`. */
export const DEV_HOST_SESSION_SECRET = "dev-host-session";

export function hostSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOST_SESSION_SECRET?.trim() ?? "";
}

export function sessionMatches(
  provided: string | undefined,
  expected: string,
): boolean {
  if (!provided || !expected) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function readHostSession(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = match?.[1]?.trim();
    if (token) {
      return token;
    }
  }
  const custom = request.headers["x-host-session"];
  if (typeof custom === "string" && custom.trim()) {
    return custom.trim();
  }
  if (isRecord(request.body)) {
    return readString(request.body.session);
  }
  return undefined;
}

function requireHostSession(
  request: FastifyRequest,
  reply: FastifyReply,
  expected: string,
): boolean {
  if (!expected) {
    void reply.code(503).send({ error: "host_unconfigured" });
    return false;
  }
  if (!sessionMatches(readHostSession(request), expected)) {
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

function sendHostError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof VetoError) {
    return reply.code(err.statusCode).send({ error: err.code });
  }
  throw err;
}

function parseVetoEnabled(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  return undefined;
}

export const hostRoutes: FastifyPluginAsync = async (app) => {
  app.post(HOST_VETO_PATH, async (request, reply) => {
    if (!requireHostSession(request, reply, app.hostSessionSecret)) {
      return;
    }
    const body = isRecord(request.body) ? request.body : {};
    const episodeId = readString(body.episodeId);
    const listingId = readString(body.listingId);
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!episodeId || !listingId) {
      return reply.code(400).send({ error: "invalid_veto" });
    }
    try {
      const result = vetoListing(app.db, { episodeId, listingId, reason });
      return {
        ok: true,
        listing: result.listing,
        booked: result.booked ?? null,
      };
    } catch (err) {
      return sendHostError(reply, err);
    }
  });

  app.post(HOST_LOCK_PATH, async (request, reply) => {
    if (!requireHostSession(request, reply, app.hostSessionSecret)) {
      return;
    }
    const body = isRecord(request.body) ? request.body : {};
    const episodeId = readString(body.episodeId);
    if (!episodeId) {
      return reply.code(400).send({ error: "invalid_lock" });
    }
    try {
      const result = lockEpisode(app.db, episodeId);
      return {
        ok: true,
        episode: result.episode,
        booked: result.booked ?? null,
      };
    } catch (err) {
      return sendHostError(reply, err);
    }
  });

  app.post(HOST_VETO_ENABLED_PATH, async (request, reply) => {
    if (!requireHostSession(request, reply, app.hostSessionSecret)) {
      return;
    }
    const body = isRecord(request.body) ? request.body : {};
    const episodeId = readString(body.episodeId);
    const vetoEnabled = parseVetoEnabled(body.vetoEnabled);
    if (!episodeId || vetoEnabled === undefined) {
      return reply.code(400).send({ error: "invalid_veto_enabled" });
    }
    try {
      const episode = setVetoEnabled(app.db, episodeId, vetoEnabled);
      return { ok: true, episode };
    } catch (err) {
      return sendHostError(reply, err);
    }
  });
};
