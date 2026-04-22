// apps/web/src/types/index.ts

export interface ContentBundle {
  [platform: string]: {
    platform:          string;
    content:           string;
    hashtags?:         string[];
    cta:               string;
    best_posting_time?: string;
    quality_score?:    number;
  };
}

export interface VisualAssets {
  facebook_banner?:     string;
  tiktok_thumbnail?:    string;
  tiktok_video?:        string;
  instagram_carousel?:  string | string[];
  youtube_thumbnail?:   string;
  zalo_image?:          string;
  subtitle_srt?:        string;
}

export interface User {
  id:              string;
  email:           string;
  plan:            'free' | 'starter' | 'pro' | 'business' | 'enterprise';
  credits_total:   number;
  credits_used:    number;
  full_autopilot:  boolean;
}

export interface AffiliateProfile {
  user_id:           string;
  niche_primary:     string | null;
  niche_secondary:   string[];
  preferred_tone:    string;
  language_style:    string;
  active_networks:   string[];
  best_posting_hrs:  Record<string, number[]>;
  avg_quality_score: number | null;
}

export interface Offer {
  id:             string;
  network:        string;
  product_name:   string;
  commission_pct: number;
  epc_estimate:   number;
  price:          number;
  rating:         number;
  sold_count:     number;
  image_url:      string;
  affiliate_url:  string;
  match_score:    number;
  why_recommended: string;
}
