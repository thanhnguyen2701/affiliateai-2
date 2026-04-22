'use client';
// apps/web/src/components/layout/Sidebar.tsx

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/lib/store';
import clsx from 'clsx';

const NAV = [
  { section: 'Tổng quan', items: [
    { href: '/dashboard',          icon: '⬡', label: 'Dashboard' },
  ]},
  { section: 'AI Agent', items: [
    { href: '/dashboard/chat',     icon: '◈', label: 'Chat AI',     badge: 'Live', badgeClass: 'badge-green' },
    { href: '/dashboard/content',  icon: '≡', label: 'Content',     badge: '12',   badgeClass: 'badge-blue' },
    { href: '/dashboard/visual',   icon: '◎', label: 'Visual AI' },
  ]},
  { section: 'Kiếm tiền', items: [
    { href: '/dashboard/offers',   icon: '◇', label: 'Offers' },
    { href: '/dashboard/analytics',icon: '∿', label: 'Analytics' },
    { href: '/dashboard/scheduler',icon: '⟳', label: 'Auto-pilot',  badge: 'ON', badgeClass: 'badge-green' },
  ]},
  { section: 'Tài khoản', items: [
    { href: '/dashboard/settings', icon: '◑', label: 'Cài đặt AI' },
    { href: '/dashboard/upgrade',  icon: '⊕', label: 'Nâng cấp',   badge: '↑',  badgeClass: 'badge-amber' },
  ]},
];

interface Props {
  user?: { plan?: string; credits_total?: number; credits_used?: number } | null;
}

export default function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const { sidebarCollapsed } = useUIStore();

  const creditsUsed  = user?.credits_used  ?? 0;
  const creditsTotal = user?.credits_total ?? 10;
  const creditsPct   = creditsTotal === -1 ? 100 : (creditsUsed / creditsTotal) * 100;
  const creditsLeft  = creditsTotal === -1 ? '∞' : creditsTotal - creditsUsed;

  return (
    <aside className={clsx(
      'flex flex-col bg-bg-1 border-r border-bdr-1 transition-all duration-200 flex-shrink-0',
      sidebarCollapsed ? 'w-14' : 'w-[220px]'
    )}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-bdr-1 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand to-teal flex-shrink-0
                        flex items-center justify-center text-sm">🤖</div>
        {!sidebarCollapsed && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-sm whitespace-nowrap">AffiliateAI</span>
            <span className="badge badge-amber text-[9px] px-1.5 py-0 uppercase">
              {user?.plan ?? 'free'}
            </span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto no-scrollbar py-2">
        {NAV.map(section => (
          <div key={section.section}>
            {!sidebarCollapsed && (
              <p className="text-[10px] font-semibold text-tx-4 uppercase tracking-widest
                            px-4 py-2 mt-1">{section.section}</p>
            )}
            {section.items.map(item => {
              const active = pathname === item.href ||
                             (item.href !== '/dashboard' && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href}
                  className={clsx('nav-item', active && 'active')}>
                  <span className="text-sm flex-shrink-0">{item.icon}</span>
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className={clsx('badge text-[9px] px-1.5', item.badgeClass)}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Credits */}
      {!sidebarCollapsed && (
        <div className="p-3 border-t border-bdr-1 flex-shrink-0">
          <div className="bg-bg-2 border border-bdr-1 rounded-xl p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[11px] text-tx-3 font-medium">Credits tháng này</span>
              <span className="text-[11px] font-bold text-brand-lighter">
                {creditsLeft}/{creditsTotal === -1 ? '∞' : creditsTotal}
              </span>
            </div>
            <div className="h-1 bg-bg-4 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand to-teal rounded-full transition-all"
                   style={{ width: `${Math.min(100 - creditsPct, 100)}%` }} />
            </div>
            <p className="text-[10px] text-tx-4 mt-1.5">
              {creditsUsed} credits đã dùng
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
