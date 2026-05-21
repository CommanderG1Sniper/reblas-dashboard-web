import {prisma} from './prisma';

export async function readRuntimeDocument<T>(key: string, fallbackFactory: () => T): Promise<T> {
  const row = await prisma.runtimeDocument.findUnique({where: {key}});
  if (!row) return fallbackFactory();
  return row.value as T;
}

export async function writeRuntimeDocument<T>(key: string, value: T): Promise<T> {
  const row = await prisma.runtimeDocument.upsert({
    where: {key},
    update: {value: value as any},
    create: {key, value: value as any},
  });
  return row.value as T;
}

export async function deleteRuntimeDocument(key: string) {
  await prisma.runtimeDocument.delete({where: {key}}).catch(() => null);
}

export async function listRuntimeDocumentKeys() {
  const rows = await prisma.runtimeDocument.findMany({
    orderBy: {key: 'asc'},
    select: {key: true},
  });
  return rows.map((row: {key: string}) => row.key);
}
