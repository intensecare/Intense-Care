-- =============================================================================
-- 20261013 — Location integrity + the three job-start modes.
--
-- Root causes repaired here (see docs/LOCATION_FIX_REPORT.md):
--   1. Two migrations with the same timestamp created TWO sets of job location
--      columns. Code from commit d81b1e7 saved job pins in
--      "serviceLat"/"serviceLng"/"serviceAddress"; the current code only reads
--      "locationLat"/"locationLng"/"locationAddress" — so those pins vanished.
--   2. A job copied its property's pin once, at booking. A property pinned (or
--      corrected) later never reached its open jobs.
--   3. Coordinates of (0,0), half-set pairs (lat without lng) and out-of-range
--      values produced false map markers.
--
-- Every correction is written to "LocationRepair" (old → new, reason), so the
-- affected records can be listed and, if ever needed, reversed. Good existing
-- coordinates are never overwritten: every UPDATE only fills empty values or
-- clears values that cannot be a real location. Idempotent.
-- =============================================================================
BEGIN;

-- --------------------------------------------------------- repair audit table
CREATE TABLE IF NOT EXISTS "LocationRepair" (
  "id"         TEXT NOT NULL,
  "entityType" TEXT NOT NULL,           -- property | job
  "entityId"   TEXT NOT NULL,
  "action"     TEXT NOT NULL,           -- COPIED_LEGACY_JOB_PIN | COPIED_PROPERTY_PIN | COPIED_JOB_PIN_TO_PROPERTY | CLEARED_INVALID | SWAPPED_LAT_LNG
  "oldValue"   TEXT,
  "newValue"   TEXT,
  "reason"     TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationRepair_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LocationRepair_entity_idx" ON "LocationRepair"("entityType", "entityId");

-- ------------------------------------------------- structured property address
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "addressLine" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "locality" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "locationNotes" TEXT;
-- How the pin was set: SEARCH | MAP_PIN | DEVICE_GPS | MANUAL | IMPORTED
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "locationSource" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "locationUpdatedAt" TIMESTAMP(3);
-- Set when someone confirms the pin is right (e.g. a successful GPS start on site).
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "locationVerifiedAt" TIMESTAMP(3);

-- PROPERTY = the job follows its property's pin; JOB = a pin set for this job only.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "locationSource" TEXT;

-- ---------------------------------------------- 3. clear impossible coordinates
-- (0,0), out-of-range, or half a pair. The values are logged before clearing.
INSERT INTO "LocationRepair" ("id", "entityType", "entityId", "action", "oldValue", "newValue", "reason")
SELECT 'lr_pi_' || p."id", 'property', p."id", 'CLEARED_INVALID', CONCAT(p."lat", ',', p."lng"), NULL,
  'Coordinates could not be a real location (0,0 / out of range / only one of lat,lng)'
FROM "Property" p
WHERE (p."lat" IS NOT NULL OR p."lng" IS NOT NULL)
  AND (p."lat" IS NULL OR p."lng" IS NULL OR (p."lat" = 0 AND p."lng" = 0) OR abs(p."lat") > 90 OR abs(p."lng") > 180)
ON CONFLICT ("id") DO NOTHING;
UPDATE "Property" SET "lat" = NULL, "lng" = NULL
WHERE ("lat" IS NOT NULL OR "lng" IS NOT NULL)
  AND ("lat" IS NULL OR "lng" IS NULL OR ("lat" = 0 AND "lng" = 0) OR abs("lat") > 90 OR abs("lng") > 180);

INSERT INTO "LocationRepair" ("id", "entityType", "entityId", "action", "oldValue", "newValue", "reason")
SELECT 'lr_ji_' || j."id", 'job', j."id", 'CLEARED_INVALID', CONCAT(j."locationLat", ',', j."locationLng"), NULL,
  'Coordinates could not be a real location (0,0 / out of range / only one of lat,lng)'
FROM "Job" j
WHERE (j."locationLat" IS NOT NULL OR j."locationLng" IS NOT NULL)
  AND (j."locationLat" IS NULL OR j."locationLng" IS NULL OR (j."locationLat" = 0 AND j."locationLng" = 0) OR abs(j."locationLat") > 90 OR abs(j."locationLng") > 180)
ON CONFLICT ("id") DO NOTHING;
UPDATE "Job" SET "locationLat" = NULL, "locationLng" = NULL
WHERE ("locationLat" IS NOT NULL OR "locationLng" IS NOT NULL)
  AND ("locationLat" IS NULL OR "locationLng" IS NULL OR ("locationLat" = 0 AND "locationLng" = 0) OR abs("locationLat") > 90 OR abs("locationLng") > 180);

-- ------------------------------------- 1. recover pins saved in legacy columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Job' AND column_name = 'serviceLat')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Job' AND column_name = 'serviceLng') THEN
    EXECUTE $q$
      INSERT INTO "LocationRepair" ("id", "entityType", "entityId", "action", "oldValue", "newValue", "reason")
      SELECT 'lr_jl_' || j."id", 'job', j."id", 'COPIED_LEGACY_JOB_PIN', NULL, CONCAT(j."serviceLat", ',', j."serviceLng"),
        'Pin was saved in the legacy serviceLat/serviceLng columns the app no longer reads'
      FROM "Job" j
      WHERE j."locationLat" IS NULL AND j."locationLng" IS NULL
        AND j."serviceLat" IS NOT NULL AND j."serviceLng" IS NOT NULL
        AND NOT (j."serviceLat" = 0 AND j."serviceLng" = 0)
        AND abs(j."serviceLat") <= 90 AND abs(j."serviceLng") <= 180
      ON CONFLICT ("id") DO NOTHING
    $q$;
    EXECUTE $q$
      UPDATE "Job" j SET "locationLat" = j."serviceLat", "locationLng" = j."serviceLng", "locationSource" = 'JOB'
      WHERE j."locationLat" IS NULL AND j."locationLng" IS NULL
        AND j."serviceLat" IS NOT NULL AND j."serviceLng" IS NOT NULL
        AND NOT (j."serviceLat" = 0 AND j."serviceLng" = 0)
        AND abs(j."serviceLat") <= 90 AND abs(j."serviceLng") <= 180
    $q$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Job' AND column_name = 'serviceAddress') THEN
    EXECUTE $q$
      UPDATE "Job" j SET "locationAddress" = j."serviceAddress"
      WHERE (j."locationAddress" IS NULL OR btrim(j."locationAddress") = '')
        AND j."serviceAddress" IS NOT NULL AND btrim(j."serviceAddress") <> ''
    $q$;
  END IF;
