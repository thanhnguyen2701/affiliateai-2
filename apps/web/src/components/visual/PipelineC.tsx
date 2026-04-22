'use client';
// apps/web/src/components/visual/PipelineC.tsx

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { VisualJob } from '@/app/dashboard/visual/VisualPageClient';

interface Props {
  onJobCreated: (j: VisualJob) => void;
}

const SUBTITLE_STYLES = [
  { v:'tiktok',    label:'TikTok Viral',   desc:'UPPERCASE, word highlight, font lớn' },
  { v:'clean',     label:'Clean & Modern', desc:'Subtitle nhỏ gọn, chuyên nghiệp' },
  { v:'karaoke',   label:'Karaoke',        desc:'Highlight từng từ theo nhịp' },
];

const CLIP_DURATIONS = [
  { v:30,  label:'30 giây' },
  { v:45,  label:'45 giây', recommended: true },
  { v:60,  label:'60 giây' },
];

export default function PipelineC({ onJobCreated }: Props) {
  const [file,         setFile]         = useState<File | null>(null);
  const [preview,      setPreview]      = useState<string | null>(null);
  const [videoDuration,setVideoDuration]= useState<number>(0);
  const [subStyle,     setSubStyle]     = useState('tiktok');
  const [clipDuration, setClipDuration] = useState(45);
  const [uploading,    setUploading]    = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'video/*': ['.mp4', '.mov', '.avi', '.webm', '.mkv'] },
    maxSize: 500 * 1024 * 1024,  // 500MB
    multiple: false,
    onDrop: useCallback((accepted: File[]) => {
      const f = accepted[0];
      if (!f) return;
      setFile(f);

      // Create video element to get duration + thumbnail
      const video = document.createElement('video');
      const url   = URL.createObjectURL(f);
      video.src   = url;
      video.addEventListener('loadedmetadata', () => {
        setVideoDuration(Math.round(video.duration));
        URL.revokeObjectURL(url);
      });
      setPreview(url);
    }, []),
    onDropRejected: (rejected) => {
      const reason = rejected[0]?.errors[0]?.code === 'file-too-large'
        ? 'File quá lớn (tối đa 500MB)'
        : 'Định dạng không hỗ trợ (dùng MP4/MOV)';
      toast.error(reason);
    },
  });

  function formatDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${sec.toString().padStart(2,'0')}` : `${sec}s`;
  }

  async function handleProcess() {
    if (!file) return;
    setUploading(true);

    // Simulate upload — in production: call visualAPI.uploadVideo(file)
    try {
      await new Promise(r => setTimeout(r, 1000));

      const mockJobId = 'job_' + Math.random().toString(36).slice(2);
      const job: VisualJob = {
        id:           mockJobId,
        pipeline:     'C',
        status:       'queued',
        source_type:  'raw_video',
        product_info: { subStyle, clipDuration, fileName: file.name },
        assets:       {},
        api_cost_vnd: 0,
        created_at:   new Date().toISOString(),
      };

      onJobCreated(job);
      setFile(null);
      setPreview(null);
      toast.success('🎬 Video đang được xử lý — ~5-7 phút');
    } catch (err) {
      toast.error('Upload thất bại: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card p-4 space-y-4">
      <div className="text-xs font-bold text-tx-2 flex items-center gap-2">
        🎬 Upload video raw
        <span className="badge badge-teal text-[9px]">AI edit</span>
      </div>

      {/* Drop zone */}
      <div {...getRootProps()} className={clsx(
        'border-2 border-dashed rounded-xl transition-all duration-150 cursor-pointer',
        isDragActive
          ? 'border-brand bg-brand/5'
          : file
            ? 'border-bdr-2 bg-bg-3 p-4'
            : 'border-bdr-2 hover:border-brand/50 hover:bg-bg-3 p-8'
      )}>
        <input {...getInputProps()} />

        {file && preview ? (
          <div className="flex items-start gap-4">
            {/* Video thumbnail */}
            <div className="relative w-24 h-16 bg-bg-4 rounded-lg overflow-hidden flex-shrink-0">
              <video src={preview} className="w-full h-full object-cover" muted />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-xs">
                  ▶
                </div>
              </div>
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate mb-1">{file.name}</p>
              <div className="flex gap-3 text-[11px] text-tx-3">
                <span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                {videoDuration > 0 && <span>⏱ {formatDuration(videoDuration)}</span>}
              </div>
              {videoDuration > 0 && videoDuration < clipDuration && (
                <p className="text-[10px] text-amber-light mt-1">
                  ⚠️ Video ngắn hơn clip duration ({clipDuration}s)
                </p>
              )}
              <button
                onClick={e => { e.stopPropagation(); setFile(null); setPreview(null); setVideoDuration(0); }}
                className="btn btn-ghost btn-sm mt-2 text-[11px]"
              >
                ✕ Chọn video khác
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-3xl mb-3">🎬</div>
            <p className="text-sm font-medium text-tx-2 mb-1">
              {isDragActive ? 'Thả video vào đây...' : 'Kéo thả video hoặc click để chọn'}
            </p>
            <p className="text-[11px] text-tx-4">MP4, MOV, AVI · Tối đa 500MB</p>
            <p className="text-[10px] text-tx-4 mt-1">
              Tốt nhất: video review/unboxing 1-10 phút
            </p>
          </div>
        )}
      </div>

      {/* Clip duration */}
      <div>
        <label className="label">Độ dài clip output</label>
        <div className="flex gap-2">
          {CLIP_DURATIONS.map(d => (
            <button key={d.v} onClick={() => setClipDuration(d.v)}
              className={clsx(
                'flex-1 py-1.5 rounded-lg border text-xs font-medium transition-all relative',
                clipDuration === d.v
                  ? 'border-brand/40 bg-brand/10 text-brand-lighter'
                  : 'border-bdr-2 bg-bg-3 text-tx-3 hover:border-bdr-3'
              )}>
              {d.label}
              {d.recommended && (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 badge badge-green text-[8px] px-1">
                  Tốt nhất
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Subtitle style */}
      <div>
        <label className="label">Kiểu subtitle</label>
        <div className="grid grid-cols-3 gap-2">
          {SUBTITLE_STYLES.map(s => (
            <button key={s.v} onClick={() => setSubStyle(s.v)}
              className={clsx(
                'p-2.5 rounded-xl border text-left transition-all',
                subStyle === s.v
                  ? 'border-brand/40 bg-brand/8'
                  : 'border-bdr-2 bg-bg-3 hover:border-bdr-3'
              )}>
              <div className={clsx('text-xs font-semibold mb-0.5',
                subStyle === s.v ? 'text-brand-lighter' : 'text-tx-2')}>
                {s.label}
              </div>
              <div className="text-[10px] text-tx-4 leading-tight">{s.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* What AI will do */}
      <div className="bg-bg-3 rounded-xl p-3 border border-bdr-2">
        <p className="text-[11px] font-semibold text-tx-2 mb-2">🤖 AI sẽ tự động:</p>
        <div className="space-y-1">
          {[
            'Transcribe toàn bộ lời thoại (Whisper AI)',
            `Tìm đoạn ${clipDuration}s hay nhất làm highlight`,
            'Enhance audio: xóa tiếng ồn, cân bằng âm lượng',
            `Tạo subtitle kiểu "${SUBTITLE_STYLES.find(s => s.v === subStyle)?.label}"`,
            'Extract thumbnail đẹp nhất từ video',
            'Export 1080×1920 chuẩn TikTok/Reels',
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-brand/15 flex items-center justify-center text-[9px] font-bold text-brand-lighter flex-shrink-0">
                {i + 1}
              </div>
              <span className="text-[11px] text-tx-3">{step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={handleProcess}
        disabled={!file || uploading}
        className="btn btn-primary btn-lg w-full justify-center gap-2"
      >
        {uploading ? (
          <>
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3"/>
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Đang upload...
          </>
        ) : <>🎬 Xử lý video ({clipDuration}s clip)</>}
      </button>
    </div>
  );
}
