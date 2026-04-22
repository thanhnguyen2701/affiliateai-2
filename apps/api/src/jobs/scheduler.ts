// apps/api/src/jobs/scheduler.ts
// Agentic Loop — 7 cron jobs tự động hàng ngày

import { Inngest } from 'inngest';
import { createClient } from '@supabase/supabase-js';
import { orchestrate } from '../agents/index.js';
import type { SchedulerJobType } from '../../../packages/shared/src/types.js';

const inngest = new Inngest({ id: 'affiliateai' });
const db = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// ─── Helper: log job run ──────────────────────────────────────────────────────
async function logJob(
  userId: string | null, jobType: SchedulerJobType,
  status: 'completed' | 'failed' | 'skipped', result: unknown, durationMs?: number
) {
  await db().from('scheduler_logs').insert({
    user_id: userId, job_type: jobType, status,
    result: result as object, duration_ms: durationMs,
  }).catch(console.error);
}

// ─── Helper: get all active users ────────────────────────────────────────────
async function getActiveUsers(feature?: 'agentic_loop') {
  let q = db().from('users').select('id, plan, full_autopilot')
    .eq('is_active', true)
    .neq('plan', 'free');

  if (feature === 'agentic_loop') {
    q = q.in('plan', ['pro', 'business', 'enterprise']);
  }

  const { data } = await q;
  return data ?? [];
}

// ─── Helper: check quiet hours ────────────────────────────────────────────────
async function isQuietHours(userId: string): Promise<boolean> {
  const { data: user } = await db().from('users')
    .select('quiet_hours_start, quiet_hours_end').eq('id', userId).single();
  if (!user) return false;

  const hour = new Date().getHours(); // UTC+7 adjustment needed in production
  const { quiet_hours_start: start, quiet_hours_end: end } = user;

  if (start > end) return hour >= start || hour < end;  // spans midnight
  return hour >= start && hour < end;
}

