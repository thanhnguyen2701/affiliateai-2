'use client';
// apps/web/src/app/dashboard/upgrade/page.tsx

import { useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { paymentAPI } from '@/lib/api';
import { useUserStore } from '@/lib/store';

const PLANS = [
  {
    id:    'starter',
    name:  'Starter',
    price: 149_000,
    icon:  '⚡',
    color: '#14B8A6',
    desc:  'Lý tưởng cho affiliate cá nhân mới bắt đầu',
    credits: 100,
    features: [
      '100 credits/tháng',
      'Content Generator (TikTok, Facebook, Blog...)',
      'Social Listening & Trend Scanner',
      '50 ảnh AI/tháng (Pipeline A & B)',
      '10 video AI/tháng (Pipeline C)',
      'Offer Matching cơ bản',
      'Performance Analytics',
      'Chat AI Agent',
    ],
    missing: ['Agentic Loop 24/7', 'Voice AI', 'White-label'],
  },
  {
    id:      'pro',
    name:    'Pro',
    price:   399_000,
    icon:    '🚀',
    color:   '#6366F1',
    popular: true,
    desc:    'Dành cho affiliate chuyên nghiệp muốn scale',
    credits: 500,
    features: [
      '500 credits/tháng',
      'Tất cả tính năng Starter',
      '🤖 Agentic Loop 24/7 (7 cron jobs)',
      '200 ảnh AI/tháng + 50 video AI/tháng',
      '🎙 Voice AI (FPT AI voice)',
      'Customer Engagement Agent',
      'RAG Knowledge Base (500MB)',
      'Priority support',
    ],
    missing: ['White-label', 'Team workspace'],
  },
  {
    id:    'business',
    name:  'Business',
    price: 999_000,
    icon:  '💼',
    color: '#F59E0B',
    desc:  'Agency và doanh nghiệp cần mọi tính năng',
    credits: -1,
    features: [
      '✨ Không giới hạn credits',
      'Tất cả tính năng Pro',
      '🏷 White-label (đổi thương hiệu)',
      'Ảnh & Video AI không giới hạn',
      '👥 Team workspace (5 thành viên)',
      'API access đầy đủ',
      'Knowledge Base 2GB',
      'Dedicated support',
    ],
    missing: [],
  },
];

const FAQ = [
  { q:'Tôi có thể hủy bất kỳ lúc nào không?', a:'Có, bạn có thể hủy subscription bất kỳ lúc nào. Credits còn lại sẽ được dùng đến cuối kỳ thanh toán.' },
  { q:'Credits có chuyển sang tháng sau không?', a:'Credits reset mỗi đầu tháng và không tích lũy. Gói Business không giới hạn credits nên không có vấn đề này.' },
  { q:'Thanh toán bằng phương thức nào?', a:'ZaloPay và VNPAY. Hỗ trợ thẻ ngân hàng nội địa, ví điện tử, QR code.' },
  { q:'Có được hoàn tiền không?', a:'Hoàn tiền trong 7 ngày đầu nếu không hài lòng với dịch vụ.' },
];

export default function UpgradePage() {
  const { plan: currentPlan } = useUserStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [annual,  setAnnual]  = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  async function handleUpgrade(planId: string) {
    if (planId === currentPlan) { toast('Bạn đang dùng gói này rồi!'); return; }
    setLoading(planId);
    try {
      const result = await paymentAPI.createOrder(planId);
      window.location.href = result.order_url;
    } catch (err) {
      toast.error('Không thể tạo đơn thanh toán: ' + (err as Error).message);
    } finally { setLoading(null); }
  }

  const discount = annual ? 0.75 : 1;

  return (
    <div className="p-4 space-y-6 animate-fade-in">

      {/* Header */}
      <div className="text-center py-4">
        <h1 className="text-xl font-extrabold mb-2">
          Nâng cấp để <span className="text-gradient">mở khóa toàn bộ AI</span>
        </h1>
        <p className="text-sm text-tx-3 mb-4">
          Bắt đầu kiếm tiền hiệu quả hơn với AI affiliate tự động
        </p>

        {/* Annual toggle */}
        <div className="inline-flex items-center gap-3 bg-bg-2 border border-bdr-2 rounded-xl px-4 py-2">
          <span className={clsx('text-xs font-medium', !annual ? 'text-tx-1' : 'text-tx-3')}>Hàng tháng</span>
          <div onClick={() => setAnnual(!annual)}
            className={clsx('w-12 h-6 rounded-full relative cursor-pointer transition-all',
              annual ? 'bg-brand' : 'bg-bg-5')}>
            <div className={clsx('absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
              annual ? 'left-7' : 'left-1')} />
          </div>
          <span className={clsx('text-xs font-medium', annual ? 'text-tx-1' : 'text-tx-3')}>
            Hàng năm
          </span>
          {annual && <span className="badge badge-green text-[9px]">-25%</span>}
        </div>
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-3 gap-4">
        {PLANS.map(plan => {
          const price  = Math.round(plan.price * discount);
          const isCurrent = plan.id === currentPlan;
          const isLoading = loading === plan.id;

          return (
            <div key={plan.id}
              className={clsx(
                'card relative flex flex-col overflow-hidden transition-all duration-150',
                plan.popular
                  ? 'border-brand/50 shadow-[0_0_0_1px_rgba(99,102,241,.2),0_8px_32px_rgba(99,102,241,.15)]'
                  : 'hover:border-bdr-2'
              )}>

              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-brand to-teal" />
              )}
              {plan.popular && (
                <div className="absolute top-3 right-3">
                  <span className="badge badge-blue text-[9px]">Phổ biến nhất</span>
                </div>
              )}

              <div className="p-5 flex-1">
                {/* Plan header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{plan.icon}</span>
                  <div>
                    <h3 className="text-sm font-extrabold" style={{ color: plan.color }}>{plan.name}</h3>
                    <p className="text-[11px] text-tx-4">{plan.desc}</p>
                  </div>
                </div>

                {/* Price */}
                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold" style={{ color: plan.color }}>
                      {price.toLocaleString()}đ
                    </span>
                    <span className="text-xs text-tx-4">/tháng</span>
                  </div>
                  {annual && (
                    <p className="text-[10px] text-tx-4 line-through">
                      {plan.price.toLocaleString()}đ/tháng
                    </p>
                  )}
                  <p className="text-[11px] text-tx-3 mt-0.5">
                    {plan.credits === -1 ? '∞ Credits không giới hạn' : `${plan.credits} credits/tháng`}
                  </p>
                </div>

                {/* Features */}
                <div className="space-y-1.5 mb-4">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-start gap-2">
                      <span className="text-emerald-light text-xs mt-0.5 flex-shrink-0">✓</span>
                      <span className="text-[11px] text-tx-2 leading-tight">{f}</span>
                    </div>
                  ))}
                  {plan.missing.map(f => (
                    <div key={f} className="flex items-start gap-2 opacity-40">
                      <span className="text-tx-4 text-xs mt-0.5 flex-shrink-0">—</span>
                      <span className="text-[11px] text-tx-4 leading-tight">{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <div className="p-4 pt-0">
                <button
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={isCurrent || !!isLoading}
                  className={clsx(
                    'btn btn-lg w-full justify-center gap-2 text-xs',
                    isCurrent  ? 'btn-ghost opacity-60 cursor-default' :
                    plan.popular ? 'btn-primary' : 'btn-ghost border-2',
                  )}
                  style={!plan.popular && !isCurrent ? { borderColor: plan.color, color: plan.color } : {}}>
                  {isLoading ? (
                    <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Đang xử lý...</>
                  ) : isCurrent ? '✓ Gói hiện tại' : `Nâng lên ${plan.name}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Trust signals */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon:'🔒', t:'Thanh toán an toàn', d:'ZaloPay & VNPAY mã hóa' },
          { icon:'↩️', t:'Hoàn tiền 7 ngày',   d:'Nếu không hài lòng' },
          { icon:'⚡', t:'Kích hoạt ngay',      d:'Sau khi thanh toán' },
          { icon:'🎧', t:'Hỗ trợ tiếng Việt',  d:'9AM–9PM mỗi ngày' },
        ].map(t => (
          <div key={t.t} className="card p-3 text-center">
            <div className="text-xl mb-1">{t.icon}</div>
            <p className="text-[11px] font-semibold text-tx-2">{t.t}</p>
            <p className="text-[10px] text-tx-4">{t.d}</p>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div className="card">
        <div className="panel-head">❓ Câu hỏi thường gặp</div>
        <div className="divide-y divide-bdr-1">
          {FAQ.map((f, i) => (
            <div key={i}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-bg-3 transition-colors">
                <span className="text-xs font-medium text-tx-1">{f.q}</span>
                <span className="text-tx-3 ml-3 flex-shrink-0">{openFaq === i ? '▲' : '▽'}</span>
              </button>
              {openFaq === i && (
                <div className="px-4 pb-4 text-[11px] text-tx-3 leading-relaxed animate-fade-in">
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
