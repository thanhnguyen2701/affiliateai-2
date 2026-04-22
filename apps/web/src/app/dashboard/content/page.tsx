'use client';
// apps/web/src/app/dashboard/content/page.tsx

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { useUIStore } from '@/lib/store';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

type Platform = 'all' | 'tiktok' | 'facebook' | 'instagram' | 'blog' | 'youtube' | 'zalo' | 'email';
type SortBy   = 'newest' | 'score' | 'rating';

interface ContentItem {
  id:                string;
  platform:          string;
  content:           string;
  hashtags?:         string[];
  quality_score:     number | null;
  user_rating:       number | null;
  affiliate_network: string | null;
  affiliate_link:    string | null;
  was_posted:        boolean;
  created_at:        string;
}

const PLATFORM_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  tiktok:    { icon: '🎬', color: '#818CF8', bg: 'rgba(129,140,248,.1)' },
  facebook:  { icon: '📘', color: '#3B82F6', bg: 'rgba(59,130,246,.1)' },
  instagram: { icon: '📷', color: '#EC4899', bg: 'rgba(236,72,153,.1)' },
  blog:      { icon: '📝', color: '#10B981', bg: 'rgba(16,185,129,.1)' },
  youtube:   { icon: '▶',  color: '#EF4444', bg: 'rgba(239,68,68,.1)'  },
  zalo:      { icon: '💬', color: '#0066FF', bg: 'rgba(0,102,255,.1)'  },
  email:     { icon: '📧', color: '#F59E0B', bg: 'rgba(245,158,11,.1)' },
  multi:     { icon: '📦', color: '#9CA3AF', bg: 'rgba(156,163,175,.1)' },
};

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'tiktok',    label: '🎬 TikTok' },
  { id: 'facebook',  label: '📘 Facebook' },
  { id: 'instagram', label: '📷 Instagram' },
  { id: 'blog',      label: '📝 Blog' },
  { id: 'youtube',   label: '▶ YouTube' },
  { id: 'zalo',      label: '💬 Zalo' },
];

// Demo content for empty state
const DEMO_CONTENT: ContentItem[] = [
  { id:'1', platform:'tiktok',    quality_score:89, user_rating:5, affiliate_network:'Shopee', affiliate_link:'https://shp.ee/xxx', was_posted:true,  created_at:new Date(Date.now()-7200000).toISOString(),   hashtags:['#skincare','#beauty','#review'], content:'Hook: "Bạn đang tìm kem dưỡng da tốt? 😱 Tôi đã thử 10 loại và đây là thứ thay đổi da tôi hoàn toàn..."\n\n[0:04-0:15] Da mình hồi trước bị mờ, thiếu sức sống dù dùng đủ thứ…\n\n[0:16-0:40] Sau 7 ngày dùng kem này, da sáng lên rõ rệt!\n\nCTA: Link bio nha! Đang giảm 35% hôm nay thôi 💕' },
  { id:'2', platform:'facebook',  quality_score:82, user_rating:4, affiliate_network:'Shopee', affiliate_link:'https://shp.ee/yyy', was_posted:true,  created_at:new Date(Date.now()-10800000).toISOString(),  hashtags:['#skincare','#innisfree'], content:'✨ Da bạn đang bị MỜ, THIẾU SỨC SỐNG?\n\nSau 2 tháng thử đủ thứ, cuối cùng mình tìm được BÍ QUYẾT! Kem Innisfree Green Tea này thật sự là game-changer cho mình 🌿\n\n✅ Da sáng sau 7 ngày\n✅ Ẩm 24h không dầu\n✅ Mụn giảm rõ rệt\n\nRating 4.9⭐ | Đã bán 50,000+ sp\nLink comment MUỐN nhé! 🛒' },
  { id:'3', platform:'blog',      quality_score:91, user_rating:5, affiliate_network:'Accesstrade', affiliate_link:'https://accesstrade.vn/xxx', was_posted:false, created_at:new Date(Date.now()-18000000).toISOString(),  hashtags:[], content:'REVIEW CHI TIẾT: Innisfree Green Tea Seed Serum 80ml — 3 tháng trải nghiệm thực tế\n\nMình là người có da dầu mụn, đã thử qua hàng chục loại serum từ bình dân đến cao cấp. Hôm nay mình sẽ review thật 100% sản phẩm này...\n\n## Thành phần chính\n## Kết cấu và mùi hương\n## Hiệu quả sau 90 ngày\n## So sánh với đối thủ\n## Kết luận' },
  { id:'4', platform:'instagram', quality_score:78, user_rating:4, affiliate_network:'TikTok', affiliate_link:null, was_posted:true,  created_at:new Date(Date.now()-86400000).toISOString(),   hashtags:['#skincareroutine','#beautytips','#khoethatda'], content:'Skincare routine buổi sáng của mình 🌿✨\n\nBước quan trọng nhất chính là serum này — đã dùng 90 ngày và không thể thiếu!\n\nLink trong bio để đặt hàng nhé 💕\n\n#skincare #beauty #skincareroutine #khoethatda #beautyreview' },
  { id:'5', platform:'zalo',      quality_score:85, user_rating:4, affiliate_network:'Shopee', affiliate_link:'https://shp.ee/zzz', was_posted:false, created_at:new Date(Date.now()-172800000).toISOString(), hashtags:[], content:'DEAL HÔM NAY ⚡\n\nKem dưỡng ẩm Innisfree giảm 35% — chỉ còn 185K (gốc 285K)\n\n✅ Rating 4.9⭐\n✅ Đã bán 50,000+ sản phẩm\n✅ Ship nhanh 2h nội thành\n\n🔗 Đặt ngay: [link]' },
  { id:'6', platform:'tiktok',    quality_score:94, user_rating:5, affiliate_network:'Shopee', affiliate_link:'https://shp.ee/aaa', was_posted:true,  created_at:new Date(Date.now()-259200000).toISOString(), hashtags:['#pov','#skincare','#viral'], content:'POV: Bạn tiêu hàng triệu vào skincare mà da vẫn không cải thiện... 😔\n\nCho đến khi thử cái này! 🌸\n\nKết quả sau 1 tuần:\n- Da sáng hơn rõ rệt\n- Mụn giảm 60%\n- Ẩm cả ngày không dầu\n\nLink bio — đang flash sale 35% hôm nay thôi!' },
];

