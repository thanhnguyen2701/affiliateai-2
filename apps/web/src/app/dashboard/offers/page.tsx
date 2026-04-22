'use client';
// apps/web/src/app/dashboard/offers/page.tsx

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { offersAPI } from '@/lib/api';
import { useUIStore } from '@/lib/store';

interface Offer {
  id:             string;
  network:        string;
  product_name:   string;
  category:       string;
  commission_pct: number;
  epc_estimate:   number;
  price:          number;
  rating:         number;
  sold_count:     number;
  image_url:      string;
  affiliate_url:  string;
  match_score:    number;
  why_recommended: string;
}

const DEMO_OFFERS: Offer[] = [
  { id:'1', network:'Shopee',      product_name:'Innisfree Green Tea Seed Serum 80ml', category:'beauty',  commission_pct:8.5,  epc_estimate:14200, price:285000, rating:4.9, sold_count:50213, image_url:'', affiliate_url:'#', match_score:95, why_recommended:'EPC cao + Rating xuất sắc + Phù hợp niche Beauty' },
  { id:'2', network:'Accesstrade', product_name:'COSRX Advanced Snail Mucin Power Essence', category:'beauty', commission_pct:12.0, epc_estimate:18500, price:450000, rating:4.7, sold_count:22100, image_url:'', affiliate_url:'#', match_score:91, why_recommended:'Hoa hồng cao nhất + EPC vượt trội 3x hiện tại' },
  { id:'3', network:'Shopee',      product_name:'Some By Mi AHA·BHA·PHA 30 Days Toner',  category:'beauty',  commission_pct:7.2,  epc_estimate:11800, price:220000, rating:4.8, sold_count:38700, image_url:'', affiliate_url:'#', match_score:86, why_recommended:'Trending TikTok + Bán chạy top 10' },
  { id:'4', network:'TikTok Shop', product_name:'Beauty of Joseon Relief Sun SPF50+',    category:'beauty',  commission_pct:9.0,  epc_estimate:13500, price:310000, rating:4.9, sold_count:41200, image_url:'', affiliate_url:'#', match_score:83, why_recommended:'Hot nhất mùa hè + TikTok viral' },
  { id:'5', network:'Shopee',      product_name:'Laneige Lip Sleeping Mask 20g',          category:'beauty',  commission_pct:9.0,  epc_estimate:13200, price:350000, rating:4.8, sold_count:65400, image_url:'', affiliate_url:'#', match_score:80, why_recommended:'Best-seller lâu năm + Hoa hồng ổn định' },
  { id:'6', network:'Rentracks',   product_name:'The Ordinary Niacinamide 10% + Zinc',   category:'beauty',  commission_pct:6.5,  epc_estimate:9200,  price:180000, rating:4.6, sold_count:44800, image_url:'', affiliate_url:'#', match_score:76, why_recommended:'Volume cao + Cộng đồng skincare yêu thích' },
];

const NETWORK_COLORS: Record<string, string> = {
  'Shopee':      '#EE4D2D',
  'Accesstrade': '#0066CC',
  'TikTok Shop': '#010101',
  'Rentracks':   '#6366F1',
  'Lazada':      '#0F146D',
};

const NICHE_EMOJIS: Record<string, string> = {
  beauty: '💄', tech: '💻', food: '🍜', fashion: '👗', home: '🏠', health: '💪',
};