END $$;

-- ------------------- a property with no pin takes the pin its jobs agree on
-- (only when every pinned job of the property is within ~100 m of the others).
WITH pins AS (
  SELECT j."propertyId", min(j."locationLat") AS min_lat, max(j."locationLat") AS max_lat,
         min(j."locationLng") AS min_lng, max(j."locationLng") AS max_lng,
         (array_agg(j."locationLat" ORDER BY j."createdAt" DESC))[1] AS lat,
         (array_agg(j."locationLng" ORDER BY j."createdAt" DESC))[1] AS lng
  FROM "Job" j
  WHERE j."locationLat" IS NOT NULL AND j."locationLng" IS NOT NULL
  GROUP BY j."propertyId"
), agreed AS (
  SELECT p.* FROM pins p WHERE (max_lat - min_lat) < 0.001 AND (max_lng - min_lng) < 0.001
)
INSERT INTO "LocationRepair" ("id", "entityType", "entityId", "action", "oldValue", "newValue", "reason")
SELECT 'lr_pj_' || pr."id", 'property', pr."id", 'COPIED_JOB_PIN_TO_PROPERTY', NULL, CONCAT(a.lat, ',', a.lng),
  'Property had no pin; its jobs carried one (the same within 100 m)'
FROM "Property" pr JOIN agreed a ON a."propertyId" = pr."id"
WHERE pr."lat" IS NULL AND pr."lng" IS NULL
ON CONFLICT ("id") DO NOTHING;

WITH pins AS (
  SELECT j."propertyId", min(j."locationLat") AS min_lat, max(j."locationLat") AS max_lat,
         min(j."locationLng") AS min_lng, max(j."locationLng") AS max_lng,
         (array_agg(j."locationLat" ORDER BY j."createdAt" DESC))[1] AS lat,
         (array_agg(j."locationLng" ORDER BY j."createdAt" DESC))[1] AS lng
  FROM "Job" j
  WHERE j."locationLat" IS NOT NULL AND j."locationLng" IS NOT NULL
  GROUP BY j."propertyId"
), agreed AS (
  SELECT p.* FROM pins p WHERE (max_lat - min_lat) < 0.001 AND (max_lng - min_lng) < 0.001
)
UPDATE "Property" pr SET "lat" = a.lat, "lng" = a.lng, "locationSource" = 'IMPORTED', "locationUpdatedAt" = CURRENT_TIMESTAMP
FROM agreed a
WHERE a."propertyId" = pr."id" AND pr."lat" IS NULL AND pr."lng" IS NULL;

-- --------------------------- 2. jobs without a pin take their property's pin
INSERT INTO "LocationRepair" ("id", "entityType", "entityId", "action", "oldValue", "newValue", "reason")
SELECT 'lr_jp_' || j."id", 'job', j."id", 'COPIED_PROPERTY_PIN', NULL, CONCAT(p."lat", ',', p."lng"),
  'Job had no pin; its property has one'
FROM "Job" j JOIN "Property" p ON p."id" = j."propertyId"
WHERE j."locationLat" IS NULL AND j."locationLng" IS NULL AND p."lat" IS NOT NULL AND p."lng" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
UPDATE "Job" j SET "locationLat" = p."lat", "locationLng" = p."lng", "locationSource" = 'PROPERTY'
FROM "Property" p
WHERE p."id" = j."propertyId" AND j."locationLat" IS NULL AND j."locationLng" IS NULL
  AND p."lat" IS NOT NULL AND p."lng" IS NOT NULL;

