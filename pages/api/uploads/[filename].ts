import type {NextApiRequest, NextApiResponse} from 'next';
import fs from 'fs';
import path from 'path';
import {getRuntimeDataDir} from '../../../lib/server/runtime-data';

const RUNTIME_UPLOAD_DIR = path.join(getRuntimeDataDir(), 'uploads');
const LEGACY_PUBLIC_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

function resolveUploadPath(filename: string) {
  const safeName = path.basename(String(filename || '').trim());
  if (!safeName || safeName !== filename) return '';

  const runtimePath = path.join(RUNTIME_UPLOAD_DIR, safeName);
  if (fs.existsSync(runtimePath)) return runtimePath;

  const legacyPath = path.join(LEGACY_PUBLIC_UPLOAD_DIR, safeName);
  if (fs.existsSync(legacyPath)) return legacyPath;

  return '';
}

function mimeFromFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end('Method not allowed');
  }

  const raw = Array.isArray(req.query.filename) ? req.query.filename[0] : req.query.filename;
  const filename = String(raw || '').trim();
  const filePath = resolveUploadPath(filename);
  if (!filePath) return res.status(404).end('Not found');

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', mimeFromFilename(filename));
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (req.method === 'HEAD') return res.status(200).end();

  return res.status(200).send(fs.readFileSync(filePath));
}
