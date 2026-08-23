# Podcast Guest Seat — one-VPS runbook

Single Docker host. SQLite on a volume. Caddy (or nginx) terminates TLS.

This is the global English [outbid.lol](https://outbid.lol/) guest-seat vertical: bid whole USD for the next episode’s guest seat or a 60-second open. Rank is the bid. Host veto defaults **on** for `guest_seat`. Polar stays on the in-process fixture until the operator sets live flags.

## Env

Copy [`.env.example`](../.env.example) to `/etc/guest-seat.env` (mode `600`). Set:

| Variable | Production |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | listen port (default `3000`) |
| `DATABASE_PATH` | required; must sit on the volume, e.g. `/app/data/guest-seat.sqlite` |
| `HOST_SESSION_SECRET` | required for host veto / lock |
| `POLAR_LIVE` | leave unset (or `0`) until soak. `1` selects live Polar |
| `POLAR_FIXTURE_ONLY` | leave unset on the VPS. `1` wins over `POLAR_LIVE` (CI / `scripts/test.sh`) |
| `POLAR_ACCESS_TOKEN` | live Polar only; missing secret fails closed |
| `POLAR_WEBHOOK_SECRET` | live webhook HMAC; missing secret fails closed |
| `POLAR_API_BASE` | optional. Default is production Polar. Sandbox smoke uses `https://sandbox-api.polar.sh` |
| `POLAR_PRODUCT_ID` | optional Polar product for custom USD checkout |

Do not bake secrets into the image. Do not commit `.env`. A bind-mount over `/app/data` must be writable by uid `1000` (`node`). Image and CI do not set `POLAR_LIVE`.

## Build and run

```bash
docker build -t guest-seat:local .
docker run -d --name guest-seat --restart unless-stopped --init \
  --env-file /etc/guest-seat.env \
  -p 127.0.0.1:3000:3000 \
  -v guest-seat-data:/app/data \
  guest-seat:local
```

The process listens on `0.0.0.0:$PORT` as the non-root `node` user (uid 1000). Keep the published port on loopback and terminate TLS on Caddy.

Example Caddy site:

```
guest.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## Health

`GET /healthz` → `200 {"ok":true}`. No auth.

```bash
curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz"
```

Public board (English UI): `/`, `/about`, `/rules`. Clicks: `GET /go/:listingId`. With no episode open, `/` shows a host desk (`POST /host/open`) so the first-time host can unlock Polar. Host veto is on by default for a guest-seat episode.

## Enable live Polar

1. Confirm `/healthz` is green with live off (fixture Polar). Checkout claims rank without calling Polar hosts.
2. Set `POLAR_LIVE=1`, `POLAR_ACCESS_TOKEN`, and `POLAR_WEBHOOK_SECRET`. Leave `POLAR_FIXTURE_ONLY` unset.
3. Recreate the container. Missing secrets fail closed (`BLOCKED-SECRET`). `POLAR_FIXTURE_ONLY=1` keeps the fixture even if live is set.
4. Point Polar at `POST /webhooks/polar`. Abandoned checkout does not list.
5. Leave live flags unset in CI. `scripts/test.sh` sets `POLAR_FIXTURE_ONLY=1` and unsets `POLAR_LIVE`.

Roll back: unset `POLAR_LIVE` (or set `POLAR_FIXTURE_ONLY=1`) and recreate. Do not run live Polar from CI.

## Data

Back up the SQLite file on the volume (copy is enough). Prior episode bids do not carry when a new episode opens.
