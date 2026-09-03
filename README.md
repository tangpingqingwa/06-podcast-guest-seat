# Podcast Guest Seat

Pay-to-rank auction for the next podcast **guest seat** or **60-second open**. Rank is the bid. Host veto is on by default for guest seat.

The public `/` rundown opens one empty guest-seat episode automatically when
needed. After a host lock—or when `locksAt` has passed—the next public visit
rolls forward to one fresh empty board. Opening never creates a paid listing;
only a confirmed Waffo checkout claims rank.

- Product contract: [SPEC.md](./SPEC.md)
- How we build: [BUILD.md](./BUILD.md)
- How we work: [CONTRIBUTING.md](./CONTRIBUTING.md)

`main` stays buildable and testable. Offline gate: `bash scripts/test.sh`.
