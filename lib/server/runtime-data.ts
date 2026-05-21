import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_RUNTIME_DATA_DIR = path.join(os.homedir(), '.reblas-dashboard-data');

export function getRuntimeDataDir() {
  const envDir = String(process.env.REBLAS_DATA_DIR || '').trim();
  const dir = envDir || DEFAULT_RUNTIME_DATA_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
  return dir;
}

export function getRuntimeDataPath(filename: string) {
  return path.join(getRuntimeDataDir(), filename);
}

