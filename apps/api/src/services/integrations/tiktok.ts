// apps/api/src/services/integrations/tiktok.ts
// TikTok Shop Affiliate API — HMAC-SHA256 signing (khác Shopee)

import crypto from 'crypto';
import { withRetry, withTimeout, breakers } from '../../lib/resilience.js';
import { getSupabase } from '../../lib/supabase.js';

const BASE = process.env.TIKTOK_SHOP_URL ?? 'https://open-api.tiktokglobalshop.com';
const db   = () => getSupabase();

function signTikTok(
  path: string,
  params: Record<string, string>,
  body: string,
  ts: number,
  accessToken = ''
): string {
  // TikTok signature: sort params alphabetically, concat with secret
  const sortedParams = Object.keys(params).sort()
    .map(k => `${k}${params[k]}`).join('');
  const signStr = [
    process.env.TIKTOK_APP_SECRET,
    path,
    sortedParams,
    body,
    String(ts),
    accessToken,
    process.env.TIKTOK_APP_SECRET,
  ].join('');
  return crypto.createHmac('sha256', process.env.TIKTOK_APP_SECRET!)
    .update(signStr).digest('hex');
}

async function ttCall<T>(
  path: string,
  body?: Record<string, unknown>,
  accessToken?: string
): Promise<T> {
  const ts = Math.floor(Date.now() / 1000);
  const bodyStr = body ? JSON.stringify(body) : '';
  const baseParams: Record<string, string> = {
    app_key:  process.env.TIKTOK_APP_KEY!,
    timestamp: String(ts),
  };
  const sign = signTikTok(path, baseParams, bodyStr, ts, accessToken ?? '');
  const qs = new URLSearchParams({ ...baseParams, sign });
  if (accessToken) qs.set('access_token', accessToken);

  return breakers.tiktok.call(() =>
    withRetry(() =>
      withTimeout(async () => {
        const res = await fetch(`${BASE}${path}?${qs}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { 'x-tts-access-token': accessToken } : {}),
          },
          ...(bodyStr ? { body: bodyStr } : {}),
        });
        if (!res.ok) throw new Error(`TikTok ${res.status}: ${path}`);
        const data = await res.json() as { code?: number; message?: string; data?: T };
        if (data.code && data.code !== 0) throw new Error(`TikTok error ${data.code}: ${data.message}`);
        return (data.data ?? data) as T;
      }, 10_000),
      { maxAttempts: 2 }
    )
  );
}

export interface TikTokProduct {
  product_id:      string;
  product_name:    string;
  main_images:     Array<{ url_list: string[] }>;
  price:           { original_price: string; currency: string };
  sales:           { sold_count: number };
  review_summary:  { rating: number };
  commission_rate: string;
}

export async function getTikTokAffiliateProducts(params: {
  category_id?: string; sort_field?: string; limit?: number;
} = {}): Promise<TikTokProduct[]> {
  const cacheKey = `tt_products_${params.category_id ?? 'all'}`;
  const { data: cached } = await db().from('offer_cache')
    .select('metadata').eq('network', 'tiktok').eq('offer_id', cacheKey)
    .gt('expires_at', new Date().toISOString()).single();
  if (cached?.metadata) return (cached.metadata as { products: TikTokProduct[] }).products ?? [];

  try {
    const result = await ttCall<{ products: TikTokProduct[] }>(
      '/affiliate/202309/products/search',
      {
        sort_field: params.sort_field ?? 'sales',
        sort_type:  1,
        page_size:  params.limit ?? 20,
        ...(params.category_id ? { category_id: params.category_id } : {}),
      }
    );

    const products = result.products ?? [];
    await db().from('offer_cache').upsert({
      network: 'tiktok', offer_id: cacheKey,
      metadata: { products },
      expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });
    return products;
  } catch (err) {
    console.error('[TikTok] getProducts:', (err as Error).message);
    return [];
  }
}
