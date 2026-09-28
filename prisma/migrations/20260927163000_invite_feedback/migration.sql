-- AlterTable
ALTER TABLE "CompletionInvite" ADD COLUMN     "attentionNotes" TEXT,
ADD COLUMN     "feedbackAt" TIMESTAMP(3),
ADD COLUMN     "feedbackComment" TEXT,
ADD COLUMN     "feedbackRating" INTEGER,
ADD COLUMN     "feedbackTags" TEXT[],
ADD COLUMN     "googleReviewClicked" BOOLEAN NOT NULL DEFAULT false;

