'use client';
// apps/web/src/app/dashboard/analytics/page.tsx

import { useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { useUIStore } from '@/lib/store';

// ── Demo data ────────────────────────────────────────────────────────────────
const REVENUE_30D = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}/4`,
  rev: Math.round(80000 + Math.random() * 200000 + i * 3000),
  clicks: Math.round(50 + Math.random() * 150 + i * 2),
}));

const PLATFORM_DATA = [
  { name:'TikTok',    ctr:4.8, conv:5.1, rev:1840000, color:'#818CF8' },
  { name:'Facebook',  ctr:3.2, conv:3.8, rev:1250000, color:'#3B82F6' },
  { name:'Blog/SEO',  ctr:6.1, conv:7.2, rev:820000,  color:'#10B981' },
  { name:'Instagram', ctr:2.9, conv:3.1, rev:310000,  color:'#EC4899' },
  { name:'Zalo',      ctr:2.1, conv:2.8, rev:180000,  color:'#0066FF' },
];

const NETWORK_PIE = [
  { name:'Shopee',      value:57, color:'#EE4D2D' },
  { name:'Accesstrade', value:26, color:'#0066CC' },
  { name:'TikTok Shop', value:17, color:'#818CF8' },
];

const CONTENT_PERF = [
  { type:'TikTok Script',    count:32, avg_score:87, avg_ctr:4.8, color:'#818CF8' },
  { type:'Facebook Caption', count:24, avg_score:81, avg_ctr:3.2, color:'#3B82F6' },
  { type:'Blog Review',      count:18, avg_score:89, avg_ctr:6.1, color:'#10B981' },
  { type:'Instagram',        count:13, avg_score:76, avg_ctr:2.9, color:'#EC4899' },
];

const AI_RECS = [
  {
    priority: 1,
    icon: '🚀',
    title: 'Tăng TikTok lên 15 video/tuần',
    detail: 'TikTok có CTR 4.8% — cao gấp 1.5x Facebook. Với 15 video/tuần thay vì 8 hiện tại, ước tính tăng +680K đ/tháng.',
    impact: '+680K đ/tháng',
    effort: 'Trung bình',
    badge: 'badge-blue',
  },
  {
    priority: 2,
    icon: '💰',
    title: 'Thay offer Tech bằng COSRX (EPC 18.5K)',
    detail: 'Offer Tech đang có EPC ~6K — thấp hơn 3x so với COSRX Snail Mucin (18.5K). Chuyển ngay để tăng thu nhập.',
    impact: '+3x EPC/click',
    effort: 'Thấp',
    badge: 'badge-green',
  },
  {
    priority: 3,
    icon: '⏰',
    title: 'Đăng bài lúc 20:00–21:00 thay vì 18:00',
    detail: 'Phân tích 30 ngày: CTR của bạn tăng 34% ở khung giờ 20-21h. Giờ hiện tại (18h) chỉ đạt 2.8% CTR.',
    impact: '+34% CTR',
    effort: 'Thấp',
    badge: 'badge-amber',
  },
  {
    priority: 4,
    icon: '📝',
    title: 'Tạo 1 Blog review chi tiết/tuần',
    detail: 'Blog/SEO có CTR cao nhất 6.1% nhưng chỉ chiếm 20% content. Tăng lên 25% có thể tăng thêm +320K đ/tháng.',
    impact: '+320K đ/tháng',
    effort: 'Cao',
    badge: 'badge-teal',
  },
];

type Period = '7d' | '30d' | '90d';

const CUSTOM_TOOLTIP_STYLE = {
  contentStyle: { background: '#1E2535', border: '1px solid #2D3748', borderRadius: 8, fontSize: 11 },
  labelStyle:   { color: '#D1D5DB' },
};

export default function AnalyticsPage() {
  const { setAgentDrawer } = useUIStore();
  const [period, setPeriod] = useState<Period>('30d');

  const revenueData = period === '7d' ? REVENUE_30D.slice(-7) :
                      period === '90d' ? [...REVENUE_30D, ...REVENUE_30D, ...REVENUE_30D] :
                      REVENUE_30D;

  const totalRev  = revenueData.reduce((s, d) => s + d.rev, 0);
  const totalClicks = revenueData.reduce((s, d) => s + d.clicks, 0);

  return (
    <div className="p-4 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-base font-bold">📈 Phân tích hiệu suất</h1>
          <p className="text-xs text-tx-3 mt-0.5">Data từ tất cả kênh và affiliate networks</p>
        </div>
        <div className="flex gap-2">
          {(['7d','30d','90d'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={clsx('btn btn-sm', period === p ? 'btn-primary' : 'btn-ghost')}>
              {p === '7d' ? '7 ngày' : p === '30d' ? '30 ngày' : '90 ngày'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label:'Tổng doanh thu',    value:`${(totalRev/1_000_000).toFixed(1)}M đ`, delta:'+18%', color:'#818CF8' },
          { label:'Tổng clicks',       value:totalClicks.toLocaleString(),            delta:'+23%', color:'#10B981' },
          { label:'CTR trung bình',    value:'3.8%',                                  delta:'+1.2%',color:'#14B8A6' },
          { label:'Conversion rate',   value:'4.1%',                                  delta:'+0.8%',color:'#F59E0B' },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl"
              style={{ background: k.color }} />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-tx-3 mb-2">{k.label}</p>
            <p className="text-2xl font-extrabold tracking-tight" style={{ color: k.color }}>{k.value}</p>
            <p className="text-[11px] text-emerald-light font-semibold mt-1">▲ {k.delta} so kỳ trước</p>
          </div>
        ))}
      </div>

      {/* Revenue + Platform charts */}
      <div className="grid grid-cols-3 gap-3">
        {/* Revenue area chart */}
        <div className="card col-span-2">
          <div className="panel-head">📈 Doanh thu theo ngày</div>
          <div className="panel-body">
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366F1" stopOpacity=".3"/>
                    <stop offset="95%" stopColor="#6366F1" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#6B7280' }} axisLine={false} tickLine={false}
                  tickFormatter={(v, i) => i % 5 === 0 ? v : ''} />
                <Tooltip {...CUSTOM_TOOLTIP_STYLE} formatter={(v: number) => [`${(v/1000).toFixed(0)}K đ`, 'Doanh thu']} />
                <Area type="monotone" dataKey="rev" stroke="#6366F1" strokeWidth={2}
                  fill="url(#revGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Network pie */}
        <div className="card">
          <div className="panel-head">🌐 Doanh thu theo Network</div>
          <div className="panel-body flex flex-col items-center">
            <ResponsiveContainer width="100%" height={100}>
              <PieChart>
                <Pie data={NETWORK_PIE} cx="50%" cy="50%" innerRadius={28} outerRadius={45}
                  dataKey="value" paddingAngle={3}>
                  {NETWORK_PIE.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip {...CUSTOM_TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'Tỷ lệ']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1 w-full mt-1">
              {NETWORK_PIE.map(n => (
                <div key={n.name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: n.color }} />
                  <span className="text-[11px] text-tx-2 flex-1">{n.name}</span>
                  <span className="text-[11px] font-bold" style={{ color: n.color }}>{n.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Platform CTR + Content Performance */}
      <div className="grid grid-cols-2 gap-3">
        {/* Platform CTR bar */}
        <div className="card">
          <div className="panel-head">📡 CTR theo Platform</div>
          <div className="panel-body">
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={PLATFORM_DATA} layout="vertical" barSize={12}>
                <XAxis type="number" tick={{ fontSize: 9, fill: '#6B7280' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  axisLine={false} tickLine={false} width={72} />
                <Tooltip {...CUSTOM_TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'CTR']} />
                <Bar dataKey="ctr" radius={[0,4,4,0]}>
                  {PLATFORM_DATA.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Content type performance */}
        <div className="card">
          <div className="panel-head">📝 Hiệu suất theo loại Content</div>
          <div className="panel-body space-y-3">
            {CONTENT_PERF.map(c => (
              <div key={c.type}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium text-tx-2">{c.type}</span>
                  <div className="flex gap-3 text-[11px]">
                    <span className="text-tx-3">{c.count} bài</span>
                    <span style={{ color: c.color }} className="font-bold">CTR {c.avg_ctr}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-bg-4 rounded overflow-hidden">
                  <div className="h-full rounded transition-all duration-700"
                    style={{ width: `${c.avg_ctr / 7 * 100}%`, background: c.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Recommendations */}
      <div className="card">
        <div className="panel-head">
          🤖 Đề xuất từ AI Agent
          <span className="badge badge-blue ml-2">4 hành động</span>
          <span className="ml-auto text-[11px] text-tx-4">Dựa trên 30 ngày data của bạn</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {AI_RECS.map(r => (
            <div key={r.priority}
              className="bg-bg-3 border border-bdr-2 rounded-xl p-4 hover:border-bdr-3 transition-all cursor-pointer group"
              onClick={() => { setAgentDrawer(true); toast.success(`🤖 Áp dụng: ${r.title}`); }}>
              <div className="flex items-start gap-3">
                <div className="text-2xl flex-shrink-0">{r.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-bold text-tx-1 leading-tight">{r.title}</p>
                    <span className="text-[9px] text-tx-4 flex-shrink-0">#{r.priority}</span>
                  </div>
                  <p className="text-[11px] text-tx-3 leading-relaxed mb-2">{r.detail}</p>
                  <div className="flex items-center gap-2">
                    <span className={clsx('badge text-[9px]', r.badge)}>{r.impact}</span>
                    <span className="text-[10px] text-tx-4">Nỗ lực: {r.effort}</span>
                    <button className="ml-auto text-[11px] text-brand group-hover:text-brand-light transition-colors">
                      Áp dụng →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
