import type {NextApiRequest, NextApiResponse} from 'next';
import {getServerSession} from 'next-auth/next';
import {getAuthOptions} from '../auth/[...nextauth]';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, getAuthOptions(req)).catch(() => null);
  if (!session) return res.status(401).json({error: 'Login required'});

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }

  // Wash tracker does not use personal outstanding reminders.
  return res.status(200).json({
    memberId: String((session as any)?.discordId || '').trim(),
    expectedCleanCents: 0,
    paidCleanCents: 0,
    cleanOutstandingCents: 0,
    expectedDirtyCents: 0,
    paidDirtyCents: 0,
    dirtyOutstandingCents: 0,
    hasOutstanding: false,
  });
}
