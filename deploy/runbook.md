# Podcast Guest Seat — one-VPS Waffo runbook

Single Docker host. SQLite lives on a durable volume. Caddy (or nginx)
terminates HTTPS before forwarding to the Node process.

Waffo Pancake is the sole production merchant of record for the podcast guest seat.
The service has three
explicit provider modes; it never infers a live mode from missing variables:

| Mode | Use | Network / persistence |
|---|---|---|
| `fixture` | local development, tests, and CI | no provider calls; disposable or local SQLite |
| `waffo-test` | authorized provider test environment | Waffo test API/webhook keys and an isolated durable SQLite file |
| `waffo-prod` | production payments | Waffo production key, HTTPS callback, registered webhook, and durable SQLite |

## Environment

Copy [`.env.example`](../.env.example) to `/etc/guest-seat.env` (mode `600`).
Set only the mode and environment appropriate for the deployment:

| Variable | Required value |
|---|---|
| `NODE_ENV` | `production` on the VPS |
| `PORT` | listen port, normally `3000` |
| `LISTEN_HOST` | `127.0.0.1` for a direct host/systemd process; the Docker command below explicitly sets the container to `0.0.0.0` |
| `DATABASE_PATH` | durable volume path, e.g. `/app/data/guest-seat.sqlite`; never `:memory:` for test/prod |
| `HOST_SESSION_SECRET` | non-empty deployment secret for host open/veto/lock; startup fails closed when absent |
| `WAFFO_MODE` | exactly `waffo-test` or `waffo-prod` on a live process |
| `WAFFO_MERCHANT_ID` | Waffo merchant identifier from deployment secret storage |
| `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_FILE` | Waffo signing key; prefer the mounted file |
| `WAFFO_STORE_ID` | store matching the selected Waffo environment |
| `WAFFO_PRODUCT_ID` | active one-time Rank product matching the selected environment |
| `WAFFO_PUBLIC_BASE_URL` | public, non-private HTTPS origin with no query or fragment |
| `WAFFO_API_BASE` | official `https://api.waffo.ai` API origin; production rejects overrides |
| `WAFFO_CHECKOUT_TIMEOUT_MS` | optional bounded provider deadline; default `15000` |
| `WAFFO_TEST_WEBHOOK_PUBLIC_KEY` | required for `waffo-test` signature verification |
| `WAFFO_PROD_WEBHOOK_PUBLIC_KEY` | required for `waffo-prod` signature verification |

Do not bake secrets into the image or commit `/etc/guest-seat.env`. Startup
fails closed when mode, credentials, expected store/product, webhook key,
public HTTPS URL, host session secret, or durable database configuration is
absent or inconsistent.
The image and CI must not select a live mode or contain provider secrets.

## Build and run

```bash
docker build -t guest-seat:local .
docker run -d --name guest-seat --restart unless-stopped --init \
  --env-file /etc/guest-seat.env \
  -e LISTEN_HOST=0.0.0.0 \
  -p 127.0.0.1:3000:3000 \
  -v guest-seat-data:/app/data \
  guest-seat:local
```

The container process listens on `0.0.0.0:$PORT` as the non-root `node` user so
Docker bridge port publishing can reach it. The host-published port remains
`127.0.0.1` and Caddy is the only HTTPS edge:

```
guest.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

For a direct host/systemd launch (outside Docker), force the real host
loopback boundary with `Environment=LISTEN_HOST=127.0.0.1` in the service unit.
The server accepts only `127.0.0.1` and `0.0.0.0`; do not expose a host process
on a non-loopback address. The Docker command's explicit `-e` override is what
allows the container-only bind without relaxing that host/systemd rule.

## Health and routes

After startup validation succeeds, `GET /healthz` returns `200 {"ok":true}`.
Missing or empty `HOST_SESSION_SECRET` prevents a production-like process from
starting, so it cannot claim healthy while host lifecycle controls are
unconfigured. Check it after every restart:

```bash
curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz"
```

The public board is `/`, `/about`, `/rules`, and `/go/:listingId`. Checkout
creation is `POST /checkout`. Only a verified Waffo `order.completed` received
at `POST /webhooks/waffo` can settle a live listing. The browser return URL
never settles a live payment. The first public visit opens an empty guest-seat
board when none is unlocked; a host lock or an elapsed `locksAt` rolls the
current board to one fresh empty episode on the next request. This is a
request-boundary SQLite transaction, not a separate scheduler.

## Waffo test and production setup

1. Run `WAFFO_MODE=fixture` locally or in CI. The fixture must complete a
   checkout without network calls; `scripts/live-smoke.sh` is an offline smoke.
2. For `waffo-test`, provision test-only credentials, product/store IDs, the
   test webhook public key, an isolated durable database, and an HTTPS test
   origin. Confirm startup refuses missing configuration before any checkout
   call.
3. For `waffo-prod`, provision the managed production private key through the
   deployment secret store, set the production IDs and public key, and confirm
   the HTTPS origin is stable. Do not put private keys in this runbook.
4. After the HTTPS endpoint is deployed, register the Waffo webhook at
   `POST https://<public-host>/webhooks/waffo` in the matching Waffo
   environment. Configure the provider to send the raw signed event and keep
   the signing public key in the corresponding `WAFFO_*_WEBHOOK_PUBLIC_KEY`
   secret. Webhook registration is an authorized external operation; this
   repository does not perform it.
5. Send only an authorized signed test event after registration. The service
   accepts exact `order.completed` fields, persists the delivery/business
   identities and payload hash, and ranks only after an atomic database commit.

## Failure, rollback, and reconciliation

An API timeout, connection reset, 5xx, invalid response, or crash after a
checkout request is an ambiguous `unknown` intent. It is retained, never
released into a free rank, and can be recovered by its matching signed event.
Invalid signatures, mismatched mode/store/order/payment/currency/amount, and
changed replays are rejected without ranking.

If a captured payment cannot safely mutate the current board, the intent is
marked `needs_reconciliation`; it must not be retried as a new bid or converted
to a stale raise. Preserve the SQLite file and provider identifiers while an
operator reconciles it.

For rollback, stop the current container, retain a verified copy of the SQLite
volume, and start the last known-compatible image with the same durable path.
Do not downgrade across a migration, reset the database, or switch a
production process to fixture mode. Re-run the health check and the signed
webhook smoke only after the rollback is authorized. Keep CI and local tests in
`fixture` mode throughout.

Back up the SQLite file on the volume before schema changes. Prior episode bids
do not carry when a new episode opens.