export default function OffersPage() {
  const { setAgentDrawer } = useUIStore();
  const [offers,    setOffers]    = useState<Offer[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [sortBy,    setSortBy]    = useState<'match'|'epc'|'commission'>('match');
  const [network,   setNetwork]   = useState('all');

  useEffect(() => { loadOffers(); }, []);

  async function loadOffers() {
    setLoading(true);
    try {
      const data = await offersAPI.getTop() as Offer[];
      setOffers(data && data.length > 0 ? data : DEMO_OFFERS);
    } catch { setOffers(DEMO_OFFERS); }
    finally  { setLoading(false); }
  }

  async function refresh() {
    setRefreshing(true);
    await loadOffers();
    setTimeout(() => setRefreshing(false), 500);
    toast.success('✅ Đã cập nhật offers mới nhất!');
  }

  const networks = ['all', ...Array.from(new Set(offers.map(o => o.network)))];
  const filtered = offers
    .filter(o => network === 'all' || o.network === network)
    .sort((a, b) => {
      if (sortBy === 'epc')        return b.epc_estimate   - a.epc_estimate;
      if (sortBy === 'commission') return b.commission_pct - a.commission_pct;
      return b.match_score - a.match_score;
    });

  const matchColor = (s: number) =>
    s >= 90 ? '#10B981' : s >= 80 ? '#6366F1' : s >= 70 ? '#F59E0B' : '#9CA3AF';

  const circumference = 2 * Math.PI * 14;

  return (
    <div className="p-4 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-base font-bold">🎯 Offers & Hoa hồng</h1>
          <p className="text-xs text-tx-3 mt-0.5">
            Xếp hạng theo AI — phù hợp nhất với niche và kênh của bạn
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing}
          className={clsx('btn btn-ghost gap-1.5 text-xs', refreshing && 'opacity-50')}>
          <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
          Cập nhật
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label:'Offers tìm thấy',  value:String(offers.length),  color:'#818CF8' },
          { label:'EPC cao nhất',     value:`${(Math.max(...offers.map(o=>o.epc_estimate))/1000).toFixed(1)}K đ`, color:'#10B981' },
          { label:'HH% cao nhất',     value:`${Math.max(...offers.map(o=>o.commission_pct)).toFixed(1)}%`, color:'#F59E0B' },
          { label:'Match tốt nhất',   value:`${Math.max(...offers.map(o=>o.match_score))}%`, color:'#14B8A6' },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <div className="text-xl font-extrabold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-tx-4 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap flex-1">
          {networks.map(n => (
            <button key={n} onClick={() => setNetwork(n)}
              className={clsx('px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                network === n
                  ? 'bg-brand/10 border-brand/40 text-brand-lighter'
                  : 'bg-bg-3 border-bdr-2 text-tx-3 hover:border-bdr-3')}>
              {n === 'all' ? 'Tất cả networks' : n}
            </button>
          ))}
        </div>
        <select className="select w-40 text-xs" value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}>
          <option value="match">Match score</option>
          <option value="epc">EPC cao nhất</option>
          <option value="commission">Hoa hồng cao nhất</option>
        </select>
      </div>

      {/* Offers grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="card p-4 animate-pulse space-y-3">
              <div className="flex gap-3">
                <div className="w-12 h-12 bg-bg-4 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-bg-4 rounded w-3/4" />
                  <div className="h-3 bg-bg-4 rounded w-1/3" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[1,2,3].map(j => <div key={j} className="h-12 bg-bg-4 rounded-lg" />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map(offer => (
            <div key={offer.id} className="card hover:border-bdr-2 transition-all hover:-translate-y-0.5 cursor-pointer"
              onClick={() => {
                setAgentDrawer(true);
                toast(`✍ Tạo content cho: ${offer.product_name.slice(0,30)}...`);
              }}>
              <div className="p-4">
                {/* Header */}
                <div className="flex gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-bg-3 flex items-center justify-center text-2xl flex-shrink-0">
                    {NICHE_EMOJIS[offer.category] ?? '🛍'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold line-clamp-2 mb-1">{offer.product_name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold" style={{ color: NETWORK_COLORS[offer.network] ?? '#9CA3AF' }}>
                        {offer.network}
                      </span>
                      {offer.rating > 0 && (
                        <span className="text-[10px] text-amber-light">⭐ {offer.rating}</span>
                      )}
                    </div>
                  </div>

                  {/* Match ring */}
                  <div className="relative flex-shrink-0">
                    <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform:'rotate(-90deg)' }}>
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#252D40" strokeWidth="3"/>
                      <circle cx="18" cy="18" r="14" fill="none"
                        stroke={matchColor(offer.match_score)} strokeWidth="3"
                        strokeDasharray={`${offer.match_score/100*circumference} ${circumference}`}
                        strokeLinecap="round"/>
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[10px] font-extrabold"
                        style={{ color: matchColor(offer.match_score) }}>
                        {offer.match_score}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label:'Hoa hồng', value:`${offer.commission_pct}%`,   color:'#10B981' },
                    { label:'EPC',      value:`${(offer.epc_estimate/1000).toFixed(1)}K đ`, color:'#818CF8' },
                    { label:'Đã bán',   value:offer.sold_count > 1000 ? `${(offer.sold_count/1000).toFixed(0)}K` : String(offer.sold_count), color:'#F59E0B' },
                  ].map(s => (
                    <div key={s.label} className="bg-bg-3 rounded-lg p-2 text-center">
                      <div className="text-sm font-extrabold" style={{ color: s.color }}>{s.value}</div>
                      <div className="text-[9px] text-tx-4 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Why recommended */}
                <p className="text-[11px] text-tx-3 mb-3 line-clamp-1">{offer.why_recommended}</p>

                {/* Actions */}
                <div className="flex gap-2">
                  <a href={offer.affiliate_url} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="btn btn-ghost btn-sm flex-1 justify-center text-[11px]">
                    🔗 Lấy link
                  </a>
                  <button onClick={e => { e.stopPropagation(); setAgentDrawer(true); }}
                    className="btn btn-primary btn-sm flex-1 justify-center text-[11px]">
                    ✦ Tạo content
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