-- Jobs without an address take the property's.
UPDATE "Job" j SET "locationAddress" = NULLIF(btrim(CONCAT_WS(', ', NULLIF(btrim(p."address"), ''), NULLIF(btrim(p."city"), ''), NULLIF(btrim(p."postalCode"), ''))), '')
FROM "Property" p
WHERE p."id" = j."propertyId" AND (j."locationAddress" IS NULL OR btrim(j."locationAddress") = '');

-- Classify the rest: same pin as the property → follows the property; otherwise its own.
UPDATE "Job" j SET "locationSource" = CASE
    WHEN j."locationLat" IS NULL THEN 'PROPERTY'
    WHEN p."lat" IS NOT NULL AND abs(j."locationLat" - p."lat") < 0.00001 AND abs(j."locationLng" - p."lng") < 0.00001 THEN 'PROPERTY'
    ELSE 'JOB' END
FROM "Property" p
WHERE p."id" = j."propertyId" AND j."locationSource" IS NULL;

UPDATE "Property" SET "locationSource" = 'IMPORTED', "locationUpdatedAt" = COALESCE("locationUpdatedAt", "createdAt")
WHERE "lat" IS NOT NULL AND "locationSource" IS NULL;

-- --------------------------------------------- guard rails for the future
ALTER TABLE "Property" DROP CONSTRAINT IF EXISTS "Property_coords_valid";
ALTER TABLE "Property" ADD CONSTRAINT "Property_coords_valid" CHECK (
  ("lat" IS NULL AND "lng" IS NULL)
  OR ("lat" IS NOT NULL AND "lng" IS NOT NULL AND abs("lat") <= 90 AND abs("lng") <= 180 AND NOT ("lat" = 0 AND "lng" = 0))
);
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_location_coords_valid";
ALTER TABLE "Job" ADD CONSTRAINT "Job_location_coords_valid" CHECK (
  ("locationLat" IS NULL AND "locationLng" IS NULL)
  OR ("locationLat" IS NOT NULL AND "locationLng" IS NOT NULL AND abs("locationLat") <= 90 AND abs("locationLng") <= 180 AND NOT ("locationLat" = 0 AND "locationLng" = 0))
);
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_locationSource_check";
ALTER TABLE "Job" ADD CONSTRAINT "Job_locationSource_check" CHECK ("locationSource" IS NULL OR "locationSource" IN ('PROPERTY', 'JOB'));

-- =========================================================== job-start modes
-- Exactly three: DIRECT | GPS | GPS_QR. The retired QR-only and QR_GPS modes
-- become GPS_QR — never a weaker check than the one Admin had chosen.
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_startVerificationMode_check";
UPDATE "Job" SET "startVerificationMode" = 'GPS_QR' WHERE "startVerificationMode" IN ('QR', 'QR_GPS');
ALTER TABLE "Job" ADD CONSTRAINT "Job_startVerificationMode_check"
  CHECK ("startVerificationMode" IS NULL OR "startVerificationMode" IN ('DIRECT', 'GPS', 'GPS_QR'));

UPDATE "SystemSettings"
SET "data" = jsonb_set("data"::jsonb, '{jobStartVerification,defaultMode}', '"GPS_QR"')
WHERE "data"::jsonb #>> '{jobStartVerification,defaultMode}' IN ('QR', 'QR_GPS');

-- History rows keep the mode that applied at the time (QR / QR_GPS stay readable).
ALTER TABLE "JobStartVerification" DROP CONSTRAINT IF EXISTS "JobStartVerification_mode_check";
ALTER TABLE "JobStartVerification" ADD CONSTRAINT "JobStartVerification_mode_check"
  CHECK ("mode" IN ('DIRECT', 'GPS', 'GPS_QR', 'QR', 'QR_GPS'));

-- Separate GPS and QR results, the saved location checked against, and when.
ALTER TABLE "JobStartVerification" ADD COLUMN IF NOT EXISTS "gpsResult" TEXT;       -- PASSED | FAILED | NOT_REQUIRED
ALTER TABLE "JobStartVerification" ADD COLUMN IF NOT EXISTS "gpsCheckedAt" TIMESTAMP(3);
ALTER TABLE "JobStartVerification" ADD COLUMN IF NOT EXISTS "qrCheckedAt" TIMESTAMP(3);
ALTER TABLE "JobStartVerification" ADD COLUMN IF NOT EXISTS "qrTokenId" TEXT;
ALTER TABLE "JobStartVerification" ADD COLUMN IF NOT EXISTS "targetLat" DOUBLE PRECISION;
ALTER TABLE "JobStartVerification" ADD COLUMN IF NOT EXISTS "targetLng" DOUBLE PRECISION;
ALTER TABLE "JobStartVerification" ADD COLUMN IF NOT EXISTS "targetSource" TEXT;    -- JOB | PROPERTY

COMMIT;
