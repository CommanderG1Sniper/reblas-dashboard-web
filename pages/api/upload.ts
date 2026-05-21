import type {NextApiRequest, NextApiResponse} from 'next';
import formidable from 'formidable';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import {getRuntimeDataDir} from '../../lib/server/runtime-data';

export const config = {
  api: {bodyParser: false},
};

const UPLOAD_DIR = path.join(getRuntimeDataDir(), 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, {recursive: true});
}

function mimeToExt(mime?: string) {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/svg+xml':
      return '.svg';
    case 'image/bmp':
      return '.bmp';
    default:
      return '';
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({error: 'Method not allowed'});
  }

  ensureUploadDir();

  const form = formidable({
    multiples: false,
    uploadDir: UPLOAD_DIR,
    keepExtensions: true,

    // allow big uploads (still finite so a mistake doesn't nuke the server)
    maxFileSize: 200 * 1024 * 1024, // 200MB

    filter: (part: any) => {
      return !!part.mimetype && part.mimetype.startsWith('image/');
    },

    filename: (_name: string, ext: string, part: any) => {
      const safeExt = (ext && ext.length <= 10 ? ext : '') || mimeToExt(part.mimetype) || '';
      const id = crypto.randomBytes(8).toString('hex');
      return `${Date.now()}_${id}${safeExt}`;
    },
  });

  try {
    const [fields, files] = await form.parse(req);

    const f: any = (files as any).file || (files as any).upload || Object.values(files as any)[0];
    const file = Array.isArray(f) ? f[0] : f;

    if (!file?.filepath) {
      return res.status(400).json({error: 'No file uploaded (field name should be "file")'});
    }

    const filename = path.basename(file.filepath);
    const url = `/uploads/${filename}`;

    return res.status(200).json({url});
  } catch (err: any) {
    console.error('Upload error:', err);
    return res.status(500).json({error: 'Upload failed'});
  }
}
