'use client';
// apps/web/src/components/layout/Topbar.tsx

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUIStore, useUserStore } from '@/lib/store';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface Props {
  user?: { email?: string; plan?: string } | null;
}

export default function Topbar({ user }: Props) {
  const router = useRouter();
  const { setAgentDrawer, setSidebarCollapsed, sidebarCollapsed } = useUIStore();
  const clearUser = useUserStore(s => s.clear);
  const [apOn, setApOn] = React.useState(true);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearUser();
    router.push('/auth/login');
  }

  function toggleAP() {
    setApOn(!apOn);
    toast.success(apOn ? '⚠️ Auto-pilot đã tắt' : '✅ Auto-pilot ON — AI tự động chạy!');
  }

  const initials = user?.email?.[0]?.toUpperCase() ?? 'U';

  return (
    <header className="h-12 bg-bg-1 border-b border-bdr-1 flex items-center px-4 gap-3 flex-shrink-0 z-10">
      {/* Collapse sidebar */}
      <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="btn btn-ghost btn-icon text-tx-3 hover:text-tx-1">
        ☰
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Auto-pilot toggle */}
      <button onClick={toggleAP}
        className={clsx('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-all',
          apOn
            ? 'bg-emerald-light/5 border-emerald-light/20 text-emerald-light'
            : 'bg-bg-3 border-bdr-2 text-tx-3')}>
        <span className={clsx('w-1.5 h-1.5 rounded-full',
          apOn ? 'bg-emerald-light animate-pulse-slow' : 'bg-tx-4')} />
        Auto-pilot {apOn ? 'ON' : 'OFF'}
      </button>

      {/* Create content */}
      <button onClick={() => setAgentDrawer(true)}
        className="btn btn-primary gap-1.5">
        <span>✦</span> Tạo Content
      </button>

      {/* User menu */}
      <div className="relative group">
        <button className="w-7 h-7 rounded-full bg-gradient-to-br from-brand to-rose-light
                           flex items-center justify-center text-xs font-bold cursor-pointer">
          {initials}
        </button>
        {/* Dropdown */}
        <div className="absolute right-0 top-full mt-2 w-48 bg-bg-2 border border-bdr-2 rounded-xl
                        shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible
                        transition-all duration-150 py-1 z-50">
          <div className="px-3 py-2 border-b border-bdr-1">
            <p className="text-xs font-medium truncate">{user?.email}</p>
            <p className="text-[11px] text-amber-light font-semibold capitalize">{user?.plan}</p>
          </div>
          <button onClick={() => router.push('/dashboard/settings')}
            className="w-full text-left px-3 py-2 text-xs text-tx-2 hover:bg-bg-3 hover:text-tx-1 transition-colors">
            ⚙️ Cài đặt
          </button>
          <button onClick={() => router.push('/dashboard/upgrade')}
            className="w-full text-left px-3 py-2 text-xs text-amber-light hover:bg-bg-3 transition-colors">
            ⊕ Nâng cấp gói
          </button>
          <div className="border-t border-bdr-1 mt-1" />
          <button onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-xs text-rose-light hover:bg-bg-3 transition-colors">
            ↪ Đăng xuất
          </button>
        </div>
      </div>
    </header>
  );
}

// Need React import for useState
import React, { useState } from 'react';
