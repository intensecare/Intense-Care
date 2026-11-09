# Field Operations Manager (merged Field Manager + QC)

The former **Field Manager** and **QC Inspector** roles are one role: `field_operations_manager`
("Field Operations Manager"). Roles are now `admin`, `field_operations_manager`, `tax_officer`, `customer`.

## What the role can do
* **Field work** – only jobs assigned to the user (scope `ASSIGNED`): customer/property details, schedule,
  GPS / QR start verification, arrival → start → complete, before/after photos, notes, history.
* **Quality control** – every `qc.*` permission: inspect, pass, return for rework, dispatch/coordinate rework,
  reinspect. Jobs in the QC pipeline (`WORK_COMPLETED`, `QUALITY_CHECK`, rework states) and jobs the user
  inspected are readable ("QC window") – but customers, properties and money stay scoped to assigned jobs.
* No Admin privileges: users, settings, finance, roles remain Admin-only.

## Separation of duties
Admin → Settings → *Quality control* → "Inspector must not be on the job's crew" (`qualityControl.separationOfDuties`,
default **on**). Enforced server-side in `/api/quality` (start-inspection, submit-check, reinspect-pass). A blocked attempt
returns 403 and writes the audit event `QC_SEPARATION_BLOCKED`. Turning it off is an explicit, Admin-only setting;
each `QualityCheck` records `startedAt`, `startedBy` and `inspectorOnCrew`, so history shows who inspected even when
the same person handled the job.

## Migration
`prisma/migrations/20261024000000_merge_field_manager_qc` updates `User.role` **in place** for
`field_manager`, `field_staff`, `staff`, `qc_inspector`, `qc`. Ids, emails, password hashes, assignments, QC records and
audit-log rows are untouched; the previous role of every migrated user is saved in `RoleMigration`. The migration is
idempotent. Sessions carry only the user id, so migrated users stay signed in. Legacy identifiers are still understood by
`normalizeRole` (old tokens, old data) but cannot be chosen when creating users.

Verify on a populated legacy database: `npm run build && ADMIN_DB_URL=postgresql://…/postgres node scripts/role-migration-verify.mjs`.
