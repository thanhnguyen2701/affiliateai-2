'use client';
// apps/web/src/app/dashboard/visual/VisualPageClient.tsx

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { visualAPI } from '@/lib/api';
import JobCard from '@/components/visual/JobCard';
import PipelineB from '@/components/visual/PipelineB';
import PipelineC from '@/components/visual/PipelineC';
import VisualProgress from '@/components/visual/VisualProgress';
import AssetViewer from '@/components/visual/AssetViewer';

// ── Types ─────────────────────────────────────────────────────────────────────
export type Pipeline = 'A' | 'B' | 'C';

export interface VisualJob {
  id: string;
  pipeline: Pipeline;
  status: 'queued' | 'processing' | 'done' | 'failed';
  source_type?: string;
  source_url?: string;
  product_info: Record<string, unknown>;
  assets: Record<string, string | string[]>;
  api_cost_vnd: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

interface Props {
  initialJobs: VisualJob[];
  brandKit:    Record<string, unknown> | null;
}

// ── Pipeline tab config ───────────────────────────────────────────────────────
const PIPELINES: { id: Pipeline; icon: string; label: string; desc: string; tag?: string }[] = [
  {
    id: 'B',
    icon: '🛒',
    label: 'URL Shopee / Lazada',
    desc: 'Paste link sản phẩm — AI crawl ảnh, tạo bộ ảnh marketing tự động',
    tag: 'Phổ biến nhất',
  },
  {
    id: 'A',
    icon: '📸',
    label: 'Ảnh sản phẩm thực',
    desc: 'Upload ảnh của bạn — AI xóa nền, tạo background lifestyle chuyên nghiệp',
  },
  {
    id: 'C',
    icon: '🎬',
    label: 'Video raw',
    desc: 'Upload video — AI cắt highlight, thêm subtitle TikTok-style và export',
  },
];

// ── Platform output options ───────────────────────────────────────────────────
const OUTPUT_PLATFORMS = [
  { id: 'tiktok',    label: 'TikTok', size: '1080×1920', icon: '🎬' },
  { id: 'facebook',  label: 'Facebook', size: '1200×628', icon: '📘' },
  { id: 'instagram', label: 'Instagram', size: '1080×1080', icon: '📷' },
  { id: 'youtube',   label: 'YouTube', size: '1280×720', icon: '▶' },
  { id: 'zalo',      label: 'Zalo', size: '700×400', icon: '💬' },
];

// ═══════════════════════════════════════════════════════════════════════════════
export default function VisualPageClient({ initialJobs, brandKit }: Props) {
  const [activePipeline, setActivePipeline]   = useState<Pipeline>('B');
  const [jobs, setJobs]                        = useState<VisualJob[]>(initialJobs);
  const [activeJobId, setActiveJobId]          = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState(['tiktok', 'facebook', 'instagram']);
  const [viewingJob, setViewingJob]            = useState<VisualJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll processing jobs
  useEffect(() => {
    const processing = jobs.filter(j => j.status === 'queued' || j.status === 'processing');
    if (processing.length === 0) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      for (const job of processing) {
        try {
          const updated = await visualAPI.getJob(job.id);
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...updated } : j));

          if (updated.status === 'done') {
            toast.success(`✅ Bộ ảnh "${job.pipeline === 'C' ? 'video' : 'ảnh'}" đã sẵn sàng!`);
            setActiveJobId(null);
          } else if (updated.status === 'failed') {
            toast.error('❌ Tạo ảnh thất bại. Vui lòng thử lại.');
            setActiveJobId(null);
          }
        } catch {/* ignore poll errors */}
      }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs]);

  // Toggle platform selection
  function togglePlatform(id: string) {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  // Add new job to list
  function onJobCreated(job: VisualJob) {
    setJobs(prev => [job, ...prev]);
    setActiveJobId(job.id);
  }

  const processingJob = activeJobId ? jobs.find(j => j.id === activeJobId) : null;

  return (
    <div className="p-4 space-y-4 animate-fade-in">

      {/* ── PAGE HEADER ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-base font-bold flex items-center gap-2">
            🎨 Visual AI
            <span className="badge badge-blue">Beta</span>
          </h1>
          <p className="text-xs text-tx-3 mt-0.5">
            Tự động tạo ảnh & video affiliate từ link hoặc file của bạn
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-tx-3">
            {jobs.filter(j => j.status === 'done').length} bộ đã tạo
          </div>
        </div>
      </div>

      {/* ── PIPELINE SELECTOR ──────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {PIPELINES.map(p => (
          <button
            key={p.id}
            onClick={() => setActivePipeline(p.id)}
            className={clsx(
              'relative p-4 rounded-xl border text-left transition-all duration-150 group',
              activePipeline === p.id
                ? 'bg-brand/8 border-brand/40 shadow-[0_0_0_1px_rgba(99,102,241,.2)]'
                : 'bg-bg-2 border-bdr-1 hover:border-bdr-2 hover:bg-bg-3'
            )}
          >
            {p.tag && (
              <span className="absolute top-2.5 right-2.5 badge badge-amber text-[9px]">
                {p.tag}
              </span>
            )}
            <div className="text-2xl mb-2">{p.icon}</div>
            <div className={clsx(
              'text-xs font-bold mb-1 transition-colors',
              activePipeline === p.id ? 'text-brand-lighter' : 'text-tx-1'
            )}>
              {p.label}
            </div>
            <div className="text-[11px] text-tx-3 leading-relaxed">{p.desc}</div>

            {/* Active indicator */}
            {activePipeline === p.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-brand to-teal rounded-b-xl" />
            )}
          </button>
        ))}
      </div>

      {/* ── OUTPUT PLATFORM SELECTOR ───────────────────────────── */}
      <div className="card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold text-tx-3 uppercase tracking-wide flex-shrink-0">
            Output cho:
          </span>
          {OUTPUT_PLATFORMS.map(plt => (
            <button
              key={plt.id}
              onClick={() => togglePlatform(plt.id)}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all',
                selectedPlatforms.includes(plt.id)
                  ? 'bg-brand/10 border-brand/40 text-brand-lighter'
                  : 'bg-bg-3 border-bdr-2 text-tx-3 hover:border-bdr-3'
              )}
            >
              <span>{plt.icon}</span>
              <span>{plt.label}</span>
              <span className="text-[9px] text-tx-4 hidden sm:inline">({plt.size})</span>
            </button>
          ))}
          <span className="ml-auto text-[11px] text-tx-4">
            {selectedPlatforms.length} platform chọn
          </span>
        </div>
      </div>

      {/* ── MAIN WORK AREA ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Left: Upload + Config (2 cols) */}
        <div className="col-span-2 space-y-3">

          {/* Pipeline input */}
          {activePipeline === 'B' && (
            <PipelineB
              platforms={selectedPlatforms}
              brandKit={brandKit}
              onJobCreated={onJobCreated}
            />
          )}
          {activePipeline === 'A' && (
            <PipelineA
              platforms={selectedPlatforms}
              brandKit={brandKit}
              onJobCreated={onJobCreated}
            />
          )}
          {activePipeline === 'C' && (
            <PipelineC
              onJobCreated={onJobCreated}
            />
          )}

          {/* Progress for active job */}
          {processingJob && (
            <VisualProgress job={processingJob} pipeline={activePipeline} />
          )}
        </div>

        {/* Right: How it works + Brand kit (1 col) */}
        <div className="space-y-3">
          <HowItWorks pipeline={activePipeline} />
          <BrandKitPreview brandKit={brandKit} />
        </div>
      </div>

      {/* ── JOB GALLERY ────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <div className="card">
          <div className="panel-head">
            🖼 Thư viện Visual
            <span className="ml-auto text-[11px] text-tx-4">{jobs.length} bộ</span>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                onClick={() => setViewingJob(job)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── ASSET VIEWER MODAL ─────────────────────────────────── */}
      {viewingJob && (
        <AssetViewer
          job={viewingJob}
          onClose={() => setViewingJob(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE A — Upload ảnh thực
// ═══════════════════════════════════════════════════════════════════════════════
function PipelineA({ platforms, brandKit, onJobCreated }: {
  platforms: string[];
  brandKit:  Record<string, unknown> | null;
  onJobCreated: (j: VisualJob) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview,   setPreview]   = useState<string | null>(null);
  const [file,      setFile]      = useState<File | null>(null);
  const [niche,     setNiche]     = useState('beauty');

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp'] },
    maxSize: 15 * 1024 * 1024,
    multiple: false,
    onDrop: useCallback((accepted: File[]) => {
      if (accepted[0]) {
        setFile(accepted[0]);
        setPreview(URL.createObjectURL(accepted[0]));
      }
    }, []),
    onDropRejected: () => toast.error('File không hợp lệ. Dùng JPG/PNG/WEBP, tối đa 15MB'),
  });

  async function handleProcess() {
    if (!file) return;
    setUploading(true);
    try {
      const result = await visualAPI.uploadPhoto(file);
      // Build optimistic job
      const job: VisualJob = {
        id: result.job_id,
        pipeline: 'A',
        status: 'queued',
        source_type: 'photo_upload',
        product_info: { niche },
        assets: {},
        api_cost_vnd: 0,
        created_at: new Date().toISOString(),
      };
      onJobCreated(job);
      setFile(null);
      setPreview(null);
      toast.success('✅ Đang xử lý ảnh...');
    } catch (err) {
      toast.error('Upload thất bại: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card p-4 space-y-4">
      <div className="text-xs font-bold text-tx-2 flex items-center gap-2">
        📸 Upload ảnh sản phẩm
      </div>

      {/* Drop zone */}
      <div {...getRootProps()} className={clsx(
        'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-150',
        isDragActive
          ? 'border-brand bg-brand/5'
          : preview
            ? 'border-bdr-2 bg-bg-3'
            : 'border-bdr-2 hover:border-brand/50 hover:bg-bg-3'
      )}>
        <input {...getInputProps()} />
        {preview ? (
          <div className="space-y-3">
            <img src={preview} alt="Preview" className="max-h-40 mx-auto rounded-lg object-contain" />
            <p className="text-[11px] text-tx-3">{file?.name} · {((file?.size ?? 0) / 1024).toFixed(0)}KB</p>
            <button onClick={(e) => { e.stopPropagation(); setPreview(null); setFile(null); }}
              className="btn btn-ghost btn-sm">✕ Chọn ảnh khác</button>
          </div>
        ) : (
          <>
            <div className="text-3xl mb-3">📸</div>
            <p className="text-sm font-medium text-tx-2 mb-1">
              {isDragActive ? 'Thả ảnh vào đây...' : 'Kéo thả ảnh hoặc click để chọn'}
            </p>
            <p className="text-[11px] text-tx-4">JPG, PNG, WEBP · Tối đa 15MB</p>
          </>
        )}
      </div>

      {/* Niche selector */}
      <div>
        <label className="label">Niche sản phẩm (để AI tạo background phù hợp)</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { v:'beauty',  l:'💄 Beauty' },
            { v:'tech',    l:'💻 Tech' },
            { v:'food',    l:'🍜 Food' },
            { v:'fashion', l:'👗 Fashion' },
            { v:'home',    l:'🏠 Home' },
            { v:'health',  l:'💪 Health' },
          ].map(n => (
            <button key={n.v} onClick={() => setNiche(n.v)}
              className={clsx('py-1.5 px-2 rounded-lg border text-[11px] font-medium transition-all',
                niche === n.v
                  ? 'border-brand/40 bg-brand/10 text-brand-lighter'
                  : 'border-bdr-2 bg-bg-3 text-tx-3 hover:border-bdr-3')}>
              {n.l}
            </button>
          ))}
        </div>
      </div>

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
            Đang xử lý...
          </>
        ) : <>✨ Tạo bộ ảnh marketing ({platforms.length} platform)</>}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOW IT WORKS — sidebar explanation
// ═══════════════════════════════════════════════════════════════════════════════
const PIPELINE_STEPS: Record<Pipeline, Array<{ icon: string; text: string }>> = {
  B: [
    { icon: '🔗', text: 'Paste link Shopee/Lazada' },
    { icon: '🕷',  text: 'AI crawl ảnh sản phẩm' },
    { icon: '🏆', text: 'Chọn ảnh đẹp nhất (GPT-4o Vision)' },
    { icon: '✂️', text: 'Remove background' },
    { icon: '🎨', text: 'DALL-E tạo background lifestyle' },
    { icon: '✏️', text: 'Thêm giá, CTA, logo' },
    { icon: '📦', text: 'Export đa format' },
  ],
  A: [
    { icon: '📸', text: 'Upload ảnh sản phẩm' },
    { icon: '✂️', text: 'Remove.bg xóa nền chuyên nghiệp' },
    { icon: '⬆️', text: 'Upscale chất lượng (Real-ESRGAN)' },
    { icon: '🎨', text: 'DALL-E tạo background theo niche' },
    { icon: '🖼',  text: 'Ghép ảnh + text overlay' },
    { icon: '📦', text: 'Export đa format' },
  ],
  C: [
    { icon: '🎬', text: 'Upload video raw' },
    { icon: '🎙', text: 'Whisper transcribe tiếng Việt' },
    { icon: '✂️', text: 'AI tìm highlight 45s hay nhất' },
    { icon: '🔊', text: 'Enhance audio (noise reduction)' },
    { icon: '💬', text: 'Subtitle word-by-word TikTok style' },
    { icon: '🖼',  text: 'Extract thumbnail đẹp nhất' },
    { icon: '📱', text: 'Export 1080×1920 TikTok ready' },
  ],
};

const PIPELINE_TIME: Record<Pipeline, string> = {
  A: '2-3 phút', B: '3-5 phút', C: '5-7 phút',
};

const PIPELINE_COST: Record<Pipeline, string> = {
  A: '~3-5K đ', B: '~4-6K đ', C: '~5-8K đ',
};

function HowItWorks({ pipeline }: { pipeline: Pipeline }) {
  const steps = PIPELINE_STEPS[pipeline];
  return (
    <div className="card">
      <div className="panel-head">ℹ️ Cách hoạt động</div>
      <div className="p-4 space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded flex items-center justify-center text-xs
                            bg-bg-4 text-tx-3 flex-shrink-0">{s.icon}</div>
            <span className="text-[11px] text-tx-2">{s.text}</span>
          </div>
        ))}
        <div className="mt-3 pt-3 border-t border-bdr-1 flex justify-between text-[11px]">
          <span className="text-tx-3">⏱ {PIPELINE_TIME[pipeline]}</span>
          <span className="text-tx-3">💰 {PIPELINE_COST[pipeline]}/bộ</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRAND KIT PREVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function BrandKitPreview({ brandKit }: { brandKit: Record<string, unknown> | null }) {
  if (!brandKit) return (
    <div className="card p-4 text-center">
      <div className="text-2xl mb-2">🎨</div>
      <p className="text-xs font-medium text-tx-2 mb-1">Brand Kit chưa cài đặt</p>
      <p className="text-[11px] text-tx-4 mb-3">
        Cài đặt màu sắc và logo để AI áp dụng vào mọi ảnh
      </p>
      <a href="/dashboard/settings"
        className="btn btn-ghost btn-sm w-full justify-center">⚙️ Cài đặt</a>
    </div>
  );

  const colors = [
    brandKit.primary_color as string   ?? '#6366F1',
    brandKit.secondary_color as string ?? '#E8500A',
    brandKit.accent_color as string    ?? '#0E7C7B',
  ];

  return (
    <div className="card">
      <div className="panel-head">🎨 Brand Kit</div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          {colors.map((c, i) => (
            <div key={i} className="flex-1 h-8 rounded-lg shadow-inner"
              style={{ background: c }} title={c} />
          ))}
        </div>
        <div className="text-[11px] text-tx-3">
          Màu sắc sẽ được áp dụng vào text overlay và branding tự động.
        </div>
        {brandKit.logo_url && (
          <div className="flex items-center gap-2 p-2 bg-bg-3 rounded-lg">
            <img src={brandKit.logo_url as string} alt="Logo" className="h-6 object-contain" />
            <span className="text-[11px] text-tx-3">Logo đã cài đặt</span>
          </div>
        )}
        <a href="/dashboard/settings"
          className="btn btn-ghost btn-sm w-full justify-center text-[11px]">
          Chỉnh sửa Brand Kit
        </a>
      </div>
    </div>
  );
}
