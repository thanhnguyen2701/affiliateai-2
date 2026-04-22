'use client';
// apps/web/src/app/dashboard/settings/page.tsx

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase/client';
import { useUserStore, useProfileStore } from '@/lib/store';
import { profileAPI } from '@/lib/api';

const NICHES     = ['beauty','fashion','tech','food','home','health','finance','education','travel','other'];
const NICHE_LABELS: Record<string,string> = {
  beauty:'💄 Beauty', fashion:'👗 Fashion', tech:'💻 Tech', food:'🍜 Food',
  home:'🏠 Home', health:'💪 Health', finance:'💰 Finance', education:'📚 Education',
  travel:'✈️ Travel', other:'🌐 Khác',
};
const TONES = [
  { v:'friendly',     l:'😊 Thân thiện',     d:'Gần gũi, như bạn bè' },
  { v:'professional', l:'💼 Chuyên nghiệp',  d:'Nghiêm túc, đáng tin' },
  { v:'funny',        l:'😂 Hài hước',        d:'Vui vẻ, dí dỏm' },
  { v:'inspiring',    l:'🌟 Truyền cảm hứng', d:'Động lực, tích cực' },
];
const LANGUAGES = [
  { v:'neutral', l:'🗺 Trung lập' },
  { v:'bắc',    l:'🏙 Miền Bắc' },
  { v:'nam',    l:'🌊 Miền Nam' },
  { v:'trung',  l:'🏔 Miền Trung' },
];
const NETWORKS = [
  { v:'shopee',      l:'🛍 Shopee Affiliate' },
  { v:'accesstrade', l:'🔗 Accesstrade' },
  { v:'tiktok',      l:'🎬 TikTok Shop' },
  { v:'lazada',      l:'📦 Lazada Affiliate' },
  { v:'rentracks',   l:'📊 Rentracks' },
];
const AUTOPILOT_JOBS = [
  { v:'morning_scan',    l:'🌅 Morning Trend Scan (6:00 AM)',    d:'Quét trend, gợi ý content mỗi sáng' },
  { v:'content_autopilot', l:'📝 Content Autopilot (7:00 AM)',  d:'Tự tạo draft, chờ approve' },
  { v:'engagement',      l:'💬 Engagement Monitor (7:30 PM)',    d:'Kiểm tra inbox, reply tự động' },
  { v:'weekly_report',   l:'📊 Weekly Report (Thứ 2)',           d:'Báo cáo + đề xuất chiến lược' },
  { v:'offer_refresh',   l:'🎯 Offer Refresh (Thứ 6)',           d:'Tìm offer EPC cao hơn' },
];
const BRAND_COLORS = [
  '#6366F1','#0D9488','#EC4899','#F59E0B','#10B981','#3B82F6','#8B5CF6','#EF4444','#F97316','#06B6D4',
];

interface Settings {
  niche_primary: string;
  preferred_tone: string;
  language_style: string;
  active_networks: string[];
  full_autopilot: boolean;
  autopilot_jobs: string[];
  primary_color: string;
}

const DEFAULT: Settings = {
  niche_primary: 'beauty', preferred_tone: 'friendly', language_style: 'neutral',
  active_networks: ['shopee','accesstrade'], full_autopilot: false,
  autopilot_jobs: ['morning_scan','weekly_report'], primary_color: '#6366F1',
};

