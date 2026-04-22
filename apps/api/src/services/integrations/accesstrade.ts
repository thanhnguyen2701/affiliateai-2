// apps/api/src/services/integrations/accesstrade.ts
import { withRetry, withTimeout, breakers } from '../../lib/resilience.js';
import { getSupabase } from '../../lib/supabase.js';

const BASE = process.env.ACCESSTRADE_BASE_URL ?? 'https://api.accesstrade.vn/v1';
const db   = () => getSupabase();

function atHeaders() {
  return {
    'Authorization': `Token ${process.env.ACCESSTRADE_TOKEN}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };
}

async function atCall<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = `${BASE}${path}${params ? '?' + new URLSearchParams(params) : ''}`;
  return breakers.accesstrade.call(() =>
    withRetry(() =>
      withTimeout(async () => {
        const res = await fetch(url, { headers: atHeaders() });
        if (!res.ok) throw new Error(`Accesstrade ${res.status}: ${path}`);
        const data = await res.json() as { data?: T; error?: string };
        if (data.error) throw new Error(`Accesstrade: ${data.error}`);
        return (data.data ?? data) as T;
      }, 10_000),
      { maxAttempts: 2 }
    )
  );
}

export interface ATOffer {
  id:             string;
  name:           string;
  category:       string;
  commission_type: string;
  commission_value: number;
  epc:            number;
  ctr:            number;
  status:         string;
  logo:           string;
  tracking_url:   string;
  cookie_duration: number;
}

export async function getATOffers(params: {
  category?: string; page?: number; limit?: number;
} = {}): Promise<ATOffer[]> {

  const cacheKey = `at_offers_${params.category ?? 'all'}`;
  const { data: cached } = await db().from('offer_cache')
    .select('metadata').eq('network', 'accesstrade').eq('offer_id', cacheKey)
    .gt('expires_at', new Date().toISOString()).single();
  if (cached?.metadata) return (cached.metadata as { offers: ATOffer[] }).offers ?? [];

  try {
    const offers = await atCall<ATOffer[]>('/offers', {
      status: 'active', sort: '-epc',
      page:   String(params.page ?? 1),
      limit:  String(params.limit ?? 20),
      ...(params.category ? { category: params.category } : {}),
    });

    await db().from('offer_cache').upsert({
      network: 'accesstrade', offer_id: cacheKey,
      metadata: { offers },
      expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });

    return offers;
  } catch (err) {
    console.error('[Accesstrade] getOffers:', (err as Error).message);
    return [];
  }
}

export async function createATLink(offerId: string, userId: string): Promise<string | null> {
  try {
    const result = await atCall<{ tracking_url: string }>(
      `/offers/${offerId}/links`,
    );
    return result.tracking_url ?? null;
  } catch { return null; }
}

export async function getATReport(userId: string, fromDate: string, toDate: string) {
  try {
    return await atCall<unknown[]>('/reports/conversion', {
      from_date: fromDate, to_date: toDate,
      sub_id: userId,
    });
  } catch { return []; }
}
