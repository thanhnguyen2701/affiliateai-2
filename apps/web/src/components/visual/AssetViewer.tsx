'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  job: VisualJob;
  onClose: () => void;
}

const PLATFORM_CONFIG: Record<string, { label: string; icon: string; size: string }> = {
  facebook_banner: { label: 'Facebook Banner', icon: 'FB', size: '1200x628' },
  instagram_banner: { label: 'Instagram Banner', icon: 'IG', size: '1080x1080' },
  instagram_carousel: { label: 'Instagram Carousel', icon: 'IG', size: '1080x1080' },
  tiktok_banner: { label: 'TikTok Banner', icon: 'TT', size: '1080x1920' },
  youtube_banner: { label: 'YouTube Banner', icon: 'YT', size: '1280x720' },
  zalo_banner: { label: 'Zalo Banner', icon: 'ZA', size: '700x400' },
  tiktok_video: { label: 'TikTok Video', icon: 'TT', size: '1080x1920 MP4' },
  tiktok_thumbnail: { label: 'TikTok Thumbnail', icon: 'TT', size: '1080x1920' },
  subtitle_srt: { label: 'Subtitle File', icon: 'SRT', size: '.srt' },

  // Backward-compatible keys from older jobs.
  youtube_thumbnail: { label: 'YouTube Thumbnail', icon: 'YT', size: '1280x720' },
  zalo_image: { label: 'Zalo Image', icon: 'ZA', size: '700x400' },
};

function baseAssetKey(key: string): string {
  return key.replace(/_\d+$/, '');
}

function assetConfig(key: string): { label: string; icon: string; size: string } {
  return PLATFORM_CONFIG[baseAssetKey(key)] ?? { label: key.replace(/_/g, ' '), icon: 'FILE', size: 'Asset' };
}

function normalizeAssets(job: VisualJob): Record<string, string> {
  return Object.entries(job.assets).reduce((acc, [key, value]) => {
    const values = Array.isArray(value)
      ? value
      : typeof value === 'string' && key === 'instagram_carousel'
        ? value.split(',')
        : [value];

    values.forEach((item, index) => {
      if (typeof item !== 'string' || !item.trim()) return;
      acc[values.length > 1 ? `${key}_${index + 1}` : key] = item.trim();
    });

    return acc;
  }, {} as Record<string, string>);
}

function extensionFromType(key: string, url: string, contentType?: string): string {
  if (contentType?.includes('video/')) return 'mp4';
  if (contentType?.includes('text/')) return 'srt';
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (key.includes('video') || /\.mp4($|\?)/i.test(url)) return 'mp4';
  if (key.includes('subtitle') || /\.srt($|\?)/i.test(url)) return 'srt';
  if (/\.png($|\?)/i.test(url)) return 'png';
  if (/\.webp($|\?)/i.test(url)) return 'webp';
  return 'jpg';
}

