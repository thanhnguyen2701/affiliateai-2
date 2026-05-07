import { createClient } from '@/lib/supabase/server';
import SchedulerPageClient from './SchedulerPageClient';

export default async function SchedulerPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [
    { data: userData },
    { data: profile },
    { data: schedulerLogs },
    { data: drafts },
  ] = await Promise.all([
    supabase
      .from('users')
      .select('id,email,plan,credits_total,credits_used,full_autopilot,quiet_hours_start,quiet_hours_end')
      .eq('id', user!.id)
      .single(),

    supabase
      .from('affiliate_profiles')
      .select('niche_primary,active_networks,best_posting_hrs,avg_quality_score')
      .eq('user_id', user!.id)
      .single(),

    supabase
      .from('scheduler_logs')
      .select('id,job_type,status,result,error_msg,ran_at,duration_ms')
      .eq('user_id', user!.id)
      .order('ran_at', { ascending: false })
      .limit(25),

    supabase
      .from('content_history')
      .select('id,platform,content,quality_score,affiliate_network,affiliate_link,was_posted,created_at')
      .eq('user_id', user!.id)
      .eq('was_posted', false)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return (
    <SchedulerPageClient
      user={userData}
      profile={profile}
      logs={schedulerLogs ?? []}
      drafts={drafts ?? []}
    />
  );
}
