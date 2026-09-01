-- Persist the canonical verified business payload used for replay equality.
-- The additive default lets existing accepted rows upgrade without inventing
-- provider fields that were never captured; new events always write the full
-- canonical payload.
ALTER TABLE waffo_checkout_events
  ADD COLUMN business_payload TEXT NOT NULL DEFAULT '';

-- Version 0 rows were accepted before the canonical raw business payload was
-- stored. A verified exact retry may backfill them; version 1 rows compare the
-- complete canonical payload on every subsequent retry.
ALTER TABLE waffo_checkout_events
  ADD COLUMN business_payload_version INTEGER NOT NULL DEFAULT 0
  CHECK (business_payload_version IN (0, 1));