function copyTextToClipboard(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default function AssetViewer({ job, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const assets = useMemo(() => normalizeAssets(job), [job]);

  useEffect(() => {
    const first = Object.keys(assets)[0] ?? null;
    setSelected((prev) => (prev && assets[prev] ? prev : first));
  }, [assets]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function copyUrl(key: string) {
    const url = assets[key];
    if (!url) return;

    setCopying(key);
    try {
      const copied = copyTextToClipboard(url);
      void copied;
      toast.success('Đã copy URL');
    } catch {
      toast.error('Không thể copy URL');
    } finally {
      setTimeout(() => setCopying(null), 1500);
    }
  }

  function shareToFacebook(key: string) {
    const url = assets[key];
    if (!url) return;

    const cfg = assetConfig(key);
    const productName =
      stringValue(job.product_info?.title)
      || stringValue(job.product_info?.name)
      || stringValue(job.product_info?.product_name);
    const caption = [
      productName || cfg.label,
      url,
    ].filter(Boolean).join('\n');

    const copied = copyTextToClipboard(caption);
    const params = new URLSearchParams({ u: url });
    const popup = window.open(
      `https://www.facebook.com/sharer/sharer.php?${params.toString()}`,
      '_blank',
      'width=720,height=640'
    );

    if (!popup) {
      toast.error('Khong the mo Facebook. Hay kiem tra popup blocker.');
      return;
    }

    popup.opener = null;
    if (copied) {
      toast.success('Da mo Facebook. Caption va URL da copy, dan them neu can.');
    } else {
      toast.success('Da mo Facebook. Asset URL da duoc share.');
    }
  }

  async function download(key: string) {
    const url = assets[key];
    if (!url) return;

    const fallback = () => {
      const link = document.createElement('a');
      link.href = url;
      link.download = `affiliateai_${key}_${Date.now()}.${extensionFromType(key, url)}`;
      link.rel = 'noopener';
      link.click();
    };

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download_failed_${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `affiliateai_${key}_${Date.now()}.${extensionFromType(key, url, blob.type)}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      fallback();
    }

    toast.success('Đang tải về...');
  }

  function downloadAll() {
    Object.keys(assets).forEach((key, index) => {
      setTimeout(() => void download(key), index * 500);
    });
    toast.success(`Tải về ${Object.keys(assets).length} file...`);
  }

  const selectedUrl = selected ? assets[selected] : null;
  const selectedCfg = selected ? assetConfig(selected) : null;
  const isVideo = Boolean(selected && selected.includes('video'));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-bdr-2
                   bg-bg-1 shadow-2xl animate-slide-up flex flex-col"
      >
        <div className="flex items-center gap-3 border-b border-bdr-1 px-5 py-4 flex-shrink-0">
          <div className="text-lg">IMG</div>
          <div className="flex-1">
            <h2 className="text-sm font-bold">Visual Assets - Pipeline {job.pipeline}</h2>
            <p className="text-[11px] text-tx-4">{Object.keys(assets).length} file từ backend</p>
          </div>
          <button onClick={downloadAll} disabled={Object.keys(assets).length === 0} className="btn btn-success gap-1.5 text-xs">
            Tải tất cả
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-icon text-tx-3">
            X
          </button>
        </div>

        {Object.keys(assets).length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-tx-2">Chưa có asset thật trong job này</p>
            <p className="mt-1 text-[11px] text-tx-4">
              Nếu job đã done mà vẫn rỗng, kiểm tra cột assets của visual_jobs và log upload storage ở backend.
            </p>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="w-52 flex-shrink-0 overflow-y-auto border-r border-bdr-1 flex flex-col">
              {Object.keys(assets).map((key) => {
                const cfg = assetConfig(key);

                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    className={clsx(
                      'border-b border-bdr-1 px-3 py-2.5 text-left transition-colors flex items-center gap-2.5',
                      selected === key ? 'bg-brand/8 border-l-2 border-l-brand' : 'hover:bg-bg-3',
                    )}
                  >
                    <span className="text-[10px] font-bold flex-shrink-0 w-8 text-center">{cfg.icon}</span>
                    <div className="min-w-0">
                      <p className={clsx('truncate text-xs font-medium', selected === key ? 'text-brand-lighter' : 'text-tx-2')}>
                        {cfg.label}
                      </p>
                      <p className="text-[10px] text-tx-4">{cfg.size}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
              <div className="flex flex-1 items-center justify-center overflow-hidden bg-bg-0 p-4">
                {selectedUrl && (
                  isVideo ? (
                    <video src={selectedUrl} controls className="max-h-full max-w-full rounded-xl object-contain shadow-xl" />
                  ) : (
                    <img src={selectedUrl} alt={selectedCfg?.label} className="max-h-full max-w-full rounded-xl object-contain shadow-xl" />
                  )
                )}
              </div>

              {selected && selectedCfg && (
                <div className="flex flex-shrink-0 items-center gap-2 border-t border-bdr-1 bg-bg-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{selectedCfg.label}</p>
                    <p className="text-[11px] text-tx-4">{selectedCfg.size}</p>
                  </div>
                  <button onClick={() => copyUrl(selected)} className="btn btn-ghost gap-1.5 text-xs">
                    {copying === selected ? 'Đã copy' : 'Copy URL'}
                  </button>
                  <button onClick={() => shareToFacebook(selected)} className="btn btn-ghost gap-1.5 text-xs text-[#1877F2]">
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Share Facebook
                  </button>
                  <button onClick={() => void download(selected)} className="btn btn-primary gap-1.5 text-xs">
                    Tải về
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
