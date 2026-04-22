'use client';
// apps/web/src/components/visual/AssetViewer.tsx

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  job:     VisualJob;
  onClose: () => void;
}

// Platform display config
const PLATFORM_CONFIG: Record<string, { label: string; icon: string; size: string }> = {
  facebook_banner:    { label: 'Facebook Banner',  icon: '📘', size: '1200×628' },
  tiktok_thumbnail:   { label: 'TikTok Thumbnail', icon: '🎬', size: '1080×1920' },
  tiktok_video:       { label: 'TikTok Video',     icon: '🎬', size: '1080×1920 MP4' },
  instagram_carousel: { label: 'Instagram Carousel', icon: '📷', size: '1080×1080 ×5' },
  youtube_thumbnail:  { label: 'YouTube Thumbnail', icon: '▶', size: '1280×720' },
  zalo_image:         { label: 'Zalo Image',        icon: '💬', size: '700×400' },
  subtitle_srt:       { label: 'Subtitle File',     icon: '💬', size: '.SRT' },
};

// Demo assets for preview when real assets aren't available
const DEMO_ASSETS: Record<string, string> = {
  facebook_banner:    'https://via.placeholder.com/1200x628/161B27/818CF8?text=Facebook+Banner',
  tiktok_thumbnail:   'https://via.placeholder.com/1080x1920/161B27/14B8A6?text=TikTok+Thumbnail',
  instagram_carousel: 'https://via.placeholder.com/1080x1080/161B27/10B981?text=Instagram+Carousel',
  youtube_thumbnail:  'https://via.placeholder.com/1280x720/161B27/F59E0B?text=YouTube+Thumbnail',
  zalo_image:         'https://via.placeholder.com/700x400/161B27/818CF8?text=Zalo+Image',
};

export default function AssetViewer({ job, onClose }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copying, setCopying]   = useState<string | null>(null);

  // Merge real assets with demo placeholders
  const assets = Object.keys(DEMO_ASSETS).reduce((acc, key) => {
    const realVal = job.assets[key];
    if (realVal) {
      acc[key] = Array.isArray(realVal) ? realVal[0] : realVal;
    } else if (job.status === 'done') {
      acc[key] = DEMO_ASSETS[key];
    }
    return acc;
  }, {} as Record<string, string>);

  // Auto-select first asset
  useEffect(() => {
    const first = Object.keys(assets)[0];
    if (first) setSelected(first);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function copyUrl(key: string) {
    const url = assets[key];
    if (!url) return;
    setCopying(key);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('✅ Đã copy URL!');
    } catch {
      toast.error('Không thể copy');
    } finally {
      setTimeout(() => setCopying(null), 1500);
    }
  }

  function download(key: string) {
    const url = assets[key];
    if (!url) return;
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `affiliateai_${key}_${Date.now()}`;
    a.target  = '_blank';
    a.click();
    toast.success('⬇️ Đang tải về...');
  }

  function downloadAll() {
    Object.keys(assets).forEach((key, i) => {
      setTimeout(() => download(key), i * 500);
    });
    toast.success(`⬇️ Tải về ${Object.keys(assets).length} files...`);
  }

  const selectedUrl = selected ? assets[selected] : null;
  const selectedCfg = selected ? PLATFORM_CONFIG[selected] : null;
  const isVideo     = selected?.includes('video');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-1 border border-bdr-2 rounded-2xl w-full max-w-3xl max-h-[90vh]
                      flex flex-col shadow-2xl animate-slide-up overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-bdr-1 flex-shrink-0">
          <div className="text-lg">🖼</div>
          <div className="flex-1">
            <h2 className="text-sm font-bold">Visual Assets — Pipeline {job.pipeline}</h2>
            <p className="text-[11px] text-tx-4">
              {Object.keys(assets).length} files sẵn sàng
            </p>
          </div>
          <button onClick={downloadAll}
            className="btn btn-success gap-1.5 text-xs">
            ⬇ Tải tất cả
          </button>
          <button onClick={onClose}
            className="btn btn-ghost btn-icon text-tx-3">✕</button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar: asset list */}
          <div className="w-52 border-r border-bdr-1 flex flex-col overflow-y-auto flex-shrink-0">
            {Object.entries(assets).map(([key, url]) => {
              const cfg = PLATFORM_CONFIG[key];
              if (!cfg) return null;
              return (
                <button key={key} onClick={() => setSelected(key)}
                  className={clsx(
                    'flex items-center gap-2.5 px-3 py-2.5 border-b border-bdr-1 transition-colors text-left',
                    selected === key ? 'bg-brand/8 border-l-2 border-l-brand' : 'hover:bg-bg-3'
                  )}>
                  <span className="text-base flex-shrink-0">{cfg.icon}</span>
                  <div className="min-w-0">
                    <p className={clsx('text-xs font-medium truncate',
                      selected === key ? 'text-brand-lighter' : 'text-tx-2')}>
                      {cfg.label}
                    </p>
                    <p className="text-[10px] text-tx-4">{cfg.size}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Main: preview */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Preview area */}
            <div className="flex-1 bg-bg-0 flex items-center justify-center p-4 overflow-hidden">
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

            {/* Actions bar */}
            {selected && selectedCfg && (
              <div className="flex items-center gap-2 px-4 py-3 border-t border-bdr-1 bg-bg-2 flex-shrink-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold">{selectedCfg.label}</p>
                  <p className="text-[11px] text-tx-4">{selectedCfg.size}</p>
                </div>
                <button onClick={() => copyUrl(selected!)}
                  className="btn btn-ghost gap-1.5 text-xs">
                  {copying === selected ? '✅ Đã copy' : '📋 Copy URL'}
                </button>
                <button onClick={() => download(selected!)}
                  className="btn btn-primary gap-1.5 text-xs">
                  ⬇ Tải về
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
