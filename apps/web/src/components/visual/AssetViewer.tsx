'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  job: VisualJob;
  onClose: () => void;
}

const PLATFORM_CONFIG: Record<string, { label: string; icon: string; size: string }> = {
  facebook_banner: { label: 'Facebook Banner', icon: '📘', size: '1200x628' },
  instagram_banner: { label: 'Instagram Banner', icon: '📷', size: '1080x1080' },
  tiktok_banner: { label: 'TikTok Banner', icon: '🎬', size: '1080x1920' },
  tiktok_thumbnail: { label: 'TikTok Thumbnail', icon: '🎬', size: '1080x1920' },
  tiktok_video: { label: 'TikTok Video', icon: '🎬', size: '1080x1920 MP4' },
  instagram_carousel: { label: 'Instagram Carousel', icon: '📷', size: '1080x1080 x5' },
  youtube_thumbnail: { label: 'YouTube Thumbnail', icon: '▶', size: '1280x720' },
  zalo_image: { label: 'Zalo Image', icon: '💬', size: '700x400' },
  subtitle_srt: { label: 'Subtitle File', icon: '💬', size: '.SRT' },
};

const DEMO_ASSETS: Record<string, string> = {
  facebook_banner: 'https://via.placeholder.com/1200x628/161B27/818CF8?text=Facebook+Banner',
  instagram_banner: 'https://via.placeholder.com/1080x1080/161B27/10B981?text=Instagram+Banner',
  tiktok_banner: 'https://via.placeholder.com/1080x1920/161B27/14B8A6?text=TikTok+Banner',
  tiktok_thumbnail: 'https://via.placeholder.com/1080x1920/161B27/14B8A6?text=TikTok+Thumbnail',
  instagram_carousel: 'https://via.placeholder.com/1080x1080/161B27/10B981?text=Instagram+Carousel',
  youtube_thumbnail: 'https://via.placeholder.com/1280x720/161B27/F59E0B?text=YouTube+Thumbnail',
  zalo_image: 'https://via.placeholder.com/700x400/161B27/818CF8?text=Zalo+Image',
};

function normalizeAssets(job: VisualJob): Record<string, string> {
  const realAssets = Object.entries(job.assets).reduce((acc, [key, value]) => {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (typeof normalized === 'string' && normalized.trim()) {
      acc[key] = normalized;
    }
    return acc;
  }, {} as Record<string, string>);

  if (job.status !== 'done') {
    return realAssets;
  }

  const fallbackAssets = Object.keys(DEMO_ASSETS).reduce((acc, key) => {
    if (!realAssets[key]) {
      acc[key] = DEMO_ASSETS[key];
    }
    return acc;
  }, {} as Record<string, string>);

  return { ...fallbackAssets, ...realAssets };
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

export default function AssetViewer({ job, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  const assets = useMemo(() => normalizeAssets(job), [job]);

  useEffect(() => {
    const first = Object.keys(assets)[0] ?? null;
    setSelected((prev) => (prev && assets[prev] ? prev : first));
  }, [assets]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function copyUrl(key: string) {
    const url = assets[key];
    if (!url) return;

    setCopying(key);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Da copy URL');
    } catch {
      toast.error('Khong the copy');
    } finally {
      setTimeout(() => setCopying(null), 1500);
    }
  }

  async function download(key: string) {
    const url = assets[key];
    if (!url) return;

    const fallback = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `affiliateai_${key}_${Date.now()}.${extensionFromType(key, url)}`;
      a.rel = 'noopener';
      a.click();
    };

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download_failed_${res.status}`);

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `affiliateai_${key}_${Date.now()}.${extensionFromType(key, url, blob.type)}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      fallback();
    }

    toast.success('Dang tai ve...');
  }

  function downloadAll() {
    Object.keys(assets).forEach((key, i) => {
      setTimeout(() => {
        void download(key);
      }, i * 500);
    });
    toast.success(`Tai ve ${Object.keys(assets).length} files...`);
  }

  const selectedUrl = selected ? assets[selected] : null;
  const selectedCfg = selected ? PLATFORM_CONFIG[selected] : null;
  const isVideo = Boolean(selected && selected.includes('video'));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-bdr-2
                   bg-bg-1 shadow-2xl animate-slide-up flex flex-col"
      >
        <div className="flex items-center gap-3 border-b border-bdr-1 px-5 py-4 flex-shrink-0">
          <div className="text-lg">🖼</div>
          <div className="flex-1">
            <h2 className="text-sm font-bold">Visual Assets - Pipeline {job.pipeline}</h2>
            <p className="text-[11px] text-tx-4">{Object.keys(assets).length} files san sang</p>
          </div>
          <button onClick={downloadAll} className="btn btn-success gap-1.5 text-xs">
            Tai tat ca
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-icon text-tx-3">
            X
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="w-52 flex-shrink-0 overflow-y-auto border-r border-bdr-1 flex flex-col">
            {Object.entries(assets).map(([key]) => {
              const cfg = PLATFORM_CONFIG[key];
              if (!cfg) return null;

              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={clsx(
                    'border-b border-bdr-1 px-3 py-2.5 text-left transition-colors flex items-center gap-2.5',
                    selected === key ? 'bg-brand/8 border-l-2 border-l-brand' : 'hover:bg-bg-3',
                  )}
                >
                  <span className="text-base flex-shrink-0">{cfg.icon}</span>
                  <div className="min-w-0">
                    <p
                      className={clsx(
                        'truncate text-xs font-medium',
                        selected === key ? 'text-brand-lighter' : 'text-tx-2',
                      )}
                    >
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
                  <video
                    src={selectedUrl}
                    controls
                    className="max-h-full max-w-full rounded-xl object-contain shadow-xl"
                  />
                ) : (
                  <img
                    src={selectedUrl}
                    alt={selectedCfg?.label}
                    className="max-h-full max-w-full rounded-xl object-contain shadow-xl"
                  />
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
                  {copying === selected ? 'Da copy' : 'Copy URL'}
                </button>
                <button onClick={() => void download(selected)} className="btn btn-primary gap-1.5 text-xs">
                  Tai ve
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
