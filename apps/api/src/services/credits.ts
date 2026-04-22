// apps/api/src/services/credits.ts
// Credits management + ZaloPay payment integration

import crypto from 'crypto';
import { getSupabase } from '../lib/supabase.js';
import type { Plan, User } from '../../../packages/shared/src/types.js';

const db = () => getSupabase();

const PLAN_CREDITS_MAP: Record<Plan, number> = {
  free: 10, starter: 100, pro: 500, business: -1, enterprise: -1,
};

// ─── Credits ──────────────────────────────────────────────────────────────────
export async function checkCredits(userId: string, needed = 1): Promise<{
  allowed: boolean; remaining: number; is_unlimited: boolean;
}> {
  const { data: user } = await db()
    .from('users').select('credits_total, credits_used, plan').eq('id', userId).single();

  if (!user) throw new Error('User not found');

  if (user.credits_total === -1) return { allowed: true, remaining: 99999, is_unlimited: true };

  const remaining = user.credits_total - user.credits_used;
  return { allowed: remaining >= needed, remaining, is_unlimited: false };
}

export async function deductCredits(userId: string, amount = 1): Promise<void> {
  const { error } = await db().rpc('increment_credits_used', {
    p_user_id: userId, p_amount: amount,
  }).catch(() => ({ error: null }));

  if (error) {
    // Fallback: manual update
    const { data: u } = await db().from('users').select('credits_used').eq('id', userId).single();
    if (u) {
      await db().from('users').update({ credits_used: u.credits_used + amount }).eq('id', userId);
    }
  }
}

export async function resetMonthlyCredits(userId: string): Promise<void> {
  const { data: user } = await db().from('users').select('plan').eq('id', userId).single();
  if (!user) return;
  const newTotal = PLAN_CREDITS_MAP[user.plan as Plan];
  await db().from('users').update({ credits_used: 0, credits_total: newTotal }).eq('id', userId);
}

// ─── ZaloPay ──────────────────────────────────────────────────────────────────
const ZALOPAY_URL    = process.env.ZALOPAY_URL ?? 'https://sb-openapi.zalopay.vn/v2/create';
const ZALOPAY_VERIFY = 'https://sb-openapi.zalopay.vn/v2/query';

function zaloSign(data: string): string {
  return crypto.createHmac('sha256', process.env.ZALOPAY_KEY1!)
    .update(data).digest('hex');
}

export const PLAN_PRICES: Record<Plan, number> = {
  free: 0, starter: 149_000, pro: 399_000, business: 999_000, enterprise: 0,
};

export async function createZaloPayOrder(params: {
  userId:    string;
  plan:      Plan;
  userEmail: string;
}): Promise<{ order_url: string; app_trans_id: string } | null> {
  const { userId, plan, userEmail } = params;
  const amount = PLAN_PRICES[plan];
  if (!amount) return null;

  const now       = new Date();
  const yymmdd    = now.toISOString().slice(2, 10).replace(/-/g, '');
  const transId   = `${yymmdd}_affiliateai_${Date.now()}`;
  const appId     = process.env.ZALOPAY_APP_ID!;

  const embedData = JSON.stringify({
    redirecturl: `${process.env.APP_URL}/payment/success`,
    user_id: userId, plan,
  });

  const orderData = {
    app_id:       appId,
    app_trans_id: transId,
    app_user:     userEmail,
    app_time:     Date.now(),
    amount,
    item:         JSON.stringify([{ itemid: plan, itemname: `AffiliateAI ${plan}`, itemprice: amount, itemquantity: 1 }]),
    description:  `AffiliateAI - Nâng cấp ${plan}`,
    embed_data:   embedData,
    bank_code:    '',
    callback_url: process.env.ZALOPAY_CALLBACK_URL!,
  };

  const signStr = `${appId}|${transId}|${userEmail}|${amount}|${Date.now()}|${embedData}|${orderData.item}`;
  const mac     = zaloSign(signStr);

  try {
    const res  = await fetch(ZALOPAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...orderData as any, mac }).toString(),
    });
    const data = await res.json() as { return_code: number; order_url?: string };

    if (data.return_code === 1 && data.order_url) {
      return { order_url: data.order_url, app_trans_id: transId };
    }
  } catch (err) {
    console.error('[ZaloPay] createOrder failed:', err);
  }

  return null;
}

// Verify ZaloPay callback
export function verifyZaloPayCallback(data: Record<string, string>, mac: string): boolean {
  const { app_id, app_trans_id, app_time, amount, embed_data, item } = data;
  const checkStr = `${app_id}|${app_trans_id}|${app_time}|${amount}|${embed_data}|${item}`;
  return zaloSign(checkStr) === mac;
}

// Handle successful payment → upgrade user plan
export async function handlePaymentSuccess(
  userId: string, plan: Plan
): Promise<void> {
  const credits = PLAN_CREDITS_MAP[plan];
  await db().from('users').update({
    plan,
    credits_total: credits,
    credits_used:  0,
    updated_at:    new Date().toISOString(),
  }).eq('id', userId);

  console.info(`[Payment] User ${userId} upgraded to ${plan}`);
}
