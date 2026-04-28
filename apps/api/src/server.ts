// apps/api/src/server.ts
// Entry point — Fastify server với tất cả routes và plugins

import 'openai/shims/node';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import * as Sentry from '@sentry/node';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  healthRoutes, authRoutes, agentRoutes,
  visualRoutes, profileRoutes, performanceRoutes,
} from './routes/index.js';
import { paymentRoutes, knowledgeRoutes, offersRoutes } from './routes/payment.js';
import { authenticate, errorHandler } from './middleware/index.js';
import { inngest, scheduledFunctions } from './jobs/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadLocalEnv(): void {
  const candidates = [
    resolve(__dirname, '..', '.env.local'),
    resolve(__dirname, '..', '..', '..', '.env.local'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;

    const parsed = parseEnvFile(readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadLocalEnv();

// ─── Init Sentry trước khi làm gì khác ────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn:             process.env.SENTRY_DSN,
    environment:     process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

// ─── Validate required env vars ───────────────────────────────────────────────
function validateEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('❌ Missing required env vars:', missing.join(', '));
    console.error('   Copy .env.example to .env.local and fill in values');
    process.exit(1);
  }
}

// ─── Build server ─────────────────────────────────────────────────────────────
async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? [process.env.APP_URL ?? 'https://yourdomain.vn']
      : true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // Handle in frontend
  });

  await app.register(rateLimit, {
    max:      100,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req as any).userId ?? req.ip,
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'rate_limited', message: 'Quá nhiều yêu cầu, vui lòng chờ 1 phút.' }
    }),
  });

  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024,  // 100MB max (cho video)
      files: 1,
    },
  });

  // ── Decorate with auth ─────────────────────────────────────────────────────
  app.decorate('authenticate', authenticate);

  // ── Register routes ────────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(agentRoutes);
  await app.register(visualRoutes);
  await app.register(profileRoutes);
  await app.register(performanceRoutes);
  await app.register(paymentRoutes);
  await app.register(knowledgeRoutes);
  await app.register(offersRoutes);

  // ── Inngest endpoint (webhook từ Inngest cloud) ────────────────────────────
  if (process.env.INNGEST_EVENT_KEY) {
    const { serve } = await import('inngest/fastify');
    app.route({
      method: ['GET', 'POST', 'PUT'],
      url:    '/api/inngest',
      handler: serve({ client: inngest, functions: scheduledFunctions }) as any,
    });
    app.log.info('✅ Inngest webhook registered at /api/inngest');
  }

  // ── Global error handler ───────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      success: false,
      error: { code: 'not_found', message: `Route ${req.method} ${req.url} không tồn tại` }
    });
  });

  return app;
}

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  validateEnv();

  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });

    app.log.info('');
    app.log.info('╔══════════════════════════════════════════╗');
    app.log.info('║   🤖 AffiliateAI API — Running           ║');
    app.log.info(`║   http://192.168.1.149:${port}                ║`);
    app.log.info('╚══════════════════════════════════════════╝');
    app.log.info('');
    app.log.info(`  ENV     : ${process.env.NODE_ENV ?? 'development'}`);
    app.log.info(`  DB      : ${process.env.SUPABASE_URL ? '✅ Connected' : '❌ Missing'}`);
    app.log.info(`  CakeAI  : ${process.env.CAKEAI_API_KEY ? '✅ Key set' : '⚠️  Missing'}`);
    app.log.info(`  OpenAI  : ${process.env.OPENAI_API_KEY ? '✅ Key set' : '⚠️  Missing'}`);
    app.log.info(`  Inngest : ${process.env.INNGEST_EVENT_KEY ? '✅ Key set' : '⚠️  Missing (scheduler disabled)'}`);
    app.log.info('');

  } catch (err) {
    app.log.error('Failed to start server:', err);
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down');
  process.exit(0);
});

start();
