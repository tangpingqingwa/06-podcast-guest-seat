-- A checkout is a local payment intent until a verified Polar order.paid event
-- settles it.  Drafts never join listings and provider IDs are not trusted
-- until they are bound to this row.
CREATE TABLE checkout_intents (
  id TEXT PRIMARY KEY,
  provider_checkout_id TEXT UNIQUE,
  provider_checkout_url TEXT,
  episode_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('open', 'raise')),
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  one_liner TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'usd'),
  expected_product_id TEXT NOT NULL,
  next_usd INTEGER NOT NULL CHECK (next_usd >= 5),
  status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'failed')),
  paid_at TEXT,
  provider_order_id TEXT UNIQUE,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES episodes (id)
);

CREATE INDEX checkout_intents_episode_id ON checkout_intents (episode_id);
CREATE INDEX checkout_intents_status ON checkout_intents (status);

-- The webhook ID is the stable Standard Webhooks event identity.  The order ID
-- is separately unique so an equivalent delivery cannot apply a second time.
CREATE TABLE polar_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome = 'accepted'),
  received_at TEXT NOT NULL
);
