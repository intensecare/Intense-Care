/*
  Warnings:

  - You are about to drop the column `customerPhone` on the `CompletionInvite` table. All the data in the column will be lost.
  - You are about to drop the column `smsError` on the `CompletionInvite` table. All the data in the column will be lost.
  - You are about to drop the column `smsProviderRef` on the `CompletionInvite` table. All the data in the column will be lost.
  - You are about to drop the column `smsStatus` on the `CompletionInvite` table. All the data in the column will be lost.
  - Added the required column `customerEmail` to the `CompletionInvite` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CompletionInvite" DROP COLUMN "customerPhone",
DROP COLUMN "smsError",
DROP COLUMN "smsProviderRef",
DROP COLUMN "smsStatus",
ADD COLUMN     "customerEmail" TEXT NOT NULL,
ADD COLUMN     "deliveryChannel" TEXT NOT NULL DEFAULT 'email',
ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryRef" TEXT,
ADD COLUMN     "deliveryStatus" TEXT NOT NULL DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN     "providerManaged" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "codeHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MailLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "toEmail" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerRef" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailLog_jobId_idx" ON "MailLog"("jobId");

-- CreateIndex
CREATE INDEX "MailLog_purpose_createdAt_idx" ON "MailLog"("purpose", "createdAt");
