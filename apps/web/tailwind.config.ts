// apps/web/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg:    { 0:'#060912', 1:'#0D1117', 2:'#161B27', 3:'#1E2535', 4:'#252D40', 5:'#2E3850' },
        bdr:   { 1:'#1F2937', 2:'#2D3748', 3:'#374151' },
        tx:    { 1:'#F9FAFB', 2:'#D1D5DB', 3:'#9CA3AF', 4:'#6B7280' },
        brand: { DEFAULT:'#6366F1', light:'#818CF8', lighter:'#A5B4FC' },
        teal:  { DEFAULT:'#0D9488', light:'#14B8A6' },
        emerald:{ DEFAULT:'#059669', light:'#10B981', lighter:'#34D399' },
        amber: { DEFAULT:'#D97706', light:'#F59E0B', lighter:'#FCD34D' },
        rose:  { DEFAULT:'#E11D48', light:'#F43F5E' },
      },
      fontFamily: { sans: ['Inter','system-ui','sans-serif'] },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':    'fadeIn .2s ease',
        'slide-up':   'slideUp .25s ease',
        'slide-in':   'slideIn .25s ease',
      },
      keyframes: {
        fadeIn:  { from:{ opacity:'0', transform:'translateY(4px)' }, to:{ opacity:'1', transform:'none' } },
        slideUp: { from:{ opacity:'0', transform:'translateY(8px)' }, to:{ opacity:'1', transform:'none' } },
        slideIn: { from:{ opacity:'0', transform:'translateX(8px)' }, to:{ opacity:'1', transform:'none' } },
      },
    },
  },
  plugins: [],
};
export default config;
