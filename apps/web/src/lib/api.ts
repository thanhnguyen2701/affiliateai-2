// apps/web/src/lib/api.ts
// Typed API client cho backend Fastify

import { createClient } from './supabase/client';
import type { AgentOutput, ContentBundle, VisualAssets } from '../types';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Auth header ───────────────────────────────────────────────────────────────
async function authHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type':  'application/json',
  };
}

// ─── Base fetch ────────────────────────────────────────────────────────────────
async function apiFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, ...fetchOpts } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOpts.headers as Record<string, string> || {}),
  };
  if (auth) Object.assign(headers, await authHeader());

  const res = await fetch(`${BASE}${path}`, { ...fetchOpts, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  return data.data ?? data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════
export const authAPI = {
  register: (email: string, password: string) =>
    apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }), auth: false }),

  login: (email: string, password: string) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }), auth: false }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT
// ═══════════════════════════════════════════════════════════════════════════════
export interface ChatResponse {
  intent:        string;
  content:       string;
  structured:    ContentBundle | Record<string, unknown>;
  quality_score: number;
  meta: { credits_used: number; credits_remaining: number; duration_ms: number };
}

export const agentAPI = {
  chat: (message: string, intent?: string): Promise<ChatResponse> =>
    apiFetch('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message, intent }),
    }),

  rate: (content_id: string, rating: number) =>
    apiFetch('/api/content/rate', { method: 'POST', body: JSON.stringify({ content_id, rating }) }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════
export const profileAPI = {
  get: () => apiFetch('/api/profile'),

  update: (data: Record<string, unknown>) =>
    apiFetch('/api/profile', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// VISUAL
// ═══════════════════════════════════════════════════════════════════════════════
export interface VisualJob {
  id: string; pipeline: string; status: string;
  assets: VisualAssets; api_cost_vnd: number; created_at: string;
}

export const visualAPI = {
  createFromUrl: (product_url: string, platforms: string[], pipeline = 'B'): Promise<{ job_id: string }> =>
    apiFetch('/api/visual/from-url', { method: 'POST', body: JSON.stringify({ product_url, platforms, pipeline }) }),

  getJob: (id: string): Promise<VisualJob> =>
    apiFetch(`/api/visual/job/${id}`),

  getHistory: (): Promise<VisualJob[]> =>
    apiFetch('/api/visual/history'),

  uploadPhoto: async (file: File): Promise<{ job_id: string }> => {
    const headers = await authHeader();
    delete headers['Content-Type'];
    const form = new FormData();
    form.append('file', file);
    form.append('pipeline', 'A');
    const res = await fetch(`${BASE}/api/visual/upload`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = await res.json();
    return data.data;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// OFFERS
// ═══════════════════════════════════════════════════════════════════════════════
export const offersAPI = {
  getTop: () => apiFetch('/api/offers/top'),
};

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════
export const performanceAPI = {
  getSummary: (from?: string) =>
    apiFetch(`/api/performance/summary${from ? `?from=${from}` : ''}`),
};

// ═══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE
// ═══════════════════════════════════════════════════════════════════════════════
export const knowledgeAPI = {
  uploadText: (kb_type: string, source_name: string, content: string) =>
    apiFetch('/api/knowledge/upload-text', { method: 'POST', body: JSON.stringify({ kb_type, source_name, content }) }),

  ingestUrl: (url: string, kb_type = 'product') =>
    apiFetch('/api/knowledge/ingest-url', { method: 'POST', body: JSON.stringify({ url, kb_type }) }),

  list: () => apiFetch('/api/knowledge/list'),

  delete: (source: string) =>
    apiFetch(`/api/knowledge/${encodeURIComponent(source)}`, { method: 'DELETE' }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT
// ═══════════════════════════════════════════════════════════════════════════════
export const paymentAPI = {
  getPlans: () => apiFetch('/api/payment/plans', { auth: false }),

  createOrder: (plan: string): Promise<{ order_url: string; app_trans_id: string }> =>
    apiFetch('/api/payment/create', { method: 'POST', body: JSON.stringify({ plan }) }),
};
