'use client';
// apps/web/src/components/visual/JobCard.tsx

import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import type { VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  job:     VisualJob;
  onClick: () => void;
}

const PIPELINE_EMOJI: Record<string, string> = {
  A: '📸', B: '🛒', C: '🎬',
};

const STATUS_CONFIG = {
  done:       { label:'✅ Xong',     cls:'badge-green' },
  processing: { label:'⚙️ Đang xử lý', cls:'badge-blue' },
  queued:     { label:'🕐 Chờ',     cls:'badge-amber' },
  failed:     { label:'❌ Lỗi',      cls:'badge-rose' },
};

export default function JobCard({ job, onClick }: Props) {
  const statusCfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.queued;
  const hasDone   = job.status === 'done';
  const assetCount = Object.keys(job.assets).length;

  // Get first asset URL for thumbnail
  const thumbUrl = Object.values(job.assets)[0];
  const thumbStr = Array.isArray(thumbUrl) ? thumbUrl[0] : thumbUrl;

  const timeAgo = formatDistanceToNow(new Date(job.created_at), {
    addSuffix: true, locale: vi,
  });

  return (
    <div
      onClick={onClick}
      className={clsx(
        'group rounded-xl border overflow-hidden cursor-pointer transition-all duration-150',
        hasDone
          ? 'border-bdr-1 hover:border-brand/40 hover:-translate-y-0.5 hover:shadow-lg'
          : 'border-bdr-1 opacity-70'
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-24 bg-bg-4 flex items-center justify-center overflow-hidden">
        {thumbStr ? (
          <img src={thumbStr} alt="Visual output" className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl opacity-40">{PIPELINE_EMOJI[job.pipeline] ?? '🖼'}</span>
        )}

        {/* Status badge overlay */}
        <div className="absolute top-1.5 right-1.5">
          <span className={clsx('badge text-[9px]', statusCfg.cls)}>
            {statusCfg.label}
          </span>
        </div>

        {/* Processing spinner overlay */}
        {(job.status === 'processing' || job.status === 'queued') && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <svg className="animate-spin w-6 h-6 text-white/60" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/>
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
        )}

        {/* Hover overlay for done */}
        {hasDone && (
          <div className="absolute inset-0 bg-brand/20 opacity-0 group-hover:opacity-100 transition-opacity
                          flex items-center justify-center">
            <span className="text-white text-xs font-semibold bg-black/50 px-2 py-1 rounded-lg">
              Xem & tải
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2 bg-bg-2">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-sm">{PIPELINE_EMOJI[job.pipeline]}</span>
          <span className="text-[10px] font-semibold text-tx-2 truncate">
            Pipeline {job.pipeline}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-tx-4">{timeAgo}</span>
          {hasDone && assetCount > 0 && (
            <span className="text-[9px] text-brand-lighter">{assetCount} files</span>
          )}
          {job.api_cost_vnd > 0 && (
            <span className="text-[9px] text-tx-4">~{(job.api_cost_vnd/1000).toFixed(1)}K đ</span>
          )}
        </div>
      </div>
    </div>
  );
}
