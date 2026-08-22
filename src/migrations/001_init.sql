-- Per-episode board. Listings never carry to a later episode.

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  label TEXT NOT NULL,
  seat_kind TEXT NOT NULL CHECK (seat_kind IN ('guest_seat', 'sixty_second_open')),
  veto_enabled INTEGER NOT NULL CHECK (veto_enabled IN (0, 1)),
  opens_at TEXT NOT NULL,
  locks_at TEXT,
  locked_at TEXT
);

CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  site_url TEXT NOT NULL,
  site_identity TEXT NOT NULL,
  one_liner TEXT NOT NULL CHECK (
    length(one_liner) BETWEEN 1 AND 140
    AND instr(one_liner, char(10)) = 0
    AND instr(one_liner, char(13)) = 0
  ),
  bid_usd INTEGER NOT NULL CHECK (bid_usd >= 5),
  first_bid_at TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  vetoed_at TEXT,
  veto_reason TEXT,
  UNIQUE (episode_id, site_identity),
  FOREIGN KEY (episode_id) REFERENCES episodes (id)
);

CREATE INDEX listings_episode_id ON listings (episode_id);
