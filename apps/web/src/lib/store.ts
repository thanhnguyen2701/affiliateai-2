// apps/web/src/lib/store.ts
// Global state với Zustand

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── User/Auth store ───────────────────────────────────────────────────────────
interface UserState {
  userId:        string | null;
  email:         string | null;
  plan:          string;
  creditsTotal:  number;
  creditsUsed:   number;
  fullAutopilot: boolean;
  setUser: (u: Partial<UserState>) => void;
  deductCredit:  () => void;
  clear:         () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      userId:        null,
      email:         null,
      plan:          'free',
      creditsTotal:  10,
      creditsUsed:   0,
      fullAutopilot: false,
      setUser: (u) => set((s) => ({ ...s, ...u })),
      deductCredit:  () => set((s) => ({ creditsUsed: s.creditsUsed + 1 })),
      clear: () => set({ userId: null, email: null, plan: 'free', creditsTotal: 10, creditsUsed: 0 }),
    }),
    { name: 'affiliateai-user' }
  )
);

// ─── UI state store ────────────────────────────────────────────────────────────
interface UIState {
  agentDrawerOpen: boolean;
  sidebarCollapsed: boolean;
  activePage: string;
  setAgentDrawer:    (open: boolean) => void;
  setSidebarCollapsed:(v: boolean) => void;
  setActivePage:     (p: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  agentDrawerOpen:  false,
  sidebarCollapsed: false,
  activePage:       'dashboard',
  setAgentDrawer:    (open)  => set({ agentDrawerOpen: open }),
  setSidebarCollapsed:(v)    => set({ sidebarCollapsed: v }),
  setActivePage:     (page)  => set({ activePage: page }),
}));

// ─── Chat history store ────────────────────────────────────────────────────────
export interface ChatMessage {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  timestamp: number;
  structured?: Record<string, unknown>;
  quality_score?: number;
  isTyping?: boolean;
}

interface ChatState {
  messages:    ChatMessage[];
  isLoading:   boolean;
  addMessage:  (m: Omit<ChatMessage, 'id'>) => string;
  updateMsg:   (id: string, updates: Partial<ChatMessage>) => void;
  removeMsg:   (id: string) => void;
  setLoading:  (v: boolean) => void;
  clearChat:   () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages:  [],
  isLoading: false,

  addMessage: (m) => {
    const id = crypto.randomUUID();
    set((s) => ({ messages: [...s.messages, { ...m, id }] }));
    return id;
  },

  updateMsg: (id, updates) =>
    set((s) => ({ messages: s.messages.map(m => m.id === id ? { ...m, ...updates } : m) })),

  removeMsg: (id) =>
    set((s) => ({ messages: s.messages.filter(m => m.id !== id) })),

  setLoading: (v) => set({ isLoading: v }),
  clearChat:  ()  => set({ messages: [] }),
}));

// ─── Profile store ─────────────────────────────────────────────────────────────
interface ProfileState {
  profile:    Record<string, unknown> | null;
  brandKit:   Record<string, unknown> | null;
  setProfile: (p: Record<string, unknown>) => void;
  setBrandKit:(b: Record<string, unknown>) => void;
}

export const useProfileStore = create<ProfileState>()((set) => ({
  profile:    null,
  brandKit:   null,
  setProfile: (p) => set({ profile: p }),
  setBrandKit:(b) => set({ brandKit: b }),
}));
