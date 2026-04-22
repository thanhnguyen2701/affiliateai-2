// apps/web/src/app/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server';
import DashboardClient from './DashboardClient';

// Server Component — fetch data, pass to Client Component
export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch all dashboard data in parallel
  const [
    { data: perfData },
    { data: recentContent },
    { data: schedulerLogs },
    { data: visualJobs },
  ] = await Promise.all([
    supabase.from('performance_data')
      .select('*')
      .eq('user_id', user!.id)
      .gte('date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0])
      .order('date', { ascending: false })
      .limit(30),

    supabase.from('content_history')
      .select('id,platform,content,quality_score,user_rating,created_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(5),

    supabase.from('scheduler_logs')
      .select('job_type,status,ran_at,duration_ms')
      .eq('user_id', user!.id)
      .order('ran_at', { ascending: false })
      .limit(6),

    supabase.from('visual_jobs')
      .select('id,pipeline,status,assets,created_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  // Aggregate metrics
  const totalRevenue     = (perfData ?? []).reduce((s, r) => s + Number(r.revenue_vnd), 0);
  const totalClicks      = (perfData ?? []).reduce((s, r) => s + r.clicks, 0);
  const totalConversions = (perfData ?? []).reduce((s, r) => s + r.conversions, 0);
  const avgCTR           = totalClicks > 0
    ? ((totalConversions / totalClicks) * 100).toFixed(1)
    : '0.0';

  return (
    <DashboardClient
      metrics={{
        revenue:     totalRevenue,
        contentCount: (recentContent ?? []).length,
        avgCTR:      parseFloat(avgCTR),
        totalClicks,
        totalConversions,
      }}
      recentContent={recentContent ?? []}
      schedulerLogs={schedulerLogs ?? []}
      visualJobs={visualJobs ?? []}
    />
  );
}
