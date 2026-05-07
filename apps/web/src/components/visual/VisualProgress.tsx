'use client';
// apps/web/src/components/visual/VisualProgress.tsx

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Pipeline, VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  job: VisualJob;
  pipeline: Pipeline;
}

const STEPS: Record<Pipeline, string[]> = {
  B: [
    'Đang đọc thông tin sản phẩm từ URL...',
    'Đang chọn ảnh nguồn tốt nhất...',
    'Đang dùng ảnh sản phẩm làm reference...',
    'Đang sinh ảnh quảng cáo hoàn chỉnh...',
    'Đang thêm headline, giá và CTA...',
    'Đang upload asset lên storage...',
  ],
  A: [
    'Đang nhận ảnh upload...',
    'Đang tách nền sản phẩm nếu có Remove.bg...',
    'Đang upscale ảnh nếu cần...',
    'Đang tạo scene theo niche...',
    'Đang thêm bố cục và text overlay...',
    'Đang upload asset lên storage...',
  ],
  C: [
    'Đang nhận video upload...',
    'Đang trích xuất audio và transcribe...',
    'Đang tìm đoạn highlight...',
    'Đang cắt clip và resize 9:16...',
    'Đang tạo subtitle nếu có lời thoại...',
    'Đang extract thumbnail...',
    'Đang upload video, thumbnail và subtitle...',
  ],
};

export default function VisualProgress({ job, pipeline }: Props) {
  const steps = STEPS[pipeline];
  const [currentStep, setCurrentStep] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setCurrentStep(0);
    setElapsedMs(0);
  }, [job.id]);

  useEffect(() => {
    if (job.status === 'done' || job.status === 'failed') return;

    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < steps.length - 1) return prev + 1;
        clearInterval(stepInterval);
        return prev;
      });
    }, pipeline === 'C' ? 12_000 : 10_000);

    return () => clearInterval(stepInterval);
  }, [job.status, pipeline, steps.length]);

  useEffect(() => {
    if (job.status === 'done' || job.status === 'failed') return;
    const timer = setInterval(() => setElapsedMs((elapsed) => elapsed + 1000), 1000);
    return () => clearInterval(timer);
  }, [job.status]);

  const pct = job.status === 'done' ? 100 : Math.round(((currentStep + 1) / steps.length) * 90);
  const elapsed = Math.floor(elapsedMs / 1000);
  const elapsedFmt = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';

  return (
    <div
      className={clsx(
        'card p-4 space-y-4 transition-all',
        isDone && 'border-emerald-DEFAULT/30',
        isFailed && 'border-rose-DEFAULT/30',
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={clsx(
            'w-8 h-8 rounded-lg flex items-center justify-center text-sm',
            isDone ? 'bg-emerald-DEFAULT/15' : isFailed ? 'bg-rose-DEFAULT/15' : 'bg-brand/15',
          )}
        >
          {isDone ? 'OK' : isFailed ? '!' : '...'}
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-tx-1">
            {isDone ? 'Hoàn thành' : isFailed ? 'Thất bại' : 'Đang xử lý'}
          </p>
          <p className="text-[11px] text-tx-4">
            Pipeline {pipeline} - {elapsedFmt} đã qua - trạng thái {job.status}
          </p>
        </div>
        <span className={clsx('text-sm font-extrabold', isDone ? 'text-emerald-light' : 'text-brand-lighter')}>
          {pct}%
        </span>
      </div>

      <div className="h-1.5 bg-bg-4 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-700',
            isDone ? 'bg-emerald-light' : 'bg-gradient-to-r from-brand to-teal',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {steps.map((step, i) => {
          const done = i < currentStep || isDone;
          const active = i === currentStep && !isDone && !isFailed;

          return (
            <div
              key={step}
              className={clsx(
                'flex items-center gap-2.5 transition-all duration-300',
                done ? 'opacity-100' : active ? 'opacity-100' : 'opacity-30',
              )}
            >
              <div
                className={clsx(
                  'w-4 h-4 rounded flex items-center justify-center text-[10px] flex-shrink-0 transition-all',
                  done
                    ? 'bg-emerald-DEFAULT/20 text-emerald-light'
                    : active
                      ? 'bg-brand/20 text-brand-lighter'
                      : 'bg-bg-4 text-tx-4',
                )}
              >
                {done ? 'OK' : active ? (
                  <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity=".3" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={clsx('text-[11px]', done ? 'text-tx-3' : active ? 'text-tx-1 font-medium' : 'text-tx-4')}>
                {step}
              </span>
            </div>
          );
        })}
      </div>

      {isDone && (
        <div className="bg-emerald-DEFAULT/8 border border-emerald-DEFAULT/20 rounded-xl p-3">
          <p className="text-xs font-bold text-emerald-light">Asset đã sẵn sàng</p>
          <p className="text-[11px] text-tx-3">Mở card trong thư viện để xem và tải file thật từ storage.</p>
        </div>
      )}

      {isFailed && (
        <div className="bg-rose-DEFAULT/8 border border-rose-DEFAULT/20 rounded-xl p-3 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-bold text-rose-light">Xử lý thất bại</p>
            <p className="text-[11px] text-tx-3">{job.error_msg || 'Kiểm tra URL/file và thử lại'}</p>
          </div>
          <button className="btn btn-ghost btn-sm text-[11px]" onClick={() => window.location.reload()}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