// ─── Helper: send notification ────────────────────────────────────────────────
async function notifyUser(userId: string, message: string, type: string) {
  // TODO: integrate Zalo OA / email notification
  console.info(`[Notify] user=${userId} type=${type}: ${message.slice(0, 100)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// JOB 1: MORNING TREND SCAN — 6:00 AM daily
// ═══════════════════════════════════════════════════════════════════════════════
export const morningTrendScan = inngest.createFunction(
  { id: 'morning-trend-scan', name: 'Morning Trend Scan' },
  { cron: '0 23 * * *' }, // UTC 23:00 = VN 06:00 (UTC+7)
  async ({ step }) => {
    const t0 = Date.now();
    const users = await step.run('get-users', () => getActiveUsers('agentic_loop'));

    await Promise.allSettled(users.map(user =>
      step.run(`scan-${user.id}`, async () => {
        if (await isQuietHours(user.id)) return;

        try {
          const result = await orchestrate({
            user_id:      user.id,
            user_message: 'Tìm top 5 sản phẩm đang trending hôm nay, gợi ý tôi nên làm content về gì',
            intent:       'trend_research',
          });

          if (result.success && result.content) {
            await notifyUser(user.id, `🌅 Trend hôm nay:\n${result.content.slice(0, 300)}`, 'morning_trends');
          }

          await logJob(user.id, 'morning_trend_scan', 'completed', { content_preview: result.content?.slice(0, 200) }, Date.now() - t0);
        } catch (err) {
          await logJob(user.id, 'morning_trend_scan', 'failed', { error: (err as Error).message }, Date.now() - t0);
        }
      })
    ));

    return { scanned: users.length };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// JOB 2: CONTENT AUTOPILOT — 7:00 AM daily
// ═══════════════════════════════════════════════════════════════════════════════
export const contentAutopilot = inngest.createFunction(
  { id: 'content-autopilot', name: 'Content Autopilot' },
  { cron: '0 0 * * *' }, // UTC 00:00 = VN 07:00
  async ({ step }) => {
    const t0 = Date.now();
    const users = await step.run('get-users', () => getActiveUsers('agentic_loop'));

    await Promise.allSettled(users.map(user =>
      step.run(`autopilot-${user.id}`, async () => {
        if (await isQuietHours(user.id)) return;

        // Check credits còn không
        const { data: u } = await db().from('users').select('credits_total, credits_used').eq('id', user.id).single();
        if (!u) return;
        const creditsLeft = u.credits_total === -1 ? 999 : u.credits_total - u.credits_used;
        if (creditsLeft < 3) {
          await notifyUser(user.id, '⚠️ Credits sắp hết, không thể tự động tạo content. Nạp thêm nhé!', 'low_credits');
          return;
        }

        try {
          // Tạo draft cho 3 sản phẩm hot nhất
          const trendResult = await orchestrate({
            user_id:      user.id,
            user_message: 'Gợi ý 3 sản phẩm nên làm content hôm nay, niche của tôi',
            intent:       'trend_research',
          });

          const contentResult = await orchestrate({
            user_id:      user.id,
            user_message: `Tạo draft content cho TikTok và Facebook dựa trên: ${trendResult.content?.slice(0, 300) ?? 'sản phẩm hot hôm nay'}`,
            intent:       'content_create',
          });

          if (contentResult.success) {
            // Nếu full_autopilot = false → gửi để approve
            const msg = user.full_autopilot
              ? `✅ Đã tự động tạo và lên lịch content hôm nay!`
              : `📝 Draft content đã sẵn sàng! Vào app để xem và approve.`;
            await notifyUser(user.id, msg, 'content_draft');
          }

          await logJob(user.id, 'content_autopilot', 'completed', { success: contentResult.success }, Date.now() - t0);
        } catch (err) {
          await logJob(user.id, 'content_autopilot', 'failed', { error: (err as Error).message }, Date.now() - t0);
        }
      })
    ));

    return { processed: users.length };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// JOB 3: ENGAGEMENT MONITOR — 7:00 PM daily (19:30 VN)
// ═══════════════════════════════════════════════════════════════════════════════
export const engagementMonitor = inngest.createFunction(
  { id: 'engagement-monitor', name: 'Engagement Monitor' },
  { cron: '30 12 * * *' }, // UTC 12:30 = VN 19:30
  async ({ step }) => {
    // TODO: integrate với Facebook/TikTok API để lấy inbox cần reply
    // Hiện tại: remind user check inbox
    const users = await step.run('get-users', () => getActiveUsers());

    for (const user of users.slice(0, 50)) {
      await step.run(`remind-${user.id}`, async () => {
        await notifyUser(
          user.id,
          '💬 Đây là giờ vàng tương tác! Kiểm tra comment/inbox và dùng AI để reply nhanh.',
          'engagement_reminder'
        );
      });
    }

    return { reminded: Math.min(users.length, 50) };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// JOB 4: WEEKLY REPORT — Monday 8:00 AM
// ═══════════════════════════════════════════════════════════════════════════════
export const weeklyReport = inngest.createFunction(
  { id: 'weekly-report', name: 'Weekly Performance Report' },
  { cron: '0 1 * * 1' }, // UTC 01:00 Monday = VN 08:00 Monday
  async ({ step }) => {
    const t0 = Date.now();
    const users = await step.run('get-users', () => getActiveUsers());

    await Promise.allSettled(users.map(user =>
      step.run(`report-${user.id}`, async () => {
        try {
          const result = await orchestrate({
            user_id:      user.id,
            user_message: 'Tổng hợp hiệu suất tuần qua: content nào tốt, kênh nào hiệu quả, 5 việc cần làm tuần tới',
            intent:       'performance_review',
          });

          if (result.success && result.content) {
            await notifyUser(user.id, `📊 Báo cáo tuần:\n${result.content.slice(0, 400)}`, 'weekly_report');
          }

          await logJob(user.id, 'weekly_report', 'completed', {}, Date.now() - t0);
        } catch (err) {
          await logJob(user.id, 'weekly_report', 'failed', { error: (err as Error).message }, Date.now() - t0);
        }
      })
    ));

    return { reported: users.length };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// JOB 5: LINK HEALTH CHECK — 10:00 PM daily
// ═══════════════════════════════════════════════════════════════════════════════
export const linkHealthCheck = inngest.createFunction(
  { id: 'link-health-check', name: 'Affiliate Link Health Check' },
  { cron: '0 15 * * *' }, // UTC 15:00 = VN 22:00
  async ({ step }) => {
    // Check các affiliate link trong content_history còn hoạt động không
    const { data: recentContent } = await db()
      .from('content_history')
      .select('user_id, affiliate_link')
      .not('affiliate_link', 'is', null)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(200);

    const dead: string[] = [];
    await Promise.allSettled((recentContent ?? []).map(async (row) => {
      if (!row.affiliate_link) return;
      try {
        const res = await fetch(row.affiliate_link, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if (!res.ok && res.status !== 301 && res.status !== 302) {
          dead.push(row.affiliate_link);
          await notifyUser(row.user_id, `⚠️ Link có thể bị lỗi: ${row.affiliate_link}`, 'dead_link');
        }
      } catch {
        // timeout — ignore
      }
    }));

    return { checked: (recentContent ?? []).length, dead_links: dead.length };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// JOB 6: OFFER REFRESH — Friday 9:00 AM
// ═══════════════════════════════════════════════════════════════════════════════
export const offerRefresh = inngest.createFunction(
  { id: 'offer-refresh', name: 'Weekly Offer Refresh' },
  { cron: '0 2 * * 5' }, // UTC 02:00 Friday = VN 09:00 Friday
  async ({ step }) => {
    const t0 = Date.now();
    const users = await step.run('get-users', () => getActiveUsers('agentic_loop'));

    await Promise.allSettled(users.map(user =>
      step.run(`refresh-${user.id}`, async () => {
        try {
          const result = await orchestrate({
            user_id:      user.id,
            user_message: 'Tìm offer mới có EPC cao hơn offer tôi đang dùng tuần này',
            intent:       'offer_find',
          });

          if (result.success) {
            await notifyUser(user.id, `🎯 Offer mới tuần này:\n${result.content?.slice(0, 300) ?? ''}`, 'offer_refresh');
          }

          await logJob(user.id, 'offer_refresh', 'completed', {}, Date.now() - t0);
        } catch (err) {
          await logJob(user.id, 'offer_refresh', 'failed', { error: (err as Error).message }, Date.now() - t0);
        }
      })
    ));

    return { refreshed: users.length };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// JOB 7: MONTHLY STRATEGY — 1st of month, 9:00 AM
// ═══════════════════════════════════════════════════════════════════════════════
export const monthlyStrategy = inngest.createFunction(
  { id: 'monthly-strategy', name: 'Monthly Strategy Review' },
  { cron: '0 2 1 * *' }, // UTC 02:00 on 1st = VN 09:00
  async ({ step }) => {
    const t0 = Date.now();
    const users = await step.run('get-users', () => getActiveUsers());

    await Promise.allSettled(users.map(user =>
      step.run(`strategy-${user.id}`, async () => {
        try {
          const result = await orchestrate({
            user_id:      user.id,
            user_message: 'Phân tích tháng vừa rồi và lập kế hoạch content calendar cho tháng tới. Tập trung vào những gì hiệu quả nhất.',
            intent:       'performance_review',
          });

          if (result.success) {
            await notifyUser(user.id, `📅 Kế hoạch tháng mới:\n${result.content?.slice(0, 400) ?? ''}`, 'monthly_strategy');
          }

          await logJob(user.id, 'monthly_strategy', 'completed', {}, Date.now() - t0);
        } catch (err) {
          await logJob(user.id, 'monthly_strategy', 'failed', { error: (err as Error).message }, Date.now() - t0);
        }
      })
    ));

    return { processed: users.length };
  }
);

// ─── Export tất cả functions cho Inngest ─────────────────────────────────────
export const scheduledFunctions = [
  morningTrendScan,
  contentAutopilot,
  engagementMonitor,
  weeklyReport,
  linkHealthCheck,
  offerRefresh,
  monthlyStrategy,
];

export { inngest };
