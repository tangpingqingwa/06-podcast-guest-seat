import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  EpisodeError,
  isSeatKind,
  openNextEpisode,
} from "../../episodes.js";
import {
  lockEpisode,
  setVetoEnabled,
  VetoError,
  vetoListing,
} from "../../veto.js";
import { renderHostLockErrorHtml, renderHostOpenErrorHtml } from "./pages.js";

export const HOST_VETO_PATH = "/host/veto" as const;
export const HOST_LOCK_PATH = "/host/lock" as const;
export const HOST_VETO_ENABLED_PATH = "/host/veto-enabled" as const;
export const HOST_OPEN_PATH = "/host/open" as const;

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

function wantsHtml(request: FastifyRequest): boolean {
  const type = String(request.headers["content-type"] ?? "");
  const accept = String(request.headers.accept ?? "");
  return (
    type.includes("application/x-www-form-urlencoded") ||
    (/\btext\/html\b/.test(accept) && !/\bapplication\/json\b/.test(accept))
  );
}

function requireHostSession(
  request: FastifyRequest,
  reply: FastifyReply,
  expected: string,
  asHtml = false,
  renderHtmlError: (code: string) => string = renderHostOpenErrorHtml,
): boolean {
  if (!expected) {
    if (asHtml) {
      void reply
        .code(503)
        .type("text/html; charset=utf-8")
        .send(renderHtmlError("host_unconfigured"));
    } else {
      void reply.code(503).send({ error: "host_unconfigured" });
    }
    return false;
  }
  if (!sessionMatches(readHostSession(request), expected)) {
    if (asHtml) {
      void reply
        .code(401)
        .type("text/html; charset=utf-8")
        .send(renderHtmlError("unauthorized"));
    } else {
      void reply.code(401).send({ error: "unauthorized" });
    }
    return false;
  }
  return true;
}

function sendHostError(
  reply: FastifyReply,
  err: unknown,
  asHtml = false,
  renderHtmlError: (code: string) => string = renderHostOpenErrorHtml,
): FastifyReply {
  if (err instanceof VetoError || err instanceof EpisodeError) {
    if (asHtml) {
      return reply
        .code(err.statusCode)
        .type("text/html; charset=utf-8")
        .send(renderHtmlError(err.code));
    }
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
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      const raw = typeof body === "string" ? body : body.toString("utf8");
      done(null, Object.fromEntries(new URLSearchParams(raw)));
    },
  );

  app.post(HOST_OPEN_PATH, async (request, reply) => {
    const html = wantsHtml(request);
    if (!requireHostSession(request, reply, app.hostSessionSecret, html)) {
      return;
    }
    const body = isRecord(request.body) ? request.body : {};
    const label = readString(body.label);
    const seatKindRaw = readString(body.seatKind);
    const seatKind = seatKindRaw ?? "guest_seat";
    if (!isSeatKind(seatKind)) {
      if (html) {
        return reply
          .code(400)
          .type("text/html; charset=utf-8")
          .send(renderHostOpenErrorHtml("invalid_open"));
      }
      return reply.code(400).send({ error: "invalid_open" });
    }
    try {
      const episode = openNextEpisode(app.db, { label, seatKind });
      if (html) {
        return reply.redirect("/", 303);
      }
      return { ok: true, episode };
    } catch (err) {
      return sendHostError(reply, err, html);
    }
  });

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
    const html = wantsHtml(request);
    if (
      !requireHostSession(
        request,
        reply,
        app.hostSessionSecret,
        html,
        renderHostLockErrorHtml,
      )
    ) {
      return;
    }
    const body = isRecord(request.body) ? request.body : {};
    const episodeId = readString(body.episodeId);
    if (!episodeId) {
      if (html) {
        return reply
          .code(400)
          .type("text/html; charset=utf-8")
          .send(renderHostLockErrorHtml("invalid_lock"));
      }
      return reply.code(400).send({ error: "invalid_lock" });
    }
    try {
      const result = lockEpisode(app.db, episodeId);
      if (html) {
        return reply.redirect("/", 303);
      }
      return {
        ok: true,
        episode: result.episode,
        booked: result.booked ?? null,
      };
    } catch (err) {
      return sendHostError(reply, err, html, renderHostLockErrorHtml);
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
