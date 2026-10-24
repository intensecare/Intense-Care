-- =============================================================================
-- 20261021 — Restore QR-only as a job-start verification mode.
--
-- 20261013000000_location_integrity_start_modes retired standalone "QR" (and
-- the older "QR_GPS" alias), upgrading every existing job and the company
-- default that held either value to "GPS_QR" — a conscious choice to never
-- leave a job on a weaker check than Admin had picked. Those already-upgraded
-- jobs are NOT reverted here (that data is already merged into GPS_QR and
-- correctly reflects what was actually enforced at the time); this migration
-- only widens the constraint so "QR" can be chosen again for new jobs and
-- settings going forward. Purely additive — no existing row is changed.
--
-- "QR_GPS" (the pre-"GPS_QR" spelling) remains retired; only "DIRECT", "GPS",
-- "QR" and "GPS_QR" are valid going forward. JobStartVerification.mode already
-- allows "QR"/"QR_GPS" (for displaying historical rows) and needs no change.
-- =============================================================================
ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_startVerificationMode_check";
ALTER TABLE "Job" ADD CONSTRAINT "Job_startVerificationMode_check"
  CHECK ("startVerificationMode" IS NULL OR "startVerificationMode" IN ('DIRECT', 'GPS', 'QR', 'GPS_QR'));
