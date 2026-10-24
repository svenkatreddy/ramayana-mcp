import type { VercelRequest, VercelResponse } from '@vercel/node';

// Minimal health-check endpoint: no data, no logic. Used to isolate whether
// the Vercel project itself can serve any function at all.
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
}
