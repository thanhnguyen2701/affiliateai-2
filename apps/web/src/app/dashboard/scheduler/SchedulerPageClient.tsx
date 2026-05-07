'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  Bot,
  CalendarDays,
  Check,
  Clipboard,
  Clock,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { agentAPI, profileAPI } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import { useUserStore } from '@/lib/store';
import MarkdownMessage from '@/components/agent/MarkdownMessage';

type JobStatus = 'running' | 'completed' | 'failed' | 'skipped';
type AgentIntent = 'trend_research' | 'content_create' | 'customer_reply' | 'performance_review' | 'offer_find' | 'schedule_task';

interface SchedulerUser {
  id: string;
  email: string;
  plan: string;
  credits_total: number;
  credits_used: number;
  full_autopilot: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
}

interface SchedulerProfile {
  niche_primary: string | null;
  active_networks: string[] | null;
  best_posting_hrs: Record<string, number[]> | null;
  avg_quality_score: number | null;
}

interface SchedulerLog {
  id: string;
  job_type: string;
  status: JobStatus;
  result: Record<string, unknown> | null;
  error_msg: string | null;
  ran_at: string;
  duration_ms: number | null;
}

interface DraftItem {
  id: string;
  platform: string;
  content: string;
  quality_score: number | null;
  affiliate_network: string | null;
  affiliate_link: string | null;
  was_posted: boolean;
  created_at: string;
}

interface SchedulePost {
  platform: string;
  scheduled_time: string;
  content_type: string;
  product: string;
  angle: string;
  priority: string;
}

interface ScheduleDay {
  date: string;
  day_of_week: string;
  posts: SchedulePost[];
}

interface ScheduleResult {
  calendar?: ScheduleDay[];
  weekly_summary?: {
    total_posts?: number;
    by_platform?: Record<string, number>;
    estimated_weekly_reach?: string;
  };
}

interface Props {
  user: SchedulerUser | null;
  profile: SchedulerProfile | null;
  logs: SchedulerLog[];
  drafts: DraftItem[];
}

interface JobConfig {
  id: string;
  name: string;
  time: string;
  intent: AgentIntent;
  icon: typeof TrendingUp;
  color: string;
  description: string;
  message: string;
}

const JOBS: JobConfig[] = [
  {
    id: 'morning_trend_scan',
    name: 'Morning Trend Scan',
    time: '06:00 mỗi ngày',
    intent: 'trend_research',
    icon: TrendingUp,
    color: '#F59E0B',
    description: 'Quét trend và gợi ý sản phẩm nên làm content.',
    message: 'Tìm top 5 sản phẩm đang trending hôm nay và gợi ý tôi nên làm content về gì',
  },
  {
    id: 'content_autopilot',
    name: 'Content Autopilot',
    time: '07:00 mỗi ngày',
    intent: 'content_create',
    icon: Sparkles,
    color: '#818CF8',
    description: 'Tạo draft TikTok/Facebook từ trend mới nhất.',
    message: 'Tạo draft content TikTok và Facebook cho sản phẩm hot hôm nay, giọng tự nhiên và CTA nhẹ',
  },
  {
    id: 'engagement_monitor',
    name: 'Engagement Monitor',
    time: '19:30 mỗi ngày',
    intent: 'customer_reply',
    icon: Bot,
    color: '#14B8A6',
    description: 'Nhắc xử lý comment/inbox trong khung giờ tương tác.',
    message: 'Gợi ý 5 mẫu trả lời comment/inbox thường gặp cho affiliate hôm nay',
  },
  {
    id: 'weekly_report',
    name: 'Weekly Report',
    time: '08:00 thứ Hai',
    intent: 'performance_review',
    icon: FileText,
    color: '#10B981',
    description: 'Tổng hợp hiệu suất tuần và đề xuất việc cần làm.',
    message: 'Tổng hợp hiệu suất tuần qua và đề xuất 5 việc cần làm tuần tới',
  },
  {
    id: 'link_health_check',
    name: 'Link Health Check',
    time: '22:00 mỗi ngày',
    intent: 'performance_review',
    icon: ShieldCheck,
    color: '#EC4899',
    description: 'Kiểm tra affiliate link gần đây có dấu hiệu lỗi.',
    message: 'Kiểm tra rủi ro affiliate link và nhắc tôi các bước cần rà soát hôm nay',
  },
  {
    id: 'offer_refresh',
    name: 'Offer Refresh',
    time: '09:00 thứ Sáu',
    intent: 'offer_find',
    icon: RefreshCw,
    color: '#3B82F6',
    description: 'Tìm offer mới có EPC hoặc hoa hồng tốt hơn.',
    message: 'Tìm offer mới có EPC cao hơn offer tôi đang dùng tuần này',
  },
  {
    id: 'monthly_strategy',
    name: 'Monthly Strategy',
    time: '09:00 ngày 1',
    intent: 'performance_review',
    icon: CalendarDays,
    color: '#8B5CF6',
    description: 'Đánh giá tháng trước và lập hướng content tháng tới.',
    message: 'Phân tích tháng vừa rồi và lập kế hoạch content calendar cho tháng tới',
  },
];

