import type { Config } from '@netlify/functions';
import { handleApi } from '../../server/yahoo';

// Market-data gateway: /api/chart, /api/quote, /api/search, /api/summary,
// /api/fundamentals, /api/financials, /api/screen. See server/yahoo.ts.
export default async (req: Request) => handleApi(req);

export const config: Config = {
  path: '/api/:op',
  method: 'GET',
};
