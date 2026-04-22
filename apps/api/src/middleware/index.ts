// apps/api/src/middleware/index.ts
// Auth + Error Handler + Rate Limit

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';

// ─── Auth middleware ──────────────────────────────────────────────────────────
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      error: { code: 'unauthorized', message: 'Missing or invalid Authorization header' }
    });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return reply.status(401).send({ success: false, error: { code: 'unauthorized', message: 'Invalid token' } });
  }

  // Verify với Supabase
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return reply.status(401).send({ success: false, error: { code: 'unauthorized', message: 'Token không hợp lệ hoặc đã hết hạn' } });
  }

  (req as any).userId = user.id;
  (req as any).userEmail = user.email;
}

// ─── Error handler ────────────────────────────────────────────────────────────
export function errorHandler(
  error: Error & { statusCode?: number; validation?: unknown[] },
  req: FastifyRequest,
  reply: FastifyReply
) {
  // Log
  req.log.error({
    err: { message: error.message, stack: error.stack },
    method: req.method, url: req.url,
    userId: (req as any).userId,
  });

  // Validation error (Zod / Fastify schema)
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: { code: 'validation_error', message: 'Dữ liệu đầu vào không hợp lệ', details: error.validation }
    });
  }

  // Known error types
  const known: Record<string, { status: number; code: string; message: string }> = {
    'Circuit breaker OPEN':  { status: 503, code: 'service_unavailable', message: 'Dịch vụ tạm thời không khả dụng, thử lại sau 60 giây.' },
    '429':                   { status: 429, code: 'rate_limited',         message: 'Quá nhiều yêu cầu, vui lòng chờ.' },
    'insufficient_credits':  { status: 402, code: 'insufficient_credits', message: 'Hết credits. Nâng cấp gói để tiếp tục.' },
    'Timed out':             { status: 504, code: 'gateway_timeout',      message: 'AI mất quá nhiều thời gian. Thử lại nhé.' },
    'plan_required':         { status: 403, code: 'plan_required',        message: 'Tính năng này cần gói trả phí.' },
  };

  for (const [key, val] of Object.entries(known)) {
    if (error.message.includes(key)) {
      return reply.status(val.status).send({ success: false, error: { code: val.code, message: val.message } });
    }
  }

  // Generic 500
  return reply.status(500).send({
    success: false,
    error: {
      code: 'internal_error',
      message: 'Đã có lỗi xảy ra. Chúng tôi đang xử lý.',
      request_id: req.id,
    }
  });
}
