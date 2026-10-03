-- Live pipeline activity events: one row per field-worker/QC/customer action
-- on a job, powering the supervisor activity feed and the job audit tab.
CREATE TABLE "JobActivityEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobActivityEvent_jobId_createdAt_idx" ON "JobActivityEvent"("jobId", "createdAt" DESC);
CREATE INDEX "JobActivityEvent_createdAt_idx" ON "JobActivityEvent"("createdAt" DESC);
