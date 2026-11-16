-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "containerId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'QUEUED';
