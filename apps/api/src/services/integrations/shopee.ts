// apps/api/src/services/integrations/shopee.ts
// Shopee Affiliate Open API — HMAC-SHA256 signing

import crypto from 'crypto';
import { withRetry, withTimeout, breakers } from '../../lib/resilience.js';
import { getSupabase } from '../../lib/supabase.js';

const BASE = 'https://open-api.affiliate.shopee.vn';
const db   = () => getSupabase();

// ─────────────────────────────────────────────────────────────────────────────
// SIGNING
// ─────────────────────────────────────────────────────────────────────────────
function sign(path: string, body: string, ts: number): string {
  const base = `${process.env.SHOPEE_APP_ID}${path}${ts}${body}`;
  return crypto.createHmac('sha256', process.env.SHOPEE_SECRET!)
    .update(base).digest('hex');
}

function headers(path: string, body: string, ts: number) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `SHA256 ${sign(path, body, ts)}`,
  };
}

async function shopeeCall<T>(
  path: string,
  options: { method?: string; body?: object } = {}
): Promise<T> {
  const ts     = Math.floor(Date.now() / 1000);
  const bodyStr = options.body ? JSON.stringify(options.body) : '';
  const method  = options.method ?? (options.body ? 'POST' : 'GET');

  return breakers.shopee.call(() =>
    withRetry(() =>
      withTimeout(async () => {
        const res = await fetch(`${BASE}${path}`, {
          method,
          headers: headers(path, bodyStr, ts),
          ...(bodyStr ? { body: bodyStr } : {}),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => '');
          throw new Error(`Shopee ${res.status}: ${err.slice(0, 200)}`);
        }
        const data = await res.json() as { code?: number; msg?: string; data?: T; response?: T };
        if (data.code !== undefined && data.code !== 0) {
          throw new Error(`Shopee API error ${data.code}: ${data.msg}`);
        }
        return (data.data ?? data.response ?? data) as T;
      }, 10_000),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFERS
// ─────────────────────────────────────────────────────────────────────────────
export interface ShopeeOffer {
  item_id:        string;
  shop_id:        string;
  item_name:      string;
  product_link:   string;
  image:          string;
  original_price: number;
  sale_price:     number;
  commission_rate: number;
  epc:            number;
  seller_rating:  number;
  sold:           number;
  category_id:    string;
}

export async function getShopeeTopOffers(params: {
  category?:    string;
  sort_type?:   number;   // 1=commission, 2=epc, 3=sales
  limit?:       number;
  page?:        number;
} = {}): Promise<ShopeeOffer[]> {

  // Check cache first
  const cacheKey = `shopee_${params.category ?? 'all'}_${params.sort_type ?? 2}`;
  const { data: cached } = await db()
    .from('offer_cache')
    .select('metadata')
    .eq('network', 'shopee')
    .eq('offer_id', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached?.metadata?.offers) {
    return (cached.metadata as { offers: ShopeeOffer[] }).offers;
  }

  const path = '/api/v2/affiliate/get_offer_list';
  const body: Record<string, unknown> = {
    partner_id: Number(process.env.SHOPEE_APP_ID),
    sort_type:  params.sort_type ?? 2,
    limit:      params.limit ?? 20,
    page:       params.page ?? 1,
  };
  if (params.category) body.category_id = params.category;

  try {
    const result = await shopeeCall<{ offers: ShopeeOffer[] }>(path, { body });
    const offers = result.offers ?? [];

    // Cache for 6 hours
    await db().from('offer_cache').upsert({
      network:    'shopee',
      offer_id:   cacheKey,
      metadata:   { offers },
      expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });

    return offers;
  } catch (err) {
    console.error('[Shopee] getTopOffers failed:', (err as Error).message);
    return [];
  }
}

export async function getShopeeProductInfo(itemId: string, shopId: string): Promise<ShopeeOffer | null> {
  try {
    const result = await shopeeCall<{ item: ShopeeOffer }>(
      '/api/v2/affiliate/get_item_detail',
      { body: { item_id: Number(itemId), shop_id: Number(shopId), partner_id: Number(process.env.SHOPEE_APP_ID) } }
    );
    return result.item ?? null;
  } catch {
    return null;
  }
}

// Tạo affiliate link có tracking
export async function createShopeeAffiliateLink(
  itemId: string, shopId: string, userId: string
): Promise<string | null> {
  try {
    const result = await shopeeCall<{ short_link: string }>(
      '/api/v2/affiliate/generate_short_link',
      {
        body: {
          partner_id:   Number(process.env.SHOPEE_APP_ID),
          origin_url:   `https://shopee.vn/product/${shopId}/${itemId}`,
          sub_id:       `affiliateai_${userId}`,   // tracking user
          sub_id2:      new Date().toISOString().split('T')[0],
        }
      }
    );
    return result.short_link ?? null;
  } catch (err) {
    console.error('[Shopee] createLink failed:', (err as Error).message);
    return `https://shp.ee/fallback_${itemId}`;   // fallback
  }
}

// Scrape product info từ URL (dùng khi không có itemId/shopId)
export async function scrapeShopeeUrl(url: string): Promise<{
  name: string; images: string[]; price: number; originalPrice: number;
  rating: number; sold: number; discount: number;
  itemId?: string; shopId?: string;
} | null> {

  // Extract IDs từ URL patterns:
  // https://shopee.vn/product-name-i.123456.987654
  // https://shp.ee/xxxxxxx (short link)
  const patterns = [
    /i\.(\d+)\.(\d+)/,                    // i.shopId.itemId
    /\/product\/(\d+)\/(\d+)/,            // /product/shopId/itemId
  ];

  let shopId: string | undefined, itemId: string | undefined;
  for (const pattern of patterns) {
    const m = url.match(pattern);
    if (m) { shopId = m[1]; itemId = m[2]; break; }
  }

  if (shopId && itemId) {
    const info = await getShopeeProductInfo(itemId, shopId);
    if (info) {
      return {
        name:          info.item_name,
        images:        [info.image],
        price:         info.sale_price,
        originalPrice: info.original_price,
        rating:        info.seller_rating,
        sold:          info.sold,
        discount:      Math.round((1 - info.sale_price / info.original_price) * 100),
        itemId, shopId,
      };
    }
  }

  // Fallback: simple fetch metadata (no auth needed for basic info)
  try {
    const res = await withTimeout(
      () => fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
      8_000
    );
    const html = await res.text();

    // Extract từ meta tags
    const name  = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? 'Sản phẩm Shopee';
    const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const priceMatch = html.match(/"price":\s*([0-9.]+)/);
    const price = priceMatch ? Math.round(Number(priceMatch[1])) : 0;

    return { name, images: image ? [image] : [], price, originalPrice: price, rating: 0, sold: 0, discount: 0 };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
export async function getShopeeReport(params: {
  userId: string;
  fromDate: string;  // YYYY-MM-DD
  toDate:   string;
}) {
  try {
    const result = await shopeeCall<{ conversions: unknown[] }>(
      '/api/v2/affiliate/get_report',
      {
        body: {
          partner_id: Number(process.env.SHOPEE_APP_ID),
          sub_id:     `affiliateai_${params.userId}`,
          from_date:  params.fromDate,
          to_date:    params.toDate,
        }
      }
    );
    return result.conversions ?? [];
  } catch {
    return [];
  }
}
