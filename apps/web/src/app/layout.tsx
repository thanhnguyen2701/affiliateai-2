// apps/web/src/app/layout.tsx
import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import './globals.css';

export const metadata: Metadata = {
  title:       'AffiliateAI — Trợ lý Affiliate Toàn Trình',
  description: 'AI Agent tự động hóa affiliate marketing: content, trend, offers, visual, analytics.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark">
      <body>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1E2535',
              color: '#F9FAFB',
              border: '1px solid #2D3748',
              fontSize: '12px',
              borderRadius: '10px',
            },
            success: { iconTheme: { primary: '#10B981', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#F43F5E', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  );
}
