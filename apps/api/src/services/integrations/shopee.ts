// apps/api/src/services/integrations/shopee.ts
// Shopee Affiliate Open API (official GraphQL)

import crypto from 'crypto';
import { withRetry, withTimeout, breakers } from '../../lib/resilience.js';
import { getSupabase } from '../../lib/supabase.js';

const DEFAULT_BASE = 'https://open-api.affiliate.shopee.vn';
const db = () => getSupabase();

interface ShopeeGraphqlResponse<T> {
  data?: T;
  errors?: Array<{
    message?: string;
    extensions?: { code?: number | string; message?: string };
  }>;
}

interface ShopeePageInfo {
  page?: number;
  limit?: number;
  hasNextPage?: boolean;
}

interface ShopeeProductOfferNode {
  productId?: number | string;
  productName?: string;
  commissionRate?: string;
  price?: number;
  priceMin?: number;
  priceMax?: number;
  imageUrl?: string;
  offerLink?: string;
  originalLink?: string;
  shopId?: number | string;
  shopName?: string;
  soldCount?: number;
  ratingStar?: number;
}

interface ShopeeConversionNode {
  orderId?: string;
  checkoutId?: string;
  itemId?: number | string;
  itemName?: string;
  shopId?: number | string;
  shopName?: string;
  quantity?: number;
  price?: number;
  commission?: number;
  netCommission?: number;
  campaignType?: string;
  purchaseStatus?: number;
  itemStatus?: number;
  purchaseTime?: number;
  clickTime?: number;
  subIds?: string[];
}

export interface ShopeeOffer {
  item_id: string;
  shop_id: string;
  item_name: string;
  product_link: string;
  image: string;
  original_price: number;
  sale_price: number;
  commission_rate: number;
  epc: number;
  seller_rating: number;
  sold: number;
  category_id: string;
}

function getShopeeBaseUrl(): string {
  return (process.env.SHOPEE_AFFILIATE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

function getShopeeGraphqlUrl(): string {
  const base = getShopeeBaseUrl();
  return base.endsWith('/graphql') ? base : `${base}/graphql`;
}

function requireShopeeCredentials(): { appId: string; secret: string } {
  const appId = process.env.SHOPEE_APP_ID?.trim();
  const secret = process.env.SHOPEE_SECRET?.trim();
  if (!appId || !secret) {
    throw new Error('Thiếu SHOPEE_APP_ID hoặc SHOPEE_SECRET');
  }
  return { appId, secret };
}

function sign(payload: string, ts: number): string {
  const { appId, secret } = requireShopeeCredentials();
  return crypto
    .createHash('sha256')
    .update(`${appId}${ts}${payload}${secret}`)
    .digest('hex');
}

function headers(payload: string, ts: number) {
  const { appId } = requireShopeeCredentials();
  return {
    'Content-Type': 'application/json',
    'Authorization': `SHA256 Credential=${appId}, Signature=${sign(payload, ts)}, Timestamp=${ts}`,
  };
}

async function shopeeGraphqlCall<T>(query: string): Promise<T> {
  const ts = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ query });

  return breakers.shopee.call(() =>
    withRetry(() =>
      withTimeout(async () => {
        const res = await fetch(getShopeeGraphqlUrl(), {
          method: 'POST',
          headers: headers(payload, ts),
          body: payload,
        });

        if (!res.ok) {
          const err = await res.text().catch(() => '');
          throw new Error(`Shopee ${res.status}: ${err.slice(0, 200)}`);
        }

        const data = await res.json() as ShopeeGraphqlResponse<T>;
        if (data.errors?.length) {
          const first = data.errors[0];
          const code = first.extensions?.code;
          const message = first.extensions?.message || first.message || 'Shopee GraphQL error';
          throw new Error(code ? `Shopee API error ${code}: ${message}` : message);
        }
        if (!data.data) {
          throw new Error('Shopee API response missing data');
        }

        return data.data;
      }, 10_000),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
  );
}

function escapeGraphqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function normalizeShopeeMoney(value: number | undefined): number {
  const raw = Number(value) || 0;
  if (!raw) return 0;
  return raw >= 100_000 ? Math.round(raw / 100_000) : Math.round(raw);
}

function normalizeCommissionRate(value: string | undefined): number {
  const rate = Number(value);
  return Number.isFinite(rate) ? rate : 0;
}

function toShopeeOffer(node: ShopeeProductOfferNode): ShopeeOffer {
  const salePrice = normalizeShopeeMoney(node.priceMin ?? node.price);
  const maxPrice = normalizeShopeeMoney(node.priceMax ?? node.price);
  const originalPrice = maxPrice >= salePrice ? maxPrice : salePrice;
  const commissionRate = normalizeCommissionRate(node.commissionRate);

  return {
    item_id: String(node.productId ?? ''),
    shop_id: String(node.shopId ?? ''),
    item_name: node.productName?.trim() || 'San pham Shopee',
    product_link: node.offerLink || node.originalLink || '',
    image: node.imageUrl || '',
    original_price: originalPrice,
    sale_price: salePrice,
    commission_rate: commissionRate,
    epc: Math.round(salePrice * commissionRate),
    seller_rating: Number(node.ratingStar) || 0,
    sold: Number(node.soldCount) || 0,
    category_id: '',
  };
}

function buildProductOfferQuery(params: {
  keyword?: string;
  sortType?: number;
  page?: number;
  limit?: number;
  category?: string;
}): string {
  const args: string[] = [];
  if (params.keyword) args.push(`keyword: "${escapeGraphqlString(params.keyword)}"`);
  if (params.sortType) args.push(`sortType: ${params.sortType}`);
  if (params.category && /^\d+$/.test(params.category)) args.push(`categoryId: ${params.category}`);
  args.push(`page: ${params.page ?? 1}`);
  args.push(`limit: ${params.limit ?? 20}`);

  return `{
    productOfferV2(${args.join(', ')}) {
      nodes {
        productId
        productName
        commissionRate
        price
        priceMin
        priceMax
        imageUrl
        offerLink
        originalLink
        shopId
        shopName
        soldCount
        ratingStar
      }
      pageInfo {
        page
        limit
        hasNextPage
      }
    }
  }`;
}

function parseShopeeIds(url: string): { shopId: string; itemId: string } | null {
  const normalized = url.trim();
  const patterns = [
    /i\.(\d+)\.(\d+)/i,
    /\/product\/(\d+)\/(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return { shopId: match[1], itemId: match[2] };
    }
  }

  return null;
}

function buildKeywordFromShopeeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const slugMatch = parsed.pathname.match(/\/([^/]+)-i\.\d+\.\d+/i);
    const rawSlug = slugMatch?.[1];
    if (!rawSlug) return null;

    const keyword = decodeURIComponent(rawSlug)
      .replace(/[-_]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!keyword) return null;

    return keyword
      .split(' ')
      .filter(Boolean)
      .slice(0, 8)
      .join(' ');
  } catch {
    return null;
  }
}

function isShopeeUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes('shopee.vn') || hostname.includes('shp.ee');
  } catch {
    const lower = url.toLowerCase();
    return lower.includes('shopee.vn') || lower.includes('shp.ee');
  }
}

async function resolveShopeeUrl(url: string): Promise<string> {
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const directIds = parseShopeeIds(normalized);
  const hasSlug = /-i\.\d+\.\d+/i.test(normalized);
  if (directIds && normalized.includes('shopee.vn') && hasSlug) {
    return normalized;
  }

  const response = await withTimeout(
    () => fetch(normalized, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }),
    10_000,
    'Shopee URL resolve timeout'
  );

  try {
    await response.arrayBuffer();
  } catch {
    // Ignore body read failures; we only need the final URL.
  }

  return response.url || normalized;
}

async function findShopeeOffer(params: {
  shopId: string;
  itemId: string;
  keyword?: string | null;
}): Promise<ShopeeOffer | null> {
  const queries = [
    params.keyword?.trim() || '',
    ...(params.keyword?.includes(' ')
      ? [params.keyword.split(' ').slice(0, 4).join(' ')]
      : []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  if (queries.length === 0) queries.push('');

  for (const keyword of queries) {
    for (const page of [1, 2, 3]) {
      const data = await shopeeGraphqlCall<{
        productOfferV2?: { nodes?: ShopeeProductOfferNode[]; pageInfo?: ShopeePageInfo };
      }>(buildProductOfferQuery({ keyword, sortType: 1, page, limit: 20 }));

      const nodes = data.productOfferV2?.nodes ?? [];
      const exact = nodes.find((node) =>
        String(node.productId ?? '') === params.itemId &&
        String(node.shopId ?? '') === params.shopId
      );
      if (exact) {
        return toShopeeOffer(exact);
      }

      const hasNextPage = Boolean(data.productOfferV2?.pageInfo?.hasNextPage);
      if (!hasNextPage) break;
    }
  }

  return null;
}

export async function getShopeeTopOffers(params: {
  category?: string;
  sort_type?: number;
  limit?: number;
  page?: number;
} = {}): Promise<ShopeeOffer[]> {
  const cacheKey = `shopee_${params.category ?? 'all'}_${params.sort_type ?? 2}_${params.page ?? 1}_${params.limit ?? 20}`;
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

  try {
    const data = await shopeeGraphqlCall<{
      productOfferV2?: { nodes?: ShopeeProductOfferNode[] };
    }>(buildProductOfferQuery({
      category: params.category,
      sortType: params.sort_type ?? 2,
      limit: params.limit ?? 20,
      page: params.page ?? 1,
    }));

    const offers = (data.productOfferV2?.nodes ?? []).map(toShopeeOffer);

    await db().from('offer_cache').upsert({
      network: 'shopee',
      offer_id: cacheKey,
      metadata: { offers },
      expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });

    return offers;
  } catch (err) {
    console.error('[Shopee] getTopOffers failed:', (err as Error).message);
    return [];
  }
}

export async function getShopeeProductInfo(
  itemId: string,
  shopId: string,
  options: { keyword?: string; originUrl?: string } = {}
): Promise<ShopeeOffer | null> {
  try {
    const offer = await findShopeeOffer({
      itemId,
      shopId,
      keyword: options.keyword ?? buildKeywordFromShopeeUrl(options.originUrl || ''),
    });
    return offer;
  } catch (err) {
    console.error('[Shopee] getProductInfo failed:', (err as Error).message);
    return null;
  }
}

export async function createShopeeAffiliateLink(
  itemId: string,
  shopId: string,
  userId: string
): Promise<string | null> {
  try {
    const originUrl = `https://shopee.vn/product/${shopId}/${itemId}`;
    const query = `mutation {
      generateShortLink(input: {
        originUrl: "${escapeGraphqlString(originUrl)}",
        subIds: [
          "${escapeGraphqlString(`affiliateai_${userId}`)}",
          "${new Date().toISOString().split('T')[0]}"
        ]
      }) {
        shortLink
      }
    }`;

    const data = await shopeeGraphqlCall<{
      generateShortLink?: { shortLink?: string };
    }>(query);

    return data.generateShortLink?.shortLink ?? originUrl;
  } catch (err) {
    console.error('[Shopee] createLink failed:', (err as Error).message);
    return null;
  }
}

export async function scrapeShopeeUrl(url: string): Promise<{
  name: string;
  images: string[];
  price: number;
  originalPrice: number;
  rating: number;
  sold: number;
  discount: number;
  itemId?: string;
  shopId?: string;
} | null> {
  if (!isShopeeUrl(url)) {
    return null;
  }

  const resolvedUrl = await resolveShopeeUrl(url);
  const ids = parseShopeeIds(resolvedUrl) ?? parseShopeeIds(url);
  if (!ids) {
    throw new Error('Khong tach duoc shopId/itemId tu URL Shopee');
  }

  const info = await getShopeeProductInfo(ids.itemId, ids.shopId, {
    keyword: buildKeywordFromShopeeUrl(resolvedUrl) || undefined,
    originUrl: resolvedUrl,
  });

  if (!info) {
    throw new Error('Shopee Open API khong tra ve du lieu cho URL nay');
  }

  const discount = info.original_price > 0 && info.original_price > info.sale_price
    ? Math.round(((info.original_price - info.sale_price) / info.original_price) * 100)
    : 0;

  return {
    name: info.item_name,
    images: info.image ? [info.image] : [],
    price: info.sale_price,
    originalPrice: info.original_price || info.sale_price,
    rating: info.seller_rating,
    sold: info.sold,
    discount,
    itemId: ids.itemId,
    shopId: ids.shopId,
  };
}

export async function getShopeeReport(params: {
  userId: string;
  fromDate: string;
  toDate: string;
}) {
  const startTime = Math.floor(new Date(`${params.fromDate}T00:00:00Z`).getTime() / 1000);
  const endTime = Math.floor(new Date(`${params.toDate}T23:59:59Z`).getTime() / 1000);
  const query = `{
    conversionReportV2(startTime: ${startTime}, endTime: ${endTime}, page: 1, limit: 100) {
      nodes {
        orderId
        checkoutId
        itemId
        itemName
        shopId
        shopName
        quantity
        price
        commission
        netCommission
        campaignType
        purchaseStatus
        itemStatus
        purchaseTime
        clickTime
        subIds
      }
      pageInfo {
        page
        limit
        hasNextPage
      }
    }
  }`;

  try {
    const data = await shopeeGraphqlCall<{
      conversionReportV2?: { nodes?: ShopeeConversionNode[] };
    }>(query);
    const subId = `affiliateai_${params.userId}`;
    return (data.conversionReportV2?.nodes ?? []).filter((node) =>
      Array.isArray(node.subIds) ? node.subIds.includes(subId) : true
    );
  } catch (err) {
    console.error('[Shopee] getReport failed:', (err as Error).message);
    return [];
  }
}