const STATUS_LABELS: Record<JobStatus, string> = {
  running: 'Đang chạy',
  completed: 'Hoàn tất',
  failed: 'Lỗi',
  skipped: 'Bỏ qua',
};

const STATUS_CLASS: Record<JobStatus, string> = {
  running: 'badge-blue',
  completed: 'badge-green',
  failed: 'badge-rose',
  skipped: 'badge-amber',
};

function isAgenticPlan(plan?: string) {
  return plan === 'pro' || plan === 'business' || plan === 'enterprise';
}

function creditsLeft(user: SchedulerUser | null) {
  if (!user) return 0;
  if (user.credits_total === -1) return Number.POSITIVE_INFINITY;
  return Math.max(0, user.credits_total - user.credits_used);
}

function latestLogFor(logs: SchedulerLog[], jobId: string) {
  return logs.find(log => log.job_type === jobId);
}

function formatJobName(jobType: string) {
  return jobType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractSchedule(input: unknown): ScheduleResult | null {
  if (!input || typeof input !== 'object') return null;
  const data = input as Record<string, unknown>;
  if (Array.isArray(data.calendar)) return data as unknown as ScheduleResult;

  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).calendar)) {
      return value as unknown as ScheduleResult;
    }
  }

  return null;
}

function resultPreview(log: SchedulerLog) {
  if (log.error_msg) return log.error_msg;
  const preview = log.result?.content_preview;
  if (typeof preview === 'string' && preview.trim()) return preview.trim();
  const error = log.result?.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Không có preview';
}

