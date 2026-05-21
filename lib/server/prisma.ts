import {PrismaClient} from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  __reblasPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__reblasPrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__reblasPrisma = prisma;
}
