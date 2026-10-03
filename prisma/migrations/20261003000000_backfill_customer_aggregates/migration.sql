-- Backfill the denormalized customer aggregates from their source-of-truth
-- ledgers. Customer.lifetimeRevenue now recomputes from Payment rows on every
-- settlement, and totalBookings increments on every booking; this migration
-- aligns any rows that existed before those write paths were added.
UPDATE "Customer" c
SET "lifetimeRevenue" = COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."customerId" = c.id), 0),
    "totalBookings" = (SELECT COUNT(*) FROM "Job" j WHERE j."customerId" = c.id);