export default function SettingsPage() {
  const { setUser } = useUserStore();
  const { setProfile } = useProfileStore();
  const [s, setS]     = useState<Settings>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'profile'|'brand'|'autopilot'|'networks'>('profile');

  useEffect(() => {
    async function load() {
      try {
        const data = await profileAPI.get() as any;
        if (data?.profile) {
          setS(prev => ({
            ...prev,
            niche_primary:   data.profile.niche_primary   ?? prev.niche_primary,
            preferred_tone:  data.profile.preferred_tone  ?? prev.preferred_tone,
            language_style:  data.profile.language_style  ?? prev.language_style,
            active_networks: data.profile.active_networks ?? prev.active_networks,
          }));
        }
        if (data?.user) setUser({ fullAutopilot: data.user.full_autopilot });
        if (data?.brand_kit) setS(prev => ({ ...prev, primary_color: data.brand_kit.primary_color ?? prev.primary_color }));
      } catch { /* use defaults */ }
    }
    load();
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS(p => ({ ...p, [k]: v }));

  function toggleNetwork(n: string) {
    set('active_networks', s.active_networks.includes(n)
      ? s.active_networks.filter(x => x !== n)
      : [...s.active_networks, n]);
  }
  function toggleJob(j: string) {
    set('autopilot_jobs', s.autopilot_jobs.includes(j)
      ? s.autopilot_jobs.filter(x => x !== j)
      : [...s.autopilot_jobs, j]);
  }

  async function save() {
    setSaving(true);
    try {
      await profileAPI.update({
        niche_primary:   s.niche_primary,
        preferred_tone:  s.preferred_tone,
        language_style:  s.language_style,
        active_networks: s.active_networks,
        full_autopilot:  s.full_autopilot,
      });
      setProfile({ niche_primary: s.niche_primary } as any);
      toast.success('✅ Đã lưu cài đặt! AI sẽ áp dụng ngay từ lần tiếp theo.');
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  }

  const TABS = [
    { id:'profile',   l:'🎯 Niche & Tone' },
    { id:'networks',  l:'🌐 Networks' },
    { id:'autopilot', l:'🤖 Auto-pilot' },
    { id:'brand',     l:'🎨 Brand Kit' },
  ] as const;

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-base font-bold">⚙️ Cài đặt AI</h1>
          <p className="text-xs text-tx-3 mt-0.5">Tùy chỉnh để AI hiểu bạn hơn</p>
        </div>
        <button onClick={save} disabled={saving} className="btn btn-primary gap-1.5">
          {saving ? <><svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Lưu...</> : '💾 Lưu cài đặt'}
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 bg-bg-2 border border-bdr-1 rounded-xl p-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex-1 py-2 rounded-lg text-xs font-semibold transition-all',
              tab === t.id ? 'bg-bg-4 text-tx-1' : 'text-tx-3 hover:text-tx-2')}>
            {t.l}
          </button>
        ))}
      </div>

      {/* Tab: Profile */}
      {tab === 'profile' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className="card p-4">
              <p className="text-xs font-bold text-tx-2 mb-3">Niche chính</p>
              <div className="grid grid-cols-2 gap-2">
                {NICHES.map(n => (
                  <button key={n} onClick={() => set('niche_primary', n)}
                    className={clsx('py-2 px-3 rounded-lg border text-xs font-medium text-left transition-all',
                      s.niche_primary === n ? 'border-brand/40 bg-brand/8 text-brand-lighter' : 'border-bdr-2 bg-bg-3 text-tx-2 hover:border-bdr-3')}>
                    {NICHE_LABELS[n]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-4">
              <p className="text-xs font-bold text-tx-2 mb-3">Tone giọng văn</p>
              <div className="space-y-2">
                {TONES.map(t => (
                  <button key={t.v} onClick={() => set('preferred_tone', t.v)}
                    className={clsx('w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all',
                      s.preferred_tone === t.v ? 'border-brand/40 bg-brand/8' : 'border-bdr-2 bg-bg-3 hover:border-bdr-3')}>
                    <span className={clsx('text-xs font-semibold', s.preferred_tone === t.v ? 'text-brand-lighter' : 'text-tx-2')}>{t.l}</span>
                    <span className="text-[11px] text-tx-4">{t.d}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <p className="text-xs font-bold text-tx-2 mb-3">Giọng vùng miền</p>
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGES.map(l => (
                  <button key={l.v} onClick={() => set('language_style', l.v)}
                    className={clsx('py-2 px-3 rounded-lg border text-xs font-medium transition-all',
                      s.language_style === l.v ? 'border-brand/40 bg-brand/8 text-brand-lighter' : 'border-bdr-2 bg-bg-3 text-tx-2 hover:border-bdr-3')}>
                    {l.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Networks */}
      {tab === 'networks' && (
        <div className="card p-4">
          <p className="text-xs font-bold text-tx-2 mb-1">Affiliate Networks đang dùng</p>
          <p className="text-[11px] text-tx-4 mb-4">AI sẽ tìm offer và tạo link từ các network bạn chọn</p>
          <div className="space-y-2">
            {NETWORKS.map(n => {
              const active = s.active_networks.includes(n.v);
              return (
                <div key={n.v} onClick={() => toggleNetwork(n.v)}
                  className={clsx('flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                    active ? 'border-brand/30 bg-brand/5' : 'border-bdr-2 bg-bg-3 hover:border-bdr-3')}>
                  <span className="text-base">{n.l.split(' ')[0]}</span>
                  <span className={clsx('text-xs font-medium flex-1', active ? 'text-tx-1' : 'text-tx-3')}>
                    {n.l.split(' ').slice(1).join(' ')}
                  </span>
                  <div className={clsx('w-10 h-5 rounded-full relative transition-all',
                    active ? 'bg-brand' : 'bg-bg-5')}>
                    <div className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                      active ? 'left-5' : 'left-0.5')} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-tx-4 mt-3">
            💡 Cần API key từng network để AI tự động tạo link. Xem hướng dẫn trong docs.
          </p>
        </div>
      )}

      {/* Tab: Autopilot */}
      {tab === 'autopilot' && (
        <div className="space-y-3">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-bold">Full Auto-pilot</p>
                <p className="text-[11px] text-tx-4">AI đăng bài không cần approve</p>
              </div>
              <div onClick={() => set('full_autopilot', !s.full_autopilot)}
                className={clsx('w-12 h-6 rounded-full relative cursor-pointer transition-all',
                  s.full_autopilot ? 'bg-emerald-DEFAULT' : 'bg-bg-5')}>
                <div className={clsx('absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                  s.full_autopilot ? 'left-7' : 'left-1')} />
              </div>
            </div>
            {s.full_autopilot && (
              <div className="bg-amber/10 border border-amber/20 rounded-xl p-3 text-[11px] text-amber-light">
                ⚠️ Full auto-pilot bật — AI sẽ tự đăng mà không hỏi bạn. Hãy chắc chắn brand kit và style đã cài đúng.
              </div>
            )}
          </div>

          <div className="card p-4">
            <p className="text-xs font-bold text-tx-2 mb-3">Chọn job tự động chạy</p>
            <div className="space-y-2">
              {AUTOPILOT_JOBS.map(j => {
                const on = s.autopilot_jobs.includes(j.v);
                return (
                  <div key={j.v} onClick={() => toggleJob(j.v)}
                    className={clsx('flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                      on ? 'border-emerald-DEFAULT/30 bg-emerald-DEFAULT/5' : 'border-bdr-2 bg-bg-3 hover:border-bdr-3')}>
                    <div className="flex-1">
                      <p className={clsx('text-xs font-medium', on ? 'text-tx-1' : 'text-tx-3')}>{j.l}</p>
                      <p className="text-[10px] text-tx-4">{j.d}</p>
                    </div>
                    <div className={clsx('w-10 h-5 rounded-full relative transition-all', on ? 'bg-emerald-DEFAULT' : 'bg-bg-5')}>
                      <div className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', on ? 'left-5' : 'left-0.5')} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Brand Kit */}
      {tab === 'brand' && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-4 space-y-4">
            <p className="text-xs font-bold text-tx-2">Màu thương hiệu</p>
            <div className="grid grid-cols-5 gap-2">
              {BRAND_COLORS.map(c => (
                <div key={c} onClick={() => set('primary_color', c)}
                  className={clsx('w-full aspect-square rounded-lg cursor-pointer transition-all hover:scale-110',
                    s.primary_color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-bg-2' : '')}
                  style={{ background: c }} />
              ))}
            </div>
            <div>
              <label className="label">Màu custom (HEX)</label>
              <div className="flex gap-2">
                <div className="w-9 h-9 rounded-lg border border-bdr-2" style={{ background: s.primary_color }} />
                <input className="input flex-1" value={s.primary_color}
                  onChange={e => set('primary_color', e.target.value)}
                  placeholder="#6366F1" />
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <p className="text-xs font-bold text-tx-2">Logo thương hiệu</p>
            <div className="border-2 border-dashed border-bdr-2 rounded-xl p-6 text-center hover:border-brand/50 cursor-pointer transition-all"
              onClick={() => toast('📸 Upload logo — tính năng sẽ có ở v2.1')}>
              <div className="text-2xl mb-2">🖼</div>
              <p className="text-xs text-tx-3">Upload logo (PNG, SVG)</p>
              <p className="text-[10px] text-tx-4">Sẽ được watermark vào mọi ảnh AI tạo</p>
            </div>
            <div>
              <label className="label">Vị trí watermark</label>
              <select className="select text-xs">
                <option>Góc dưới phải</option>
                <option>Góc dưới trái</option>
                <option>Góc trên phải</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
