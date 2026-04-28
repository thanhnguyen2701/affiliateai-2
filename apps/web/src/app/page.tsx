// apps/web/src/app/page.tsx — Public landing page

import clsx from 'clsx';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-0" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── NAV ──────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-bg-0/80 backdrop-blur-xl border-b border-bdr-1">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 font-bold text-sm">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-teal flex items-center justify-center">🤖</div>
            AffiliateAI
          </div>
          <div className="flex-1" />
          <Link href="#features" className="text-xs text-tx-3 hover:text-tx-1 transition-colors">Tính năng</Link>
          <Link href="#pricing"  className="text-xs text-tx-3 hover:text-tx-1 transition-colors">Bảng giá</Link>
          <Link href="/auth/login"
            className="px-3 py-1.5 rounded-lg border border-bdr-2 text-xs font-medium text-tx-2 hover:bg-bg-3 transition-colors">
            Đăng nhập
          </Link>
          <Link href="/auth/register"
            className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-light transition-colors">
            Dùng miễn phí →
          </Link>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="pt-32 pb-20 px-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh pointer-events-none" />
        <div className="absolute top-20 left-1/4 w-64 h-64 bg-brand/5 rounded-full blur-3xl" />
        <div className="absolute top-32 right-1/4 w-48 h-48 bg-teal/5 rounded-full blur-3xl" />

        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand/10 border border-brand/20 rounded-full text-xs text-brand-lighter mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-light animate-pulse" />
            AI Agent thế hệ mới cho affiliate Việt Nam
          </div>

          <h1 className="text-4xl font-extrabold leading-tight mb-4 tracking-tight">
            Trợ lý affiliate
            <br />
            <span className="text-gradient">chạy tự động 24/7</span>
          </h1>

          <p className="text-sm text-tx-3 leading-relaxed mb-8 max-w-xl mx-auto">
            AI Agent tự động tạo content, tìm trend, tạo ảnh/video, phân tích hiệu suất và chăm sóc khách hàng.
            Bạn chỉ cần approve — AI làm phần còn lại.
          </p>

          <div className="flex items-center gap-3 justify-center flex-wrap">
            <Link href="/auth/register"
              className="px-6 py-3 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand-light transition-all hover:-translate-y-0.5 hover:shadow-lg">
              Bắt đầu miễn phí — 10 credits
            </Link>
            <Link href="/auth/login"
              className="px-6 py-3 bg-bg-2 border border-bdr-2 text-tx-2 rounded-xl font-medium text-sm hover:bg-bg-3 transition-all">
              Xem demo →
            </Link>
          </div>

          <p className="text-[11px] text-tx-4 mt-4">
            Không cần thẻ tín dụng · Miễn phí 10 credits · Nâng cấp bất kỳ lúc nào
          </p>
        </div>

        {/* ── Dashboard preview mockup ── */}
        <div className="mt-16 max-w-4xl mx-auto relative">
          <div className="bg-bg-1 border border-bdr-2 rounded-2xl overflow-hidden shadow-2xl">
            {/* Fake topbar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-bdr-1 bg-bg-2">
              <div className="flex gap-1.5">
                {['#EF4444','#F59E0B','#10B981'].map(c => (
                  <div key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />
                ))}
              </div>
              <div className="flex-1 mx-4 h-5 bg-bg-3 rounded-md" />
              <div className="w-20 h-5 bg-brand/20 rounded-md" />
            </div>
            {/* Fake dashboard content */}
            <div className="p-4 grid grid-cols-4 gap-3">
              {[
                { v:'4.2M đ', l:'Doanh thu', c:'#818CF8' },
                { v:'87',     l:'Content AI', c:'#14B8A6' },
                { v:'3.8%',   l:'CTR TB',    c:'#10B981' },
                { v:'4.1%',   l:'Conversion', c:'#F59E0B' },
              ].map(m => (
                <div key={m.l} className="bg-bg-3 rounded-xl p-3">
                  <div className="text-[10px] text-tx-4 mb-1">{m.l}</div>
                  <div className="text-lg font-extrabold" style={{ color: m.c }}>{m.v}</div>
                </div>
              ))}
            </div>
            <div className="p-4 pt-0 grid grid-cols-3 gap-3">
              <div className="col-span-2 bg-bg-3 rounded-xl h-32 flex items-center justify-center">
                <div className="flex items-end gap-1 h-20 px-4">
                  {[40,60,45,80,70,90,85].map((h,i) => (
                    <div key={i} className="flex-1 rounded-t-sm transition-all"
                      style={{ height: `${h}%`, background: i >= 5 ? '#6366F1' : '#252D40' }} />
                  ))}
                </div>
              </div>
              <div className="bg-bg-3 rounded-xl h-32 p-3 space-y-2">
                {['🔥 Kem chống nắng +96','⭐ Serum Vitamin C +88','💊 Niacinamide +74'].map(t => (
                  <div key={t} className="text-[10px] text-tx-3 py-1 border-b border-bdr-1">{t}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-tx-4">
            ↑ Dashboard thực tế của AffiliateAI
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ─────────────────────────────────────────── */}
      <section className="py-12 px-6 border-y border-bdr-1">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-4 gap-6 text-center">
            {[
              { v:'10,000+', l:'Affiliate đang dùng' },
              { v:'2.5M+',   l:'Content đã tạo' },
              { v:'+28%',    l:'Tăng conversion TB' },
              { v:'6h→5min', l:'Thời gian tạo content' },
            ].map(s => (
              <div key={s.l}>
                <div className="text-2xl font-extrabold text-gradient mb-1">{s.v}</div>
                <div className="text-xs text-tx-4">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-extrabold mb-3">Mọi thứ bạn cần để scale affiliate</h2>
            <p className="text-sm text-tx-3">5 AI Agent làm việc cùng nhau 24/7</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[
              { icon:'✍',  title:'Content Generator',   desc:'Tạo script TikTok, caption Facebook, bài review blog, email campaign — đa kênh trong 3 phút', badge:'7 loại content', color:'#818CF8' },
              { icon:'🔥', title:'Trend Scanner',         desc:'Quét Shopee, TikTok, Google Trends mỗi sáng. Biết trước sản phẩm nào sắp viral.', badge:'Realtime', color:'#F59E0B' },
              { icon:'🎯', title:'Offer Matching AI',     desc:'So sánh EPC, hoa hồng, rating từ 5 network lớn. Gợi ý offer phù hợp nhất với bạn.', badge:'5 networks', color:'#10B981' },
              { icon:'🎨', title:'Visual AI',             desc:'Paste link Shopee — AI crawl ảnh, xóa nền, tạo background lifestyle và export 6 format.', badge:'Pipeline A/B/C', color:'#14B8A6' },
              { icon:'📊', title:'Performance Analyst',  desc:'Phân tích CTR, conversion, doanh thu. Đề xuất hành động cụ thể để tăng thu nhập.', badge:'AI Insights', color:'#EC4899' },
              { icon:'💬', title:'Customer Engagement',  desc:'Tự động trả lời inbox, comment. Không bỏ lỡ đơn hàng dù bạn đang ngủ.', badge:'24/7 Auto', color:'#6366F1' },
            ].map(f => (
              <div key={f.title}
                className="card p-5 hover:border-bdr-2 hover:-translate-y-1 transition-all duration-200 cursor-default">
                <div className="text-2xl mb-3">{f.icon}</div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-sm font-bold">{f.title}</h3>
                  <span className="badge text-[9px] px-1.5" style={{ background: f.color + '20', color: f.color }}>
                    {f.badge}
                  </span>
                </div>
                <p className="text-[11px] text-tx-3 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 px-6 bg-bg-1">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-extrabold mb-2">Giá đơn giản, minh bạch</h2>
            <p className="text-sm text-tx-3">Bắt đầu miễn phí, nâng cấp khi cần</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { name:'Miễn phí', price:'0đ', credits:'10 credits', color:'#9CA3AF', features:['Content Generator cơ bản','Trend Scanner','10 lần dùng/tháng'], cta:'Bắt đầu miễn phí', href:'/auth/register' },
              { name:'Pro', price:'399K/tháng', credits:'500 credits', color:'#6366F1', popular:true, features:['Tất cả tính năng','Agentic Loop 24/7','Visual AI đầy đủ','Voice AI','Không giới hạn kênh'], cta:'Dùng thử Pro', href:'/auth/register?plan=pro' },
              { name:'Business', price:'999K/tháng', credits:'Không giới hạn', color:'#F59E0B', features:['Tất cả Pro','White-label','Team 5 người','API access','Dedicated support'], cta:'Liên hệ tư vấn', href:'/auth/register?plan=business' },
            ].map(p => (
              <div key={p.name}
                className={clsx('card p-5 relative',
                  p.popular && 'border-brand/50 shadow-[0_0_0_1px_rgba(99,102,241,.2)]')}>
                {p.popular && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-brand to-teal rounded-t-xl" />}
                <h3 className="text-sm font-bold mb-0.5" style={{ color: p.color }}>{p.name}</h3>
                <div className="text-xl font-extrabold mb-0.5">{p.price}</div>
                <p className="text-[11px] text-tx-4 mb-4">{p.credits}</p>
                <div className="space-y-1.5 mb-5">
                  {p.features.map(f => (
                    <div key={f} className="flex items-center gap-1.5">
                      <span className="text-emerald-light text-[11px]">✓</span>
                      <span className="text-[11px] text-tx-2">{f}</span>
                    </div>
                  ))}
                </div>
                <Link href={p.href}
                  className={clsx('block text-center py-2 rounded-xl text-xs font-bold transition-all',
                    p.popular ? 'bg-brand text-white hover:bg-brand-light' : 'bg-bg-3 border border-bdr-2 text-tx-2 hover:bg-bg-4')}>
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="py-20 px-6 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl font-extrabold mb-3">Sẵn sàng tự động hóa affiliate?</h2>
          <p className="text-sm text-tx-3 mb-6">Bắt đầu với 10 credits miễn phí. Không cần thẻ tín dụng.</p>
          <Link href="/auth/register"
            className="inline-flex items-center gap-2 px-8 py-4 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand-light transition-all hover:-translate-y-0.5">
            🚀 Bắt đầu ngay — Miễn phí
          </Link>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="border-t border-bdr-1 py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-brand to-teal flex items-center justify-center text-xs">🤖</div>
            AffiliateAI
          </div>
          <div className="flex gap-6 text-xs text-tx-4">
            <span>Powered by CakeAI.vn</span>
            <span>© 2026 AffiliateAI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
