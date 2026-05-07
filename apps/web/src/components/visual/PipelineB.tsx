'use client';
// apps/web/src/components/visual/PipelineB.tsx

import { useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { visualAPI } from '@/lib/api';
import type { VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  platforms: string[];
  brandKit: Record<string, unknown> | null;
  onJobCreated: (job: VisualJob) => void;
}

function detectSourceType(url: string): 'shopee_url' | 'lazada_url' {
  const lower = url.toLowerCase();
  return lower.includes('lazada') || lower.includes('lzd.co') ? 'lazada_url' : 'shopee_url';
}

function detectPlatformLabel(url: string): string {
  return detectSourceType(url) === 'lazada_url' ? 'Lazada' : 'Shopee';
}

function isValidUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ['shopee.vn', 'shp.ee', 'lazada.vn', 'lzd.co'].some((domain) => host.includes(domain));
  } catch {
    return false;
  }
}

export default function PipelineB({ platforms, brandKit, onJobCreated }: Props) {
  void brandKit;

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    const trimmed = url.trim();

    if (!isValidUrl(trimmed)) {
      toast.error('URL không hợp lệ. Hỗ trợ Shopee và Lazada');
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
        source_type: detectSourceType(trimmed),
        source_url: trimmed,
        product_info: {
          affiliate_link: trimmed,
          requested_platforms: platforms,
        },
        assets: {},
        api_cost_vnd: 0,
        created_at: new Date().toISOString(),
      };

      onJobCreated(job);
      setUrl('');
      toast.success('Đã tạo job Pipeline B. Backend đang xử lý...');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const valid = isValidUrl(url);
  const platform = url && valid ? detectPlatformLabel(url) : null;

  return (
    <div className="card p-4 space-y-4">
      <div className="text-xs font-bold text-tx-2 flex items-center gap-2">
        Paste link sản phẩm Lazada hoặc Shopee
      </div>

      <div className="space-y-2">
        <div className="relative">
          <input
            type="url"
            className={clsx(
              'input pr-24 font-mono text-[12px]',
              url && (valid ? 'border-emerald-DEFAULT/50' : 'border-rose-DEFAULT/50'),
            )}
            placeholder="https://www.lazada.vn/... hoặc https://shopee.vn/..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          {platform && (
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

        <div className="flex gap-2 flex-wrap">
          <span className="text-[10px] text-tx-4">Ví dụ:</span>
          {[
            { label: 'Lazada product', url: 'https://www.lazada.vn/products/example-i123456789.html' },
            { label: 'Lazada short', url: 'https://lzd.co/xxxxx' },
            { label: 'Shopee product', url: 'https://shopee.vn/product/123456/987654321' },
            { label: 'Shopee short', url: 'https://shp.ee/xxxxx' },
          ].map((example) => (
            <button
              key={example.label}
              onClick={() => setUrl(example.url)}
              className="text-[10px] text-brand hover:text-brand-light underline underline-offset-2"
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-bg-3 border border-bdr-2 rounded-xl p-3">
        <p className="text-xs font-semibold text-tx-2">AI đọc link và sinh banner theo đúng sản phẩm</p>
        <p className="mt-1 text-[11px] text-tx-4 leading-relaxed">
          Backend đọc URL Lazada/Shopee, lấy tên, giá và ảnh sản phẩm, chọn ảnh nguồn tốt nhất, dùng ảnh đó làm reference để sinh visual quảng cáo,
          rồi render headline, giá, social proof và CTA bằng layout riêng cho từng platform. Carousel Instagram chỉ chạy khi backend bật
          PIPELINE_B_ENABLE_CAROUSEL=true.
        </p>
      </div>

      <button
        onClick={handleCreate}
        disabled={!valid || loading}
        className="btn btn-primary btn-lg w-full justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Đang tạo job...
          </>
        ) : (
          <>
            Tạo {platforms.length} asset
            <span className="ml-1 text-[10px] opacity-70">~1-3 phút</span>
          </>
        )}
      </button>
    </div>
  );
}
