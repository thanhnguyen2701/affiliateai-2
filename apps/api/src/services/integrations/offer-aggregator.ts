// apps/api/src/services/integrations/offer-aggregator.ts
// Gộp offers từ tất cả networks, rank và match theo user

import { getShopeeTopOffers }    from './shopee.js';
import { getATOffers }           from './accesstrade.js';
import { getTikTokAffiliateProducts } from './tiktok.js';
import type { AffiliateNetwork, Niche } from '../../../../packages/shared/src/types.js';

export interface RankedOffer {
  id:              string;
  network:         AffiliateNetwork;
  product_name:    string;
  category:        string;
  commission_pct:  number;
  epc_estimate:    number;   // VND
  price:           number;   // VND
  rating:          number;
  sold_count:      number;
  image_url:       string;
  affiliate_url:   string;
  match_score:     number;   // 0-100
  why_recommended: string;
}

// ─── Scoring weights ──────────────────────────────────────────────────────────
const W = { epc: 0.30, commission: 0.25, audience_fit: 0.20, trend: 0.15, competition: 0.10 };

// ─── Niche → category mapping ─────────────────────────────────────────────────
const NICHE_CATEGORIES: Record<string, string[]> = {
  beauty:   ['beauty', 'skincare', 'makeup', 'mỹ phẩm', 'làm đẹp'],
  tech:     ['electronics', 'gadget', 'phone', 'laptop', 'công nghệ'],
  fashion:  ['clothing', 'shoes', 'fashion', 'thời trang', 'túi xách'],
  food:     ['food', 'drink', 'snack', 'thực phẩm', 'đồ ăn'],
  home:     ['home', 'furniture', 'decoration', 'nội thất', 'nhà cửa'],
  health:   ['health', 'supplement', 'vitamin', 'sức khỏe', 'thể thao'],
  finance:  ['finance', 'insurance', 'investment', 'tài chính'],
};

export async function getTopOffersForUser(params: {
  niche: Niche | null;
  networks: AffiliateNetwork[];
  limit?: number;
}): Promise<RankedOffer[]> {
  const { niche, networks, limit = 10 } = params;
  const all: RankedOffer[] = [];

  // Fetch từ các networks đang active song song
  const fetches: Promise<void>[] = [];

  if (networks.includes('shopee') || networks.length === 0) {
    fetches.push(
      getShopeeTopOffers({ sort_type: 2, limit: 20 }).then(offers => {
        for (const o of offers) {
          all.push({
            id:             o.item_id,
            network:        'shopee',
            product_name:   o.item_name,
            category:       o.category_id,
            commission_pct: o.commission_rate * 100,
            epc_estimate:   Math.round(o.epc),
            price:          Math.round(o.sale_price),
            rating:         o.seller_rating,
            sold_count:     o.sold,
            image_url:      o.image,
            affiliate_url:  o.product_link,
            match_score:    0,
            why_recommended: '',
          });
        }
      }).catch(() => {})
    );
  }

  if (networks.includes('accesstrade')) {
    fetches.push(
      getATOffers({ limit: 20 }).then(offers => {
        for (const o of offers) {
          all.push({
            id:             o.id,
            network:        'accesstrade',
            product_name:   o.name,
            category:       o.category,
            commission_pct: o.commission_value,
            epc_estimate:   Math.round(o.epc * 1000),  // convert to VND
            price:          0,
            rating:         0,
            sold_count:     0,
            image_url:      o.logo,
            affiliate_url:  o.tracking_url,
            match_score:    0,
            why_recommended: '',
          });
        }
      }).catch(() => {})
    );
  }

  if (networks.includes('tiktok')) {
    fetches.push(
      getTikTokAffiliateProducts({ limit: 20 }).then(products => {
        for (const p of products) {
          const price = Number(p.price.original_price) || 0;
          all.push({
            id:             p.product_id,
            network:        'tiktok',
            product_name:   p.product_name,
            category:       '',
            commission_pct: Number(p.commission_rate) || 5,
            epc_estimate:   Math.round(price * (Number(p.commission_rate) || 5) / 100 * 0.03),
            price,
            rating:         p.review_summary?.rating ?? 0,
            sold_count:     p.sales?.sold_count ?? 0,
            image_url:      p.main_images?.[0]?.url_list?.[0] ?? '',
            affiliate_url:  `https://www.tiktok.com/shop/${p.product_id}`,
            match_score:    0,
            why_recommended: '',
          });
        }
      }).catch(() => {})
    );
  }

  await Promise.allSettled(fetches);

  // Score từng offer
  const nicheKeywords = niche ? (NICHE_CATEGORIES[niche] ?? []) : [];
  const maxEpc        = Math.max(...all.map(o => o.epc_estimate), 1);
  const maxComm       = Math.max(...all.map(o => o.commission_pct), 1);

  for (const offer of all) {
    const epcScore       = (offer.epc_estimate / maxEpc) * 100;
    const commScore      = (offer.commission_pct / maxComm) * 100;
    const audienceFit    = nicheKeywords.some(kw =>
      offer.product_name.toLowerCase().includes(kw) ||
      offer.category.toLowerCase().includes(kw)
    ) ? 100 : 30;
    const trendScore     = Math.min(offer.sold_count / 1000, 100);
    const ratingScore    = offer.rating * 20; // 0-5 → 0-100

    offer.match_score = Math.round(
      epcScore * W.epc +
      commScore * W.commission +
      audienceFit * W.audience_fit +
      trendScore * W.trend +
      ratingScore * W.competition
    );

    offer.why_recommended = buildWhy(offer, audienceFit > 50);
  }

  return all
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}

function buildWhy(offer: RankedOffer, nicheMatch: boolean): string {
  const reasons: string[] = [];
  if (offer.commission_pct > 10) reasons.push(`Hoa hồng cao ${offer.commission_pct.toFixed(1)}%`);
  if (offer.epc_estimate > 10_000) reasons.push(`EPC tốt ~${(offer.epc_estimate / 1000).toFixed(0)}K đ`);
  if (offer.sold_count > 1000) reasons.push(`Đã bán ${offer.sold_count.toLocaleString()}+ sp`);
  if (offer.rating >= 4.5) reasons.push(`Rating ${offer.rating}⭐`);
  if (nicheMatch) reasons.push('Phù hợp niche của bạn');
  return reasons.slice(0, 3).join(' · ') || 'Offer tiềm năng';
}
