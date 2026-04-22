// apps/web/src/app/dashboard/visual/page.tsx
import { createClient } from '@/lib/supabase/server';
import VisualPageClient from './VisualPageClient';

export const metadata = { title: 'Visual AI — AffiliateAI' };

export default async function VisualPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch recent visual jobs
  const { data: jobs } = await supabase
    .from('visual_jobs')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(12);

  // Fetch brand kit
  const { data: brandKit } = await supabase
    .from('brand_kits')
    .select('*')
    .eq('user_id', user!.id)
    .single();

  return <VisualPageClient initialJobs={jobs ?? []} brandKit={brandKit} />;
}
