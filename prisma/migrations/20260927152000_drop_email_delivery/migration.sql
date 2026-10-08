-- AlterTable
ALTER TABLE "CompletionInvite" DROP COLUMN "customerEmail",
DROP COLUMN "deliveryChannel",
DROP COLUMN "deliveryError",
DROP COLUMN "deliveryRef",
DROP COLUMN "deliveryStatus";

-- DropTable
DROP TABLE "MailLog";

