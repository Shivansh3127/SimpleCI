import { PrismaClient } from '@prisma/client';

// Singleton pattern — only one Prisma client instance ever exists.
// This prevents opening thousands of DB connections on every request.
const prisma = new PrismaClient();

export default prisma;
