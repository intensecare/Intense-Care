-- AlterTable
ALTER TABLE "Job" DROP COLUMN "assignedTeamId",
DROP COLUMN "assignedTeamMembers",
ADD COLUMN     "assignedStaffIds" TEXT[];

-- AlterTable
ALTER TABLE "User" DROP COLUMN "teamId";

