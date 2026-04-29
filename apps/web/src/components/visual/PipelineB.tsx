'use client';
// apps/web/src/components/visual/PipelineB.tsx

import { useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { visualAPI } from '@/lib/api';
import type { VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  platforms:    string[];
  brandKit:     Record<string, unknown> | null;
  onJobCreated: (j: VisualJob) => void;
}

// Simple product preview (from URL meta extraction)
interface ProductPreview {
  name:     string;
  image:    string;
  price:    string;
  rating:   string;
  sold:     string;
  discount: string;
}

// Detect platform from URL
function detectPlatform(url: string): string {
  if (url.includes('shopee')) return 'Shopee';
  if (url.includes('lazada') || url.includes('lzd.co')) return 'Lazada';
  return 'Unknown';
}

// Validate affiliate URL
function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ['shopee.vn','shp.ee','lazada.vn','lzd.co'].some(d => u.hostname.includes(d));
  } catch { return false; }
}

export default function PipelineB({ platforms, brandKit, onJobCreated }: Props) {
  const [url,       setUrl]       = useState('');
  const [loading,   setLoading]   = useState(false);
  const [preview,   setPreview]   = useState<ProductPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [style,     setStyle]     = useState<'lifestyle'|'minimal'|'bold'>('lifestyle');

  async function loadPreview(inputUrl: string) {
    if (!isValidUrl(inputUrl)) return;
    setLoadingPreview(true);
    try {
      // In production: call backend to scrape product info
      // For now: show demo preview
      await new Promise(r => setTimeout(r, 800));
      setPreview({
        name:     'Kem dưỡng da Innisfree Green Tea Seed Serum 80ml',
        image:    'https://via.placeholder.com/80x80/1E2535/818CF8?text=Product',
        price:    '185.000đ',
        rating:   '4.9',
        sold:     '50,213',
        discount: '35',
      });
    } catch {
      // ignore
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleCreate() {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      toast.error('URL không hợp lệ. Hỗ trợ: Shopee hoặc Lazada');
      return;
    }
    if (platforms.length === 0) {
      toast.error('Chọn ít nhất 1 platform output');
      return;
    }
    setLoading(true);
    try {
      const result = await visualAPI.createFromUrl(trimmed, platforms, 'B');
      const job: VisualJob = {
        id: result.job_id,
        pipeline: 'B',
        status: 'queued',
        source_type: detectPlatform(trimmed) === 'Lazada' ? 'lazada_url' : 'shopee_url',
        source_url: trimmed,
        product_info: { preview, style },
        assets: {},
        api_cost_vnd: 0,
        created_at: new Date().toISOString(),
      };
      onJobCreated(job);
      setUrl('');
      setPreview(null);
      toast.success('⚡ Đã tạo job! AI đang xử lý...');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const platform = url ? detectPlatform(url) : null;
  const valid = isValidUrl(url);

  return (
    <div className="card p-4 space-y-4">
      <div className="text-xs font-bold text-tx-2 flex items-center gap-2">
        🛒 Paste link sản phẩm
      </div>

      {/* URL Input */}
      <div className="space-y-2">
        <div className="relative">
          <input
            type="url"
            className={clsx(
              'input pr-24 font-mono text-[12px]',
              url && (valid ? 'border-emerald-DEFAULT/50' : 'border-rose-DEFAULT/50')
            )}
            placeholder="https://shopee.vn/product/... hoặc https://lazada.vn/products/..."
            value={url}
            onChange={e => {
              setUrl(e.target.value);
              setPreview(null);
            }}
            onBlur={() => url && loadPreview(url)}
            onKeyDown={e => e.key === 'Enter' && loadPreview(url)}
          />
          {platform && valid && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 badge badge-green text-[10px]">
              {platform}
            </span>
          )}
          {url && !valid && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 badge badge-rose text-[10px]">
              URL sai
            </span>
          )}
        </div>

        {/* Quick paste examples */}
        <div className="flex gap-2 flex-wrap">
          <span className="text-[10px] text-tx-4">Ví dụ:</span>
          {[
            { label: 'Shopee product', url: 'https://shopee.vn/product/123456/987654321' },
            { label: 'Shopee short', url: 'https://shp.ee/xxxxx' },
            { label: 'Lazada product', url: 'https://www.lazada.vn/products/example-i123456789.html' },
            { label: 'Lazada short', url: 'https://lzd.co/xxxxx' },
          ].map(ex => (
            <button key={ex.label}
              onClick={() => { setUrl(ex.url); setTimeout(() => loadPreview(ex.url), 100); }}
              className="text-[10px] text-brand hover:text-brand-light underline underline-offset-2">
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product Preview Card */}
      {(loadingPreview || preview) && (
        <div className={clsx(
          'bg-bg-3 border border-bdr-2 rounded-xl p-3 transition-all',
          loadingPreview && 'animate-pulse'
        )}>
          {loadingPreview ? (
            <div className="flex gap-3">
              <div className="w-16 h-16 bg-bg-4 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-bg-4 rounded w-3/4" />
                <div className="h-3 bg-bg-4 rounded w-1/2" />
                <div className="h-3 bg-bg-4 rounded w-1/3" />
              </div>
            </div>
          ) : preview ? (
            <div className="flex gap-3">
              <div className="w-16 h-16 bg-bg-4 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center text-2xl">
                🛍
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold line-clamp-2 mb-1.5">{preview.name}</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-emerald-light">{preview.price}</span>
                  <span className="badge badge-rose text-[9px]">-{preview.discount}%</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-amber-light">⭐ {preview.rating}</span>
                  <span className="text-[10px] text-tx-4">Đã bán {preview.sold}</span>
                </div>
              </div>
              <button onClick={() => { setPreview(null); setUrl(''); }}
                className="btn btn-ghost btn-icon btn-sm self-start text-tx-4">✕</button>
            </div>
          ) : null}
        </div>
      )}

      {/* Style selector */}
      <div>
        <label className="label">Phong cách ảnh</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { v:'lifestyle' as const, label:'🌿 Lifestyle',  desc:'Background tự nhiên, sống động' },
            { v:'minimal'  as const, label:'⬜ Tối giản',    desc:'Background sạch, chuyên nghiệp' },
            { v:'bold'     as const, label:'🔥 Bold',        desc:'Màu nổi bật, bắt mắt' },
          ]).map(s => (
            <button key={s.v} onClick={() => setStyle(s.v)}
              className={clsx(
                'p-2.5 rounded-xl border text-left transition-all',
                style === s.v
                  ? 'border-brand/40 bg-brand/8'
                  : 'border-bdr-2 bg-bg-3 hover:border-bdr-3'
              )}>
              <div className={clsx('text-xs font-semibold mb-0.5',
                style === s.v ? 'text-brand-lighter' : 'text-tx-2')}>
                {s.label}
              </div>
              <div className="text-[10px] text-tx-4 leading-tight">{s.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={handleCreate}
        disabled={!valid || loading}
        className="btn btn-primary btn-lg w-full justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/>
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Đang tạo job...
          </>
        ) : (
          <>
            🎨 Tạo {platforms.length} bộ ảnh
            <span className="ml-1 text-[10px] opacity-70">~3-5 phút</span>
          </>
        )}
      </button>
    </div>
  );
}
