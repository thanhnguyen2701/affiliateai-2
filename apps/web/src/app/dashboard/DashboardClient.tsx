'use client';
// apps/web/src/app/dashboard/DashboardClient.tsx

import { useUIStore } from '@/lib/store';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { format, subDays } from 'date-fns';
import { vi } from 'date-fns/locale';
import clsx from 'clsx';
import toast from 'react-hot-toast';

// ─── Static demo data (real data comes from props) ────────────────────────────
const DEMO_TRENDS = [
  { rank:1, name:'Kem chống nắng SPF50+',   score:96, hot:true  },
  { rank:2, name:'Serum Vitamin C sáng da',  score:88, hot:true  },
  { rank:3, name:'Nước tẩy trang Bioderma', score:81, hot:false },
  { rank:4, name:'Mặt nạ đất sét lỗ chân lông', score:74, hot:false },
  { rank:5, name:'Dầu tẩy trang DHC Olive', score:68, hot:false },
];

const DEMO_OFFERS = [
  { emoji:'🌿', name:'Innisfree Green Tea Serum', net:'Shopee',     commission:8.5,  epc:14.2, match:95 },
  { emoji:'🐌', name:'COSRX Snail Mucin',         net:'Accesstrade', commission:12.0, epc:18.5, match:91 },
  { emoji:'🧴', name:'Some By Mi AHA·BHA',        net:'Shopee',     commission:7.2,  epc:11.8, match:86 },
  { emoji:'☀️', name:'Beauty of Joseon Sun',      net:'TikTok',     commission:9.0,  epc:13.5, match:82 },
];

const DEMO_ACTIVITY = [
  { color:'#818CF8', text:'Draft TikTok "Kem chống nắng" — Score 89/100', time:'2 phút trước' },
  { color:'#10B981', text:'Tìm 3 offer EPC cao từ Shopee & Accesstrade',  time:'15 phút trước' },
  { color:'#F59E0B', text:'Morning Trend Scan hoàn thành — Top 5 cập nhật', time:'32 phút trước' },
  { color:'#14B8A6', text:'Tự động reply 2 inbox Facebook',               time:'1 giờ trước' },
  { color:'#818CF8', text:'Weekly Report: CTR +1.2%, Doanh thu +18%',     time:'2 giờ trước' },
];

const PLATFORM_STATS = [
  { name:'TikTok',    ctr:4.8, color:'#818CF8', rev:'1.84M' },
  { name:'Facebook',  ctr:3.2, color:'#10B981', rev:'1.25M' },
  { name:'Blog',      ctr:6.1, color:'#14B8A6', rev:'0.82M' },
  { name:'Instagram', ctr:2.9, color:'#F59E0B', rev:'0.31M' },
];

// Generate 14-day chart data
const CHART_DATA = Array.from({ length: 14 }, (_, i) => ({
  day:  format(subDays(new Date(), 13 - i), 'd/M', { locale: vi }),
  rev:  Math.floor(200 + Math.random() * 700 + i * 30),
  last: Math.floor(150 + Math.random() * 500 + i * 20),
}));

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  metrics: {
    revenue: number; contentCount: number;
    avgCTR: number; totalClicks: number; totalConversions: number;
  };
  recentContent: Array<{ id:string; platform:string; content:string; quality_score:number|null; created_at:string }>;
  schedulerLogs: Array<{ job_type:string; status:string; ran_at:string }>;
  visualJobs:    Array<{ id:string; pipeline:string; status:string; created_at:string }>;
}

