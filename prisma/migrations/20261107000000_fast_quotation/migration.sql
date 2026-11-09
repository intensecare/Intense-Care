-- Fast quotation: a quotation no longer needs a Property record. Quote.propertyId was already nullable;
-- these columns let the service address, requirements, office notes and advance live on the quotation itself.
-- Additive only: existing quotations, their property links and history are untouched.
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "serviceAddress" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "requirements" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "advanceAmount" DOUBLE PRECISION;