export default function SchedulerPageClient({ user, profile, logs, drafts }: Props) {
  const router = useRouter();
  const deductCredit = useUserStore(state => state.deductCredit);
  const [fullAutopilot, setFullAutopilot] = useState(Boolean(user?.full_autopilot));
  const [savingAutopilot, setSavingAutopilot] = useState(false);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState(drafts);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [agentText, setAgentText] = useState('');

  const stats = useMemo(() => {
    const completed = logs.filter(log => log.status === 'completed').length;
    const failed = logs.filter(log => log.status === 'failed').length;
    const lastRun = logs[0]?.ran_at ? formatDistanceToNow(new Date(logs[0].ran_at), { addSuffix: true, locale: vi }) : 'Chưa có log';
    return { completed, failed, lastRun };
  }, [logs]);

  const remainingCredits = creditsLeft(user);
  const quietHours = user ? `${String(user.quiet_hours_start).padStart(2, '0')}:00-${String(user.quiet_hours_end).padStart(2, '0')}:00` : '23:00-06:00';
  const planEligible = isAgenticPlan(user?.plan);

  async function toggleFullAutopilot() {
    const next = !fullAutopilot;
    setSavingAutopilot(true);
    setFullAutopilot(next);
    try {
      await profileAPI.update({ full_autopilot: next });
      toast.success(next ? 'Đã bật full Auto-pilot' : 'Đã tắt full Auto-pilot');
      router.refresh();
    } catch (error) {
      setFullAutopilot(!next);
      toast.error((error as Error).message || 'Không thể cập nhật Auto-pilot');
    } finally {
      setSavingAutopilot(false);
    }
  }

  async function runAgentJob(job: JobConfig) {
    if (runningJob) return;
    setRunningJob(job.id);
    try {
      const result = await agentAPI.chat(job.message, job.intent);
      deductCredit();
      setAgentText(result.content);
      const parsedSchedule = extractSchedule(result.structured);
      if (parsedSchedule) setSchedule(parsedSchedule);
      if (result.intent === 'content_create') {
        window.dispatchEvent(new CustomEvent('affiliateai:content-created', {
          detail: { contentId: result.content_id ?? null },
        }));
      }
      toast.success(`${job.name} đã chạy xong`);
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message || 'Không thể chạy job');
    } finally {
      setRunningJob(null);
    }
  }

  async function createWeeklySchedule() {
    const scheduleJob: JobConfig = {
      ...JOBS[0],
      id: 'weekly_calendar',
      name: 'Tạo lịch tuần tới',
      intent: 'schedule_task',
      message: 'Lên kế hoạch content tuần tới theo niche, ưu tiên trend mới, offer tốt và khung giờ đăng tối ưu',
    };
    await runAgentJob(scheduleJob);
  }

  async function copyDraft(content: string) {
    await navigator.clipboard.writeText(content);
    toast.success('Đã copy draft');
  }

  async function markPosted(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from('content_history')
      .update({ was_posted: true, posted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      toast.error('Không thể đánh dấu đã đăng');
      return;
    }

    setDraftItems(items => items.filter(item => item.id !== id));
    toast.success('Đã đánh dấu draft là đã đăng');
    router.refresh();
  }

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-base font-bold text-tx-1">Auto-pilot Scheduler</h1>
          <p className="mt-0.5 text-xs text-tx-3">
            Điều khiển các job tự động tạo trend, draft, offer và báo cáo affiliate.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={createWeeklySchedule}
            disabled={Boolean(runningJob)}
            className="btn btn-primary gap-1.5"
          >
            {runningJob === 'weekly_calendar' ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
            Tạo lịch tuần tới
          </button>
          <button
            type="button"
            onClick={toggleFullAutopilot}
            disabled={savingAutopilot}
            className={clsx('btn gap-1.5', fullAutopilot ? 'btn-primary' : 'btn-ghost')}
          >
            {savingAutopilot ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {fullAutopilot ? 'Full Auto-pilot ON' : 'Approve trước khi đăng'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {[
          { label: 'Plan', value: user?.plan ?? 'free', sub: planEligible ? 'Agentic loop sẵn sàng' : 'Cần Pro trở lên', color: planEligible ? '#10B981' : '#F59E0B' },
          { label: 'Credits', value: remainingCredits === Number.POSITIVE_INFINITY ? '∞' : String(remainingCredits), sub: `${user?.credits_used ?? 0} đã dùng`, color: '#818CF8' },
          { label: 'Niche', value: profile?.niche_primary ?? 'Chưa đặt', sub: (profile?.active_networks ?? []).join(', ') || 'Chưa chọn network', color: '#14B8A6' },
          { label: 'Quiet hours', value: quietHours, sub: 'Không chạy job nhạy cảm', color: '#EC4899' },
          { label: 'Lần chạy gần nhất', value: stats.lastRun, sub: `${stats.completed} hoàn tất, ${stats.failed} lỗi`, color: '#3B82F6' },
        ].map(item => (
          <div key={item.label} className="rounded-lg border border-bdr-1 bg-bg-2 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-tx-4">{item.label}</p>
            <p className="mt-2 truncate text-lg font-extrabold" style={{ color: item.color }}>{item.value}</p>
            <p className="mt-1 truncate text-[11px] text-tx-3">{item.sub}</p>
          </div>
        ))}
      </div>

      {!planEligible && (
        <div className="rounded-lg border border-amber/25 bg-amber/10 p-3 text-xs text-amber-light">
          Các job agentic loop tự động chỉ chạy cho gói Pro, Business hoặc Enterprise. Bạn vẫn có thể chạy thủ công bằng các nút trên trang này.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-tx-1">Lịch job tự động</h2>
              <span className="text-[11px] text-tx-4">Giờ Việt Nam</span>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {JOBS.map(job => {
                const Icon = job.icon;
                const latest = latestLogFor(logs, job.id);
                const isRunning = runningJob === job.id;
                return (
                  <div key={job.id} className="rounded-lg border border-bdr-1 bg-bg-2 p-4 transition-colors hover:border-bdr-2">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ color: job.color, background: `${job.color}1A` }}>
                        <Icon size={19} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-bold text-tx-1">{job.name}</p>
                          {latest && (
                            <span className={clsx('badge text-[9px]', STATUS_CLASS[latest.status])}>
                              {STATUS_LABELS[latest.status]}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-tx-4">
                          <Clock size={12} />
                          {job.time}
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-tx-3">{job.description}</p>
                        {latest?.ran_at && (
                          <p className="mt-2 text-[11px] text-tx-4">
                            Chạy gần nhất: {formatDistanceToNow(new Date(latest.ran_at), { addSuffix: true, locale: vi })}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-bdr-1 pt-3">
                      <span className="text-[11px] text-tx-4">
                        {latest?.duration_ms ? `${(latest.duration_ms / 1000).toFixed(1)}s` : 'Chưa có duration'}
                      </span>
                      <button
                        type="button"
                        onClick={() => runAgentJob(job)}
                        disabled={Boolean(runningJob)}
                        className="btn btn-ghost btn-sm gap-1.5"
                      >
                        {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                        Chạy thử
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {schedule?.calendar?.length ? (
            <div className="rounded-lg border border-bdr-1 bg-bg-2 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-tx-1">Content calendar AI đề xuất</h2>
                  <p className="text-[11px] text-tx-4">
                    {schedule.weekly_summary?.total_posts ?? schedule.calendar.reduce((sum, day) => sum + day.posts.length, 0)} bài · Reach dự kiến {schedule.weekly_summary?.estimated_weekly_reach ?? 'N/A'}
                  </p>
                </div>
                <button type="button" onClick={() => setSchedule(null)} className="btn btn-ghost btn-sm">
                  Ẩn lịch
                </button>
              </div>

              <div className="space-y-3">
                {schedule.calendar.map(day => (
                  <div key={day.date} className="rounded-lg border border-bdr-1 bg-bg-3 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-tx-2">{day.day_of_week}</p>
                      <span className="text-[11px] text-tx-4">{day.date}</span>
                    </div>
                    <div className="space-y-2">
                      {day.posts.map((post, index) => (
                        <div key={`${day.date}-${index}`} className="grid grid-cols-[58px_minmax(0,1fr)_72px] items-start gap-2 text-xs">
                          <span className="font-semibold text-brand-lighter">{post.scheduled_time}</span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-tx-2">{post.product || post.content_type}</p>
                            <p className="line-clamp-1 text-[11px] text-tx-4">{post.angle}</p>
                          </div>
                          <span className={clsx('badge justify-center text-[9px]', post.priority === 'high' ? 'badge-green' : 'badge-blue')}>
                            {post.platform}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : agentText ? (
            <div className="rounded-lg border border-bdr-1 bg-bg-2 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-tx-1">Kết quả agent gần nhất</h2>
                <button type="button" onClick={() => setAgentText('')} className="btn btn-ghost btn-sm">Ẩn</button>
              </div>
              <div className="rounded-lg border border-bdr-1 bg-bg-3 p-3 text-xs">
                <MarkdownMessage content={agentText} />
              </div>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-bdr-1 bg-bg-2">
            <div className="flex items-center justify-between border-b border-bdr-1 px-4 py-3">
              <h2 className="text-sm font-bold text-tx-1">Draft cần duyệt</h2>
              <span className="badge badge-blue text-[9px]">{draftItems.length}</span>
            </div>

            <div className="divide-y divide-bdr-1">
              {draftItems.length === 0 ? (
                <div className="p-5 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-DEFAULT/10 text-emerald-light">
                    <Check size={18} />
                  </div>
                  <p className="text-xs font-semibold text-tx-2">Không có draft chờ duyệt</p>
                  <p className="mt-1 text-[11px] text-tx-4">Content mới từ Auto-pilot sẽ hiện tại đây.</p>
                </div>
              ) : (
                draftItems.map(item => (
                  <div key={item.id} className="p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-brand-lighter">{item.platform}</span>
                      {item.quality_score ? (
                        <span className={clsx('badge text-[9px]', item.quality_score >= 80 ? 'badge-green' : 'badge-amber')}>
                          {item.quality_score}/100
                        </span>
                      ) : null}
                      <span className="ml-auto text-[10px] text-tx-4">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: vi })}
                      </span>
                    </div>
                    <p className="line-clamp-3 text-xs leading-relaxed text-tx-2">{item.content}</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => copyDraft(item.content)} className="btn btn-ghost btn-sm flex-1 gap-1.5">
                        <Clipboard size={12} />
                        Copy
                      </button>
                      <button type="button" onClick={() => markPosted(item.id)} className="btn btn-primary btn-sm flex-1 gap-1.5">
                        <Check size={12} />
                        Đã đăng
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-bdr-1 bg-bg-2">
            <div className="flex items-center justify-between border-b border-bdr-1 px-4 py-3">
              <h2 className="text-sm font-bold text-tx-1">Log gần đây</h2>
              <span className="text-[11px] text-tx-4">24 lượt mới nhất</span>
            </div>

            <div className="max-h-[520px] divide-y divide-bdr-1 overflow-y-auto scrollbar-thin">
              {logs.length === 0 ? (
                <div className="p-5 text-center text-xs text-tx-4">Chưa có scheduler log.</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={clsx('badge text-[9px]', STATUS_CLASS[log.status])}>
                        {STATUS_LABELS[log.status]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-tx-2">
                        {formatJobName(log.job_type)}
                      </span>
                      <span className="text-[10px] text-tx-4">
                        {format(new Date(log.ran_at), 'HH:mm dd/MM')}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-tx-4">{resultPreview(log)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
