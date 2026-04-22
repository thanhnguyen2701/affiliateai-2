// packages/shared/src/types.ts
// ─── Shared types cho toàn project ───────────────────────────────────────────

// ── PLANS ─────────────────────────────────────────────────────────────────────
export type Plan = 'free' | 'starter' | 'pro' | 'business' | 'enterprise';

export const PLAN_CREDITS: Record<Plan, number> = {
  free: 10, starter: 100, pro: 500, business: -1, enterprise: -1,
};

export const PLAN_PRICES_VND: Record<Plan, number> = {
  free: 0, starter: 149_000, pro: 399_000, business: 999_000, enterprise: 0,
};

export const PLAN_FEATURES: Record<Plan, {
  visual_images_month: number;
  visual_videos_month: number;
  agentic_loop: boolean;
  voice_ai: boolean;
  white_label: boolean;
  max_kb_mb: number;
}> = {
  free:       { visual_images_month: 0,   visual_videos_month: 0,  agentic_loop: false, voice_ai: false, white_label: false, max_kb_mb: 10   },
  starter:    { visual_images_month: 50,  visual_videos_month: 10, agentic_loop: false, voice_ai: false, white_label: false, max_kb_mb: 100  },
  pro:        { visual_images_month: 200, visual_videos_month: 50, agentic_loop: true,  voice_ai: true,  white_label: false, max_kb_mb: 500  },
  business:   { visual_images_month: -1,  visual_videos_month: -1, agentic_loop: true,  voice_ai: true,  white_label: true,  max_kb_mb: 2000 },
  enterprise: { visual_images_month: -1,  visual_videos_month: -1, agentic_loop: true,  voice_ai: true,  white_label: true,  max_kb_mb: -1   },
};

// ── AFFILIATE ─────────────────────────────────────────────────────────────────
export type AffiliateNetwork = 'shopee' | 'tiktok' | 'accesstrade' | 'rentracks' | 'lazada';
export type Platform = 'tiktok' | 'facebook' | 'instagram' | 'blog' | 'youtube' | 'zalo' | 'email';
export type Niche = 'beauty' | 'fashion' | 'food' | 'tech' | 'home' | 'health' | 'finance' | 'education' | 'travel' | 'other';
export type Tone = 'friendly' | 'professional' | 'funny' | 'inspiring';
export type LanguageStyle = 'bắc' | 'nam' | 'trung' | 'neutral';

// ── USER ──────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  plan: Plan;
  credits_total: number;
  credits_used: number;
  full_autopilot: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AffiliateProfile {
  user_id: string;
  niche_primary: Niche | null;
  niche_secondary: Niche[];
  preferred_tone: Tone;
  language_style: LanguageStyle;
  active_networks: AffiliateNetwork[];
  best_posting_hrs: Record<string, number[]>;
  top_formats: Record<Platform, string>;
  avoided_words: string[];
  avg_quality_score: number | null;
  total_content_made: number;
}

export interface BrandKit {
  user_id: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string | null;
  watermark_pos: string;
  watermark_opacity: number;
  style_keywords: string[];
  avoid_keywords: string[];
}

// ── PRODUCT ───────────────────────────────────────────────────────────────────
export interface ProductInfo {
  name: string;
  niche: Niche;
  affiliate_link: string;
  network: AffiliateNetwork;
  price?: number;
  sale_price?: number;
  discount_pct?: number;
  rating?: number;
  sold_count?: number;
  usp?: string;
  description?: string;
  specs?: Record<string, string>;
  promotion?: { discount: number; label: string; deadline?: string };
  images?: string[];
  social_proof?: string;
}

// ── AGENT ─────────────────────────────────────────────────────────────────────
export type AgentIntent =
  | 'content_create' | 'trend_research' | 'offer_find'
  | 'performance_review' | 'customer_reply' | 'schedule_task'
  | 'product_research' | 'bulk_content' | 'voice_query'
  | 'optimize_channel' | 'competitor_analysis' | 'onboarding';

export interface AgentInput {
  user_id: string;
  user_message: string;
  intent?: AgentIntent;
  context?: AgentContext;
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  user_profile?: AffiliateProfile;
  brand_kit?: BrandKit;
  product_info?: ProductInfo;
  recent_episodes?: EpisodicEvent[];
  retrieved_knowledge?: KnowledgeChunk[];
}

export interface AgentOutput {
  success: boolean;
  intent: AgentIntent;
  content?: string;
  structured_data?: Record<string, unknown>;
  quality_score?: number;
  tokens_used?: number;
  error?: string;
}

// ── CONTENT ───────────────────────────────────────────────────────────────────
export interface PlatformContent {
  platform: Platform;
  content: string;
  hashtags?: string[];
  cta: string;
  best_posting_time?: string;
  quality_score?: number;
}

export type ContentBundle = Partial<Record<Platform, PlatformContent>>;

// ── MEMORY ────────────────────────────────────────────────────────────────────
export type EpisodicEventType =
  | 'content_created' | 'content_approved' | 'content_rejected'
  | 'offer_clicked' | 'reply_sent' | 'trend_viewed'
  | 'visual_created' | 'performance_checked' | 'schedule_triggered';

export interface EpisodicEvent {
  id: string;
  user_id: string;
  event_type: EpisodicEventType;
  event_data: Record<string, unknown>;
  outcome: {
    user_rating?: number;
    was_edited?: boolean;
    regen_count?: number;
    time_to_approve_s?: number;
    ctr?: number;
    conversion?: number;
  };
  created_at: string;
  expires_at: string;
}

export interface KnowledgeChunk {
  id: string;
  chunk_text: string;
  similarity: number;
  kb_type: string;
  source_name: string | null;
  metadata: Record<string, unknown>;
}

// ── VISUAL ────────────────────────────────────────────────────────────────────
export type VisualPipeline = 'A' | 'B' | 'C' | 'A+C';

export interface VisualJobInput {
  pipeline: VisualPipeline;
  source_type: 'photo_upload' | 'shopee_url' | 'lazada_url' | 'raw_video';
  source_url?: string;
  source_path?: string;
  product_info: ProductInfo;
  platforms: Platform[];
  brand_kit: BrandKit;
}

export interface VisualAssets {
  facebook_banner?: string;
  tiktok_thumbnail?: string;
  instagram_carousel?: string[];
  youtube_thumbnail?: string;
  tiktok_video?: string;
  subtitle_srt?: string;
  zalo_image?: string;
}

// ── API ───────────────────────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: {
    credits_used?: number;
    credits_remaining?: number;
    request_id?: string;
    duration_ms?: number;
  };
}

// ── SCHEDULER ─────────────────────────────────────────────────────────────────
export type SchedulerJobType =
  | 'morning_trend_scan' | 'content_autopilot'
  | 'engagement_monitor' | 'link_health_check'
  | 'weekly_report' | 'offer_refresh' | 'monthly_strategy';
