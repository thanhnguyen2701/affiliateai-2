'use client';
// apps/web/src/app/auth/register/page.tsx

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';

const NICHES = [
  { value: 'beauty',   label: '💄 Beauty & Skincare' },
  { value: 'fashion',  label: '👗 Fashion & Thời trang' },
  { value: 'tech',     label: '💻 Tech & Gadgets' },
  { value: 'food',     label: '🍜 Food & Đồ ăn' },
  { value: 'home',     label: '🏠 Home & Nội thất' },
  { value: 'health',   label: '💪 Health & Fitness' },
  { value: 'finance',  label: '💰 Finance & Investment' },
  { value: 'other',    label: '🌐 Khác' },
];

type Step = 'account' | 'niche' | 'done';

export default function RegisterPage() {
  const router = useRouter();
  const [step,     setStep]     = useState<Step>('account');
  const [loading,  setLoading]  = useState(false);
  const [form, setForm] = useState({
    email: '', password: '', confirmPassword: '',
    niche: '', tone: 'friendly',
  });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Mật khẩu không khớp'); return;
    }
    if (form.password.length < 8) {
      toast.error('Mật khẩu tối thiểu 8 ký tự'); return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email: form.email, password: form.password,
        options: { data: { niche: form.niche, tone: form.tone } },
      });
      if (error) throw error;
      setStep('done');
    } catch (err) {
      toast.error((err as Error).message);
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-bg-0 bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl
                          bg-gradient-to-br from-brand to-teal mb-3">
            <span className="text-xl">🤖</span>
          </div>
          <h1 className="text-lg font-bold">AffiliateAI</h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6 justify-center">
          {(['account','niche'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
                ${step === s || (step === 'done' && i === 1)
                  ? 'bg-brand text-white'
                  : step === 'done' || (step === 'niche' && i === 0)
                    ? 'bg-emerald-light text-white'
                    : 'bg-bg-4 text-tx-3'}`}>
                {(step === 'done' || (step === 'niche' && i === 0)) ? '✓' : i + 1}
              </div>
              {i === 0 && <div className="w-8 h-px bg-bdr-2" />}
            </div>
          ))}
        </div>

        <div className="card p-6 animate-slide-up">

          {/* STEP 1: Account */}
          {step === 'account' && (
            <>
              <h2 className="text-base font-bold mb-1">Tạo tài khoản</h2>
              <p className="text-tx-3 text-xs mb-5">Miễn phí — 10 credits ngay khi đăng ký</p>
              <form onSubmit={(e) => { e.preventDefault(); if(form.email&&form.password&&form.password===form.confirmPassword) setStep('niche'); else if(form.password!==form.confirmPassword) toast.error('Mật khẩu không khớp'); }} className="space-y-3">
                <div className="form-group">
                  <label className="label">Email</label>
                  <input type="email" className="input" placeholder="your@email.com"
                    value={form.email} onChange={e => set('email', e.target.value)} required autoFocus/>
                </div>
                <div className="form-group">
                  <label className="label">Mật khẩu</label>
                  <input type="password" className="input" placeholder="Tối thiểu 8 ký tự"
                    value={form.password} onChange={e => set('password', e.target.value)} required/>
                </div>
                <div className="form-group">
                  <label className="label">Xác nhận mật khẩu</label>
                  <input type="password" className="input" placeholder="Nhập lại mật khẩu"
                    value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} required/>
                </div>
                <button type="submit" className="btn btn-primary btn-lg w-full justify-center mt-2">
                  Tiếp theo →
                </button>
              </form>
            </>
          )}

          {/* STEP 2: Niche */}
          {step === 'niche' && (
            <>
              <h2 className="text-base font-bold mb-1">Bạn làm niche gì?</h2>
              <p className="text-tx-3 text-xs mb-4">AI sẽ tối ưu content theo niche của bạn</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {NICHES.map(n => (
                  <button key={n.value}
                    onClick={() => set('niche', n.value)}
                    className={`p-2.5 rounded-lg border text-xs font-medium text-left transition-all
                      ${form.niche === n.value
                        ? 'border-brand bg-brand/10 text-brand-lighter'
                        : 'border-bdr-2 bg-bg-3 text-tx-2 hover:border-bdr-3'}`}>
                    {n.label}
                  </button>
                ))}
              </div>
              <div className="form-group mb-4">
                <label className="label">Tone giọng văn</label>
                <select className="select" value={form.tone} onChange={e => set('tone', e.target.value)}>
                  <option value="friendly">😊 Thân thiện & Gần gũi</option>
                  <option value="professional">💼 Chuyên nghiệp</option>
                  <option value="funny">😂 Hài hước & Vui vẻ</option>
                  <option value="inspiring">🌟 Truyền cảm hứng</option>
                </select>
              </div>
              <form onSubmit={handleRegister}>
                <button type="submit" disabled={loading || !form.niche}
                  className="btn btn-primary btn-lg w-full justify-center">
                  {loading ? (
                    <>
                      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/>
                        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                      </svg>
                      Đang tạo tài khoản...
                    </>
                  ) : '🚀 Bắt đầu ngay'}
                </button>
              </form>
            </>
          )}

          {/* STEP 3: Done */}
          {step === 'done' && (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">🎉</div>
              <h2 className="text-base font-bold mb-2">Tài khoản đã tạo!</h2>
              <p className="text-tx-3 text-xs mb-1">
                Kiểm tra email <span className="text-tx-1 font-medium">{form.email}</span> để xác nhận.
              </p>
              <p className="text-tx-4 text-[11px] mb-5">
                (Có thể vào thẳng dashboard nếu không cần xác nhận email trong môi trường dev)
              </p>
              <button onClick={() => router.push('/dashboard')}
                className="btn btn-primary btn-lg w-full justify-center">
                Vào Dashboard →
              </button>
            </div>
          )}
        </div>

        {step !== 'done' && (
          <p className="text-center text-tx-3 text-xs mt-4">
            Đã có tài khoản?{' '}
            <Link href="/auth/login" className="text-brand hover:text-brand-light font-medium">
              Đăng nhập
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
