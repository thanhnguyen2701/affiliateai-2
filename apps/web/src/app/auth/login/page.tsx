'use client';
// apps/web/src/app/auth/login/page.tsx

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { useUserStore } from '@/lib/store';

export default function LoginPage() {
  const router   = useRouter();
  const setUser  = useUserStore(s => s.setUser);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) throw error;
      if (!data.user) throw new Error('Đăng nhập thất bại');

      setUser({ userId: data.user.id, email: data.user.email ?? '' });
      toast.success('Đăng nhập thành công!');
      router.push('/dashboard');
    } catch (err) {
      toast.error((err as Error).message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-0 bg-mesh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl
                          bg-gradient-to-br from-brand to-teal mb-4">
            <span className="text-2xl">🤖</span>
          </div>
          <h1 className="text-xl font-bold">AffiliateAI</h1>
          <p className="text-tx-3 text-xs mt-1">Trợ lý affiliate thông minh của bạn</p>
        </div>

        {/* Card */}
        <div className="card p-6 animate-slide-up">
          <h2 className="text-base font-bold mb-1">Đăng nhập</h2>
          <p className="text-tx-3 text-xs mb-5">Chào mừng trở lại!</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="form-group">
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Mật khẩu</label>
                <Link href="/auth/forgot-password"
                  className="text-[11px] text-brand hover:text-brand-light transition-colors">
                  Quên mật khẩu?
                </Link>
              </div>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-lg w-full justify-center mt-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/>
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Đang đăng nhập...
                </>
              ) : 'Đăng nhập →'}
            </button>
          </form>

          <div className="divider my-4" />

          <p className="text-center text-tx-3 text-xs">
            Chưa có tài khoản?{' '}
            <Link href="/auth/register" className="text-brand hover:text-brand-light font-medium transition-colors">
              Đăng ký miễn phí
            </Link>
          </p>
        </div>

        {/* Demo hint */}
        <div className="mt-4 p-3 bg-bg-2 border border-bdr-1 rounded-xl text-center">
          <p className="text-tx-3 text-[11px]">
            Demo: <span className="text-tx-2 font-mono">demo@affiliateai.vn</span>{' / '}
            <span className="text-tx-2 font-mono">demo123456</span>
          </p>
        </div>
      </div>
    </div>
  );
}
