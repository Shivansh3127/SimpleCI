-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "notifyUrl" TEXT;

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "artifactKeys" TEXT,
ADD COLUMN     "dockerImage" TEXT,
ADD COLUMN     "matrixLabel" TEXT;

-- CreateTable
CREATE TABLE "secrets" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedVal" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_members" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "secrets_repositoryId_name_key" ON "secrets"("repositoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "repo_members_repositoryId_userId_key" ON "repo_members"("repositoryId", "userId");

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_members" ADD CONSTRAINT "repo_members_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_members" ADD CONSTRAINT "repo_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