// ─── Metric Card ──────────────────────────────────────────────────────────────
function MetricCard({ label, value, delta, deltaLabel, color, icon, accentColor }: {
  label:string; value:string; delta:string; deltaLabel:string;
  color:string; icon:string; accentColor:string;
}) {
  return (
    <div className="metric-card group" onClick={() => toast(`📊 ${label}: ${value}`)}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: color }} />
      <div className="absolute right-3 top-3 text-xl opacity-20 group-hover:opacity-30 transition-opacity">
        {icon}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-tx-3 mb-2">{label}</p>
      <p className="text-3xl font-extrabold tracking-tight mb-1" style={{ color: accentColor }}>
        {value}
      </p>
      <div className="flex items-center gap-1.5 text-[11px] text-tx-3">
        <span className="font-semibold text-emerald-light">{delta}</span>
        <span>{deltaLabel}</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DashboardClient({ metrics, recentContent, schedulerLogs, visualJobs }: Props) {
  const { setAgentDrawer } = useUIStore();

  const revenueM  = metrics.revenue > 0 ? `${(metrics.revenue / 1_000_000).toFixed(1)}M` : '4.2M';
  const contentN  = metrics.contentCount > 0 ? String(metrics.contentCount) : '87';
  const ctrVal    = metrics.avgCTR > 0 ? `${metrics.avgCTR}%` : '3.8%';
  const convVal   = metrics.totalConversions > 0
    ? `${((metrics.totalConversions / Math.max(metrics.totalClicks, 1)) * 100).toFixed(1)}%`
    : '4.1%';

  const METRICS = [
    { label:'Doanh thu tháng',  value:revenueM, delta:'▲ +18%', deltaLabel:'so tháng 3', icon:'💰', color:'linear-gradient(90deg,#6366F1,#818CF8)', accentColor:'#818CF8' },
    { label:'Content đã tạo',   value:contentN, delta:'▲ +34',  deltaLabel:'tuần này',   icon:'📝', color:'linear-gradient(90deg,#0D9488,#14B8A6)', accentColor:'#14B8A6' },
    { label:'CTR trung bình',   value:ctrVal,   delta:'▲ +1.2%',deltaLabel:'vs benchmark',icon:'📊', color:'linear-gradient(90deg,#059669,#10B981)', accentColor:'#10B981' },
    { label:'Conversion rate',  value:convVal,  delta:'▲ +0.8%',deltaLabel:'so tháng 3', icon:'🎯', color:'linear-gradient(90deg,#D97706,#F59E0B)', accentColor:'#F59E0B' },
  ];

  // Platform colors for chart
  const maxRev = Math.max(...CHART_DATA.map(d => d.rev));

  return (
    <div className="p-4 space-y-3 animate-fade-in">

      {/* ── METRICS ROW ───────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {METRICS.map(m => <MetricCard key={m.label} {...m} />)}
      </div>

      {/* ── ROW 2: Revenue Chart + Tasks ──────────────────────────── */}
      <div className="grid grid-cols-5 gap-3">
        {/* Revenue Chart (3/5) */}
        <div className="card col-span-3">
          <div className="panel-head">
            <span>📈</span> Doanh thu 14 ngày
            <span className="badge badge-green ml-2">+18% MoM</span>
            <span className="ml-auto text-[11px] text-tx-4">VNĐ nghìn</span>
          </div>
          <div className="panel-body">
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={CHART_DATA} barSize={14}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1E2535', border: '1px solid #2D3748', borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: '#D1D5DB' }}
                  formatter={(v: number) => [`${v}K đ`, 'Doanh thu']}
                />
                <Bar dataKey="rev" radius={[3,3,0,0]}>
                  {CHART_DATA.map((entry, i) => (
                    <Cell key={i}
                      fill={i >= CHART_DATA.length - 3
                        ? i === CHART_DATA.length - 1 ? '#6366F1' : '#0D9488'
                        : '#252D40'}
                      opacity={i >= CHART_DATA.length - 5 ? 1 : 0.5}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Today Tasks (2/5) */}
        <div className="card col-span-2">
          <div className="panel-head"><span>⚡</span> Hôm nay</div>
          <div className="panel-body space-y-1.5">
            {[
              { done:true,  text:'Morning trend scan' },
              { done:true,  text:'Draft 3 content TikTok' },
              { done:false, text:'Review & approve 3 drafts', urgent:true },
              { done:false, text:'2 inbox chưa trả lời',      urgent:true },
              { done:false, text:'Thử offer COSRX mới (EPC 18.5K)' },
            ].map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <div className={clsx('w-4 h-4 rounded flex items-center justify-center text-[9px] flex-shrink-0',
                  t.done ? 'bg-emerald-DEFAULT text-white' : 'bg-bg-4 border border-bdr-3')}>
                  {t.done && '✓'}
                </div>
                <span className={clsx('flex-1', t.done ? 'text-tx-4 line-through' : 'text-tx-2')}>
                  {t.text}
                </span>
                {t.urgent && !t.done && (
                  <span className="badge badge-amber text-[9px]">!</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ROW 3: Content + Trends + Offers ──────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {/* Recent Content */}
        <div className="card">
          <div className="panel-head">
            <span>📝</span> Content gần đây
            <span className="ml-auto text-[11px] text-tx-4">87 tổng</span>
            <button onClick={() => toast('📝 Mở content list')} className="ph-action ml-2">Xem tất cả</button>
          </div>
          <div className="panel-body space-y-0 divide-y divide-bdr-1">
            {(recentContent.length > 0 ? recentContent : [
              { id:'1', platform:'tiktok',    content:'Hook: "Bạn đang tìm kem dưỡng da tốt?..."', quality_score:89, created_at:new Date(Date.now()-7200000).toISOString() },
              { id:'2', platform:'facebook',  content:'✨ Da mình đang bị mờ, thiếu sức sống...',  quality_score:82, created_at:new Date(Date.now()-10800000).toISOString() },
              { id:'3', platform:'blog',      content:'REVIEW CHI TIẾT: Innisfree Green Tea...',    quality_score:91, created_at:new Date(Date.now()-18000000).toISOString() },
              { id:'4', platform:'instagram', content:'Skincare routine buổi sáng của mình 🌿✨',  quality_score:78, created_at:new Date(Date.now()-86400000).toISOString() },
              { id:'5', platform:'zalo',      content:'DEAL HÔM NAY ⚡ Kem dưỡng ẩm Innisfree...', quality_score:85, created_at:new Date(Date.now()-172800000).toISOString() },
            ]).slice(0,5).map(c => {
              const scoreColor = (c.quality_score ?? 0) >= 85 ? 'text-emerald-light' :
                                 (c.quality_score ?? 0) >= 70 ? 'text-amber-light' : 'text-rose-light';
              const icons: Record<string,string> = { tiktok:'🎬', facebook:'📘', instagram:'📷', blog:'📝', youtube:'▶', zalo:'💬', email:'📧' };
              return (
                <div key={c.id} className="py-2 flex items-start gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                  <span className="text-base flex-shrink-0">{icons[c.platform] ?? '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-tx-4">
                        {c.platform}
                      </span>
                      {c.quality_score && (
                        <span className={clsx('text-[10px] font-bold', scoreColor)}>
                          {c.quality_score}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-tx-2 truncate">{c.content}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); toast.success('📋 Đã copy!'); }}
                    className="btn btn-ghost btn-icon text-tx-4 flex-shrink-0">📋</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Trends */}
        <div className="card">
          <div className="panel-head">
            <span>🔥</span> Trend hôm nay
            <span className="badge badge-amber ml-2">LIVE</span>
            <span className="ml-auto text-[11px] text-tx-4">06:00 AM</span>
          </div>
          <div className="panel-body space-y-0 divide-y divide-bdr-1">
            {DEMO_TRENDS.map(t => (
              <div key={t.rank} className="py-2 flex items-center gap-2">
                <div className={clsx('w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0',
                  t.hot ? 'bg-amber/15 text-amber-light' : 'bg-bg-4 text-tx-4')}>
                  {t.rank}
                </div>
                <span className="flex-1 text-xs font-medium truncate">{t.name}</span>
                <div className="w-12 h-1 bg-bg-4 rounded overflow-hidden">
                  <div className="h-full bg-emerald-light rounded" style={{ width: `${t.score}%` }} />
                </div>
                <span className="text-[11px] font-bold text-emerald-light w-6 text-right">{t.score}</span>
                <button onClick={() => { setAgentDrawer(true); toast(`🎬 Tạo content về: ${t.name}`); }}
                  className="text-[10px] px-2 py-0.5 rounded bg-brand/15 border border-brand/20 text-brand-lighter
                             hover:bg-brand/25 transition-colors cursor-pointer">
                  Tạo
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Offers */}
        <div className="card">
          <div className="panel-head">
            <span>🎯</span> Top Offers
            <span className="ml-auto text-[11px] text-tx-4">Match niche bạn</span>
          </div>
          <div className="panel-body space-y-0 divide-y divide-bdr-1">
            {DEMO_OFFERS.map((o, i) => {
              const matchColor = o.match >= 90 ? '#10B981' : o.match >= 80 ? '#818CF8' : '#F59E0B';
              const circumference = 2 * Math.PI * 10;
              return (
                <div key={i} className="py-2 flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                  <span className="text-lg flex-shrink-0">{o.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{o.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-tx-3">{o.net}</span>
                      <span className="text-[10px] font-bold" style={{ color: '#10B981' }}>
                        {o.commission}%
                      </span>
                      <span className="text-[10px] font-bold" style={{ color: '#818CF8' }}>
                        {o.epc}K EPC
                      </span>
                    </div>
                  </div>
                  {/* Ring */}
                  <div className="relative flex-shrink-0">
                    <svg width="28" height="28" viewBox="0 0 28 28" style={{ transform:'rotate(-90deg)' }}>
                      <circle cx="14" cy="14" r="10" fill="none" stroke="#252D40" strokeWidth="2.5"/>
                      <circle cx="14" cy="14" r="10" fill="none" stroke={matchColor} strokeWidth="2.5"
                        strokeDasharray={`${o.match/100*circumference} ${circumference}`}
                        strokeLinecap="round"/>
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold"
                      style={{ color: matchColor }}>{o.match}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── ROW 4: Platform CTR + Insights + Activity ─────────────── */}
      <div className="grid grid-cols-5 gap-3">
        {/* Platform CTR + Insights (2/5) */}
        <div className="col-span-2 space-y-3">
          <div className="card">
            <div className="panel-head"><span>📡</span> CTR theo Platform</div>
            <div className="panel-body space-y-2">
              {PLATFORM_STATS.map(p => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="text-[11px] text-tx-2 font-medium w-16 flex-shrink-0">{p.name}</span>
                  <div className="flex-1 h-1.5 bg-bg-4 rounded overflow-hidden">
                    <div className="h-full rounded transition-all duration-700"
                      style={{ width: `${p.ctr / 7 * 100}%`, background: p.color }} />
                  </div>
                  <span className="text-[11px] font-bold w-8 text-right" style={{ color: p.color }}>
                    {p.ctr}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="panel-head">
              <span>🤖</span> AI Insights
              <span className="badge badge-blue ml-2">NEW</span>
            </div>
            <div className="panel-body space-y-2">
              {[
                { i:'🚀', t:'Tăng TikTok lên 15 video/tuần', d:'+680K đ/tháng', c:'badge-blue' },
                { i:'💰', t:'Đổi sang COSRX (EPC 18.5K)',     d:'+3x EPC hiện tại', c:'badge-green' },
                { i:'⏰', t:'Đăng lúc 20:00–21:00',           d:'+34% CTR',          c:'badge-amber' },
              ].map((r, i) => (
                <div key={i} className="flex gap-2 items-start p-2 rounded-lg bg-bg-3 cursor-pointer hover:bg-bg-4 transition-colors"
                  onClick={() => toast.success('✅ Áp dụng: ' + r.t)}>
                  <span className="text-base flex-shrink-0">{r.i}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate">{r.t}</p>
                    <p className="text-[10px] text-tx-3">{r.d}</p>
                  </div>
                  <span className={clsx('badge flex-shrink-0', r.c)}>→</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent Activity (3/5) */}
        <div className="card col-span-3">
          <div className="panel-head">
            <span>⬡</span> Agent Activity
            <span className="status-online ml-2" />
            <span className="text-[11px] text-emerald-light ml-1">Real-time</span>
            <span className="ml-auto text-[11px] text-tx-4">24h log</span>
          </div>
          <div className="panel-body divide-y divide-bdr-1">
            {(schedulerLogs.length > 0 ? schedulerLogs.map(l => ({
              color: l.status === 'completed' ? '#10B981' : l.status === 'failed' ? '#F43F5E' : '#818CF8',
              text: `${l.job_type.replace(/_/g, ' ')} — ${l.status}`,
              time: format(new Date(l.ran_at), 'HH:mm'),
            })) : DEMO_ACTIVITY).map((a, i) => (
              <div key={i} className="py-2 flex gap-2.5 items-start">
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: a.color }} />
                <p className="flex-1 text-[11px] text-tx-2 leading-relaxed">{a.text}</p>
                <span className="text-[10px] text-tx-4 flex-shrink-0">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
