// apps/web/src/app/dashboard/layout.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/layout/Sidebar';
import Topbar  from '@/components/layout/Topbar';
import AgentDrawer from '@/components/agent/AgentDrawer';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Fetch user data from DB
  const { data: userData } = await supabase
    .from('users')
    .select('id, email, plan, credits_total, credits_used, full_autopilot')
    .eq('id', user.id)
    .single();

  return (
    <div className="flex h-screen overflow-hidden bg-bg-0">
      <Sidebar user={userData} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar user={userData} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </main>
      </div>
      <AgentDrawer />
    </div>
  );
}
