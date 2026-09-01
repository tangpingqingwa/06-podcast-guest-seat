-- Waffo settlement state. 002 is retained as an upgrade source for the
-- interrupted Polar implementation, but no runtime code reads its tables.
-- src/db.ts owns the immediate transaction and temporary foreign-key boundary.

ALTER TABLE checkout_intents RENAME TO checkout_intents_legacy;
DROP INDEX IF EXISTS checkout_intents_episode_id;
DROP INDEX IF EXISTS checkout_intents_status;

CREATE TABLE checkout_intents (
  id TEXT PRIMARY KEY,
  provider_checkout_id TEXT UNIQUE,
  provider_checkout_url TEXT,
  provider_expires_at TEXT,
  episode_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  board_window_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('open', 'raise')),
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  one_liner TEXT NOT NULL,
  intent_fingerprint TEXT NOT NULL,
  normalized_payload TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fixture', 'waffo-test', 'waffo-prod')),
  expected_store_id TEXT NOT NULL,
  expected_product_id TEXT NOT NULL,
  expected_currency TEXT NOT NULL CHECK (expected_currency = 'USD'),
  tax_category TEXT NOT NULL CHECK (tax_category = 'digital_goods'),
  quote_base_cents INTEGER NOT NULL CHECK (quote_base_cents >= 0),
  target_bid_cents INTEGER NOT NULL CHECK (target_bid_cents >= 500),
  charge_cents INTEGER NOT NULL CHECK (charge_cents > 0),
  -- Compatibility names remain for older read-only diagnostics.
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  expected_product_id_legacy TEXT,
  next_usd INTEGER NOT NULL CHECK (next_usd >= 5),
  status TEXT NOT NULL CHECK (
    status IN ('creating', 'open', 'unknown', 'paid', 'rejected', 'needs_reconciliation')
  ),
  paid_at TEXT,
  provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT UNIQUE,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes (id)
);

INSERT INTO checkout_intents (
  id, provider_checkout_id, provider_checkout_url, provider_expires_at,
  episode_id, listing_id, kind, name, site_url, one_liner,
  board_window_key,
  intent_fingerprint, normalized_payload, mode, expected_store_id,
  expected_product_id, expected_currency, tax_category,
  quote_base_cents, target_bid_cents, charge_cents,
  amount_cents, currency, expected_product_id_legacy, next_usd,
  status, paid_at, provider_order_id, provider_payment_id, failure_code,
  created_at, updated_at
)
SELECT
  id, provider_checkout_id, provider_checkout_url, NULL,
  episode_id, episode_id, kind, name, site_url, one_liner,
  'legacy:' || id,
  'legacy:' || id,
  '{"legacy":true,"intentId":"' || replace(id, '"', '') || '"}',
  'fixture', 'fixture-store', expected_product_id, 'USD', 'digital_goods',
  CASE WHEN kind = 'raise' THEN MAX(0, amount_cents - CAST(next_usd * 100 AS INTEGER)) ELSE 0 END,
  next_usd * 100, amount_cents,
  amount_cents, 'USD', expected_product_id, next_usd,
  CASE status WHEN 'open' THEN 'open' WHEN 'paid' THEN 'paid' ELSE 'rejected' END,
  paid_at, provider_order_id, NULL, failure_code, created_at, updated_at
FROM checkout_intents_legacy;

DROP TABLE checkout_intents_legacy;

CREATE INDEX checkout_intents_episode_id ON checkout_intents (episode_id);
CREATE INDEX checkout_intents_status ON checkout_intents (status);
CREATE INDEX checkout_intents_fingerprint ON checkout_intents (intent_fingerprint);

-- Accepted business events are unique across delivery, event, payment, order,
-- and local intent. This table is written in the same transaction as ranking.
CREATE TABLE waffo_checkout_events (
  delivery_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  business_event_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  store_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  event_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome = 'accepted'),
  reason TEXT,
  event_timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (event_type, business_event_id),
  UNIQUE (payment_id),
  UNIQUE (order_id),
  UNIQUE (intent_id),
  FOREIGN KEY (intent_id) REFERENCES checkout_intents (id)
);

CREATE INDEX waffo_checkout_events_order_id ON waffo_checkout_events (order_id);
CREATE INDEX waffo_checkout_events_intent_id ON waffo_checkout_events (intent_id);

-- Every cryptographically invalid, mismatched, replayed, or recoverable
-- delivery is retained without granting rank. Unlike accepted events, failed
-- attempts may share a delivery id so a changed replay can be audited.
CREATE TABLE waffo_webhook_attempts (
  attempt_id TEXT PRIMARY KEY,
  delivery_id TEXT,
  event_type TEXT,
  business_event_id TEXT,
  payment_id TEXT,
  order_id TEXT,
  intent_id TEXT,
  payload_hash TEXT NOT NULL,
  event_fingerprint TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('rejected', 'needs_reconciliation')),
  reason TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (delivery_id, payload_hash)
);
