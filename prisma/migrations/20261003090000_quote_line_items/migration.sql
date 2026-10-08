-- Store quotation line items (description, quantity, unitPrice) so quoted
-- documents can show exactly what was priced. Nullable: legacy quotations
-- keep only their computed totals. Idempotent for re-application.
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "items" JSONB;