export default function ContentPage() {
  const { setAgentDrawer } = useUIStore();
  const [items,       setItems]       = useState<ContentItem[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [platform,    setPlatform]    = useState<Platform>('all');
  const [sortBy,      setSortBy]      = useState<SortBy>('newest');
  const [search,      setSearch]      = useState('');
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const [rating,      setRating]      = useState<Record<string, number>>({});

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('content_history')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        setItems(data && data.length > 0 ? data : DEMO_CONTENT);
      } catch { setItems(DEMO_CONTENT); }
      finally  { setLoading(false); }
    }
    load();
  }, []);

  // Filter + sort
  const filtered = items
    .filter(i => platform === 'all' || i.platform === platform)
    .filter(i => !search || i.content.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'score')  return (b.quality_score ?? 0) - (a.quality_score ?? 0);
      if (sortBy === 'rating') return (b.user_rating   ?? 0) - (a.user_rating   ?? 0);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const scoreColor = (s: number | null) =>
    !s ? 'text-tx-4' : s >= 85 ? 'text-emerald-light' : s >= 70 ? 'text-amber-light' : 'text-rose-light';
  const scoreBg = (s: number | null) =>
    !s ? '' : s >= 85 ? 'bg-emerald-DEFAULT/10' : s >= 70 ? 'bg-amber/10' : 'bg-rose-DEFAULT/10';

  async function copyContent(item: ContentItem) {
    await navigator.clipboard.writeText(item.content);
    toast.success('📋 Đã copy content!');
  }

  async function rateContent(id: string, stars: number) {
    setRating(r => ({ ...r, [id]: stars }));
    setItems(prev => prev.map(i => i.id === id ? { ...i, user_rating: stars } : i));
    try {
      const supabase = createClient();
      await supabase.from('content_history').update({ user_rating: stars }).eq('id', id);
      toast.success('⭐ Đã đánh giá — AI sẽ học từ feedback này');
    } catch { toast.error('Không thể lưu đánh giá'); }
  }

  const counts = PLATFORMS.slice(1).reduce((acc, p) => {
    acc[p.id] = items.filter(i => i.platform === p.id).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-4 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">📝 Content đã tạo</h1>
          <p className="text-xs text-tx-3 mt-0.5">{items.length} bài · AI tự động tạo và tối ưu</p>
        </div>
        <button onClick={() => setAgentDrawer(true)} className="btn btn-primary gap-1.5">
          ✦ Tạo content mới
        </button>
      </div>

      {/* Filters */}
      <div className="card p-3 space-y-3">
        {/* Platform tabs */}
        <div className="flex gap-2 flex-wrap">
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => setPlatform(p.id)}
              className={clsx('px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                platform === p.id
                  ? 'bg-brand/10 border-brand/40 text-brand-lighter'
                  : 'bg-bg-3 border-bdr-2 text-tx-3 hover:border-bdr-3')}>
              {p.label}
              {p.id !== 'all' && counts[p.id] > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">({counts[p.id]})</span>
              )}
              {p.id === 'all' && <span className="ml-1.5 text-[10px] opacity-70">({items.length})</span>}
            </button>
          ))}
        </div>

        {/* Search + Sort */}
        <div className="flex gap-2">
          <input className="input flex-1 text-xs" placeholder="🔍 Tìm kiếm content..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className="select w-36 text-xs" value={sortBy}
            onChange={e => setSortBy(e.target.value as SortBy)}>
            <option value="newest">Mới nhất</option>
            <option value="score">Điểm cao nhất</option>
            <option value="rating">Rating cao nhất</option>
          </select>
        </div>
      </div>

      {/* Content list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-9 h-9 bg-bg-4 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-bg-4 rounded w-1/4" />
                  <div className="h-3 bg-bg-4 rounded w-3/4" />
                  <div className="h-3 bg-bg-4 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-sm font-semibold text-tx-2 mb-1">Chưa có content nào</p>
          <p className="text-xs text-tx-4 mb-4">
            {search ? `Không tìm thấy "${search}"` : 'Dùng AI Agent để tạo content đầu tiên'}
          </p>
          <button onClick={() => setAgentDrawer(true)} className="btn btn-primary mx-auto">
            ✦ Tạo ngay
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const cfg  = PLATFORM_CONFIG[item.platform] ?? PLATFORM_CONFIG.multi;
            const open = expanded === item.id;
            const ago  = formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: vi });
            const stars = rating[item.id] ?? item.user_rating ?? 0;

            return (
              <div key={item.id} className={clsx(
                'card transition-all duration-150',
                open ? 'border-brand/30' : 'hover:border-bdr-2'
              )}>
                {/* Row header */}
                <div className="flex items-start gap-3 p-4 cursor-pointer"
                  onClick={() => setExpanded(open ? null : item.id)}>

                  {/* Platform icon */}
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                    style={{ background: cfg.bg }}>
                    {cfg.icon}
                  </div>

                  {/* Content preview */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wide"
                        style={{ color: cfg.color }}>{item.platform}</span>
                      {item.quality_score && (
                        <span className={clsx('badge text-[9px]', scoreBg(item.quality_score))}>
                          <span className={scoreColor(item.quality_score)}>{item.quality_score}/100</span>
                        </span>
                      )}
                      {item.affiliate_network && (
                        <span className="badge badge-teal text-[9px]">{item.affiliate_network}</span>
                      )}
                      {item.was_posted && (
                        <span className="badge badge-green text-[9px]">✅ Đã đăng</span>
                      )}
                      <span className="text-[10px] text-tx-4 ml-auto">{ago}</span>
                    </div>
                    <p className="text-xs text-tx-2 leading-relaxed line-clamp-2">{item.content}</p>
                    {item.hashtags && item.hashtags.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {item.hashtags.slice(0, 4).map(h => (
                          <span key={h} className="text-[10px] text-brand-lighter opacity-70">{h}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={e => { e.stopPropagation(); copyContent(item); }}
                      className="btn btn-ghost btn-icon btn-sm" title="Copy">📋</button>
                    <span className="text-tx-4 text-sm">{open ? '▲' : '▽'}</span>
                  </div>
                </div>

                {/* Expanded view */}
                {open && (
                  <div className="border-t border-bdr-1 p-4 space-y-4 animate-fade-in">
                    {/* Full content */}
                    <div className="bg-bg-3 rounded-xl p-4 text-xs text-tx-2 leading-relaxed whitespace-pre-wrap font-mono">
                      {item.content}
                    </div>

                    {/* Hashtags */}
                    {item.hashtags && item.hashtags.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {item.hashtags.map(h => (
                          <span key={h} className="px-2 py-0.5 bg-brand/10 border border-brand/20
                                                   rounded-full text-[11px] text-brand-lighter">
                            {h}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Rating + Actions */}
                    <div className="flex items-center gap-4 flex-wrap">
                      {/* Star rating */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-tx-3">Đánh giá:</span>
                        {[1,2,3,4,5].map(n => (
                          <button key={n} onClick={() => rateContent(item.id, n)}
                            className={clsx('text-base transition-all hover:scale-125',
                              n <= stars ? 'text-amber-light' : 'text-bg-5')}>
                            ★
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-2 ml-auto">
                        {item.affiliate_link && (
                          <a href={item.affiliate_link} target="_blank" rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm gap-1.5 text-[11px]">
                            🔗 Xem offer
                          </a>
                        )}
                        <button onClick={() => copyContent(item)}
                          className="btn btn-ghost btn-sm gap-1.5 text-[11px]">
                          📋 Copy content
                        </button>
                        <button onClick={() => {
                          setAgentDrawer(true);
                          toast('✍ Mở AI để tối ưu content này...');
                        }} className="btn btn-primary btn-sm gap-1.5 text-[11px]">
                          ✦ Tối ưu với AI
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
