// apps/api/src/services/visual/visual-queue.ts
// Visual AI Queue: Pipeline A (ảnh thực) | B (Shopee/Lazada) | C (video raw)

import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { withRetry, withTimeout } from '../../lib/resilience.js';
import { generateImageFromCutout } from '../../agents/openai-image-mini-agent.js';
import { generateVideoEditPlan } from '../../agents/openai-video-mini-agent.js';
import { scrapeShopeeUrl } from '../integrations/shopee.js';

const db = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const PIPELINE_A_BG_TIMEOUT_MS = 35_000;
const PIPELINE_A_UPSCALE_TIMEOUT_MS = 45_000;
const PIPELINE_A_ANALYSIS_TIMEOUT_MS = 35_000;
const PIPELINE_A_AD_TIMEOUT_MS = 180_000;
const PIPELINE_B_AD_TIMEOUT_MS = 180_000;

interface VisualProductData {
  name: string;
  images: string[];
  price: number;
  rating: number;
  sold: number;
  originalPrice: number;
  discount: number;
}

interface CreativeDirection {
  theme: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
  };
  headline: string;
  subline: string;
  cta: string;
  badge: string;
  productPlacement: 'center' | 'right' | 'left' | 'bottom';
  textZone: 'top' | 'left' | 'right' | 'bottom';
}

interface PipelineACopyInput {
  productDescription?: string;
  headline?: string;
  subline?: string;
  cta?: string;
  badge?: string;
  includeText?: boolean;
}

interface ProductImageCandidate {
  url: string;
  buffer: Buffer;
  width: number;
  height: number;
  format?: string;
  score: number;
  warnings: string[];
}

interface PipelineAImageAnalysis {
  subjectKind: 'product' | 'person' | 'fashion_model' | 'food' | 'home' | 'other';
  subjectLabel: string;
  niche: string;
  style: string;
  background: string;
  palette: CreativeDirection['palette'];
  headline: string;
  subline: string;
  cta: string;
  badge: string;
  preferredSubjectSide: 'left' | 'right' | 'center' | 'bottom';
  notes: string;
}

interface PipelineAAdContent {
  campaignAngle: string;
  visualHook: string;
  keyBenefit: string;
  audience: string;
  mood: string;
  sceneProps: string[];
  compositionNote: string;
}

interface PipelineCHighlight {
  start: number;
  end: number;
  hook_text: string;
  hook_frame_time: number;
  opening_caption: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
export const visualQueue = {
  async add(jobId: string, userId: string, config: {
    product_url?: string;
    source_path?: string;
    platforms: string[];
    pipeline: string;
    niche?: string;
    copy?: PipelineACopyInput;
    subStyle?: string;
    clipDuration?: number;
  }): Promise<void> {
    try {
      await db().from('visual_jobs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', jobId);

      let assets: Record<string, string | string[]> = {};

      if (config.pipeline === 'B' && config.product_url) {
        assets = await runPipelineB(userId, config.product_url, config.platforms);
      } else if (config.pipeline === 'C' && config.source_path) {
        assets = await runPipelineC(userId, config.source_path, {
          subStyle: config.subStyle,
          clipDuration: config.clipDuration,
        });
      } else if (config.pipeline === 'A' && config.source_path) {
        assets = await runPipelineA(userId, config.source_path, config.platforms, config.niche, config.copy);
      }

      await db().from('visual_jobs').update({
        status:       'done',
        assets,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);

    } catch (err) {
      console.error(`[VisualQueue] Job ${jobId} failed:`, err);
      await db().from('visual_jobs').update({
        status:    'failed',
        error_msg: (err as Error).message.slice(0, 500),
      }).eq('id', jobId);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE A — ảnh sản phẩm thực (user upload)
// ═══════════════════════════════════════════════════════════════════════════════
async function runPipelineA(
  userId: string,
  imagePath: string,
  platforms: string[],
  niche = 'beauty',
  copy: PipelineACopyInput = {}
): Promise<Record<string, string>> {
  const imageBuffer = await readFile(imagePath);
  const selectedPlatforms = [...new Set(platforms)].slice(0, 5);
  const analysis = await analyzePipelineAImage(imageBuffer, niche, copy);
  const resolvedNiche = analysis.niche || niche;
  const adContent = await generatePipelineAAdContent(analysis, resolvedNiche, copy);
  
  // Generate a complete ad banner from the uploaded image reference.
  const results: Record<string, string> = {};
  const settled = await Promise.allSettled(selectedPlatforms.map(async (platform) => {
    const creative = buildPipelineACreativeDirection(analysis, resolvedNiche, platform);
    applyPipelineACopy(creative, copy);
    const generated = await generatePipelineAAsset(imageBuffer, resolvedNiche, platform, analysis, creative, adContent);
    const url = await uploadToStorage(generated, `${userId}/banner_${platform}_${Date.now()}.jpg`);
    return { platform, url };
  }));

  for (const item of settled) {
    if (item.status === 'fulfilled') {
      results[`${item.value.platform}_banner`] = item.value.url;
      continue;
    }
    console.warn(`[Visual] Pipeline A platform render failed: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
  }

  if (Object.keys(results).length === 0) {
    throw new Error('Pipeline A không tạo được ảnh đầu ra nào');
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE B — crawl Shopee/Lazada URL
// ═══════════════════════════════════════════════════════════════════════════════
async function runPipelineB(
  userId: string,
  productUrl: string,
  platforms: string[]
): Promise<Record<string, string>> {

  // Step 1: Load product data
  let product: Awaited<ReturnType<typeof scrapeProduct>>;
  try {
    product = await scrapeProduct(productUrl);
  } catch (error) {
    console.warn(`[Visual] Primary product loader fallback: ${(error as Error).message}`);
    product = await scrapeProductFallback(productUrl);
  }
  if (!product.images || product.images.length === 0) {
    product = await scrapeProductFallback(productUrl, product);
  }
  
  // Step 2: Pick and prepare the best source image instead of trusting the first crawled URL.
  const productReference = await preparePipelineBProductReference(product.images);
  const imgBuffer = productReference.buffer;
  
  // Step 3: Generate complete ad creatives per platform from the product image.
  const results: Record<string, string> = {};
  const niche = inferNiche(product.name);
  const selectedPlatforms = [...new Set(platforms)].slice(0, 5);
  
  const settled = await Promise.allSettled(selectedPlatforms.map(async (platform) => {
    const creative = buildCreativeDirection(niche, platform, product);
    const withText = await generateCompletePipelineBAd(imgBuffer, niche, platform, product, creative);
    const url = await uploadToStorage(withText, `${userId}/banner_${platform}_${Date.now()}.jpg`);
    return { platform, url };
  }));

  for (const item of settled) {
    if (item.status === 'fulfilled') {
      results[`${item.value.platform}_banner`] = item.value.url;
      continue;
    }
    console.warn(`[Visual] Pipeline B platform render failed: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
  }

  if (Object.keys(results).length === 0) {
    const reasons = settled
      .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      .map(item => item.reason instanceof Error ? item.reason.message : String(item.reason))
      .slice(0, 3)
      .join('; ');
    throw new Error(`Pipeline B không tạo được ảnh đầu ra nào${reasons ? `: ${reasons}` : ''}`);
  }
  
  // Carousel is expensive: 5 extra image generations can add several minutes.
  // Keep it opt-in so the main requested platform exports can finish promptly.
  if (process.env.PIPELINE_B_ENABLE_CAROUSEL === 'true' && selectedPlatforms.includes('instagram')) {
    const carouselUrls = await generateCarousel(userId, product, niche, imgBuffer);
    if (carouselUrls.length > 0) {
      results['instagram_carousel'] = carouselUrls.join(',');
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE C — video raw + AI edit + subtitle
// ═══════════════════════════════════════════════════════════════════════════════
async function generateCompletePipelineBAd(
  productImageBuffer: Buffer,
  niche: string,
  platform: string,
  product: VisualProductData,
  creative: CreativeDirection
): Promise<Buffer> {
  let generated: Buffer;
  try {
    generated = await withTimeout(
      () => generateImageFromCutout({
        cutoutBuffer: productImageBuffer,
        niche,
        platform,
        productName: shortProductName(product.name),
        marketingContext: buildPipelineBMarketingContext(product, niche, platform),
        creativeTheme: creative.theme,
        colorDirection: `${creative.palette.primary}, ${creative.palette.secondary}, ${creative.palette.accent}`,
        productPlacement: creative.productPlacement,
        textZone: creative.textZone,
        renderMode: 'complete_ad',
      }),
      PIPELINE_B_AD_TIMEOUT_MS,
      `Pipeline B ${platform} complete ad generation timed out after ${PIPELINE_B_AD_TIMEOUT_MS}ms`
    );
  } catch (error) {
    console.warn(`[Visual] Pipeline B AI scene fallback for ${platform}: ${(error as Error).message}`);
    generated = await generatePhotorealisticProductScene(productImageBuffer, niche, platform, product, creative);
  }

  return renderPipelineBBanner(generated, platform, {
    name: product.name,
    price: product.price,
    rating: product.rating,
    sold: product.sold,
    discount: product.discount,
  }, creative);
}

async function runPipelineC(
  userId: string,
  videoPath: string,
  options: { subStyle?: string; clipDuration?: number } = {}
): Promise<Record<string, string>> {

  const { default: fs } = await import('fs');
  const clipDuration = Number.isFinite(options.clipDuration) && (options.clipDuration ?? 0) > 0
    ? Math.round(clamp(options.clipDuration as number, 15, 90))
    : 45;
  const subStyle = options.subStyle || 'tiktok';
  const sourceDuration = await getVideoDuration(videoPath).catch(() => clipDuration);
  const audioPath = buildVisualTempPath(userId, 'transcribe_audio', 'wav');
  const clipPath = buildVisualTempPath(userId, 'clip', 'mp4');
  const clipAudioPath = buildVisualTempPath(userId, 'clip_audio', 'wav');
  const processedPath = buildVisualTempPath(userId, 'processed', 'mp4');
  const assPath = buildVisualTempPath(userId, 'sub', 'ass');
  const srtPath = buildVisualTempPath(userId, 'sub', 'srt');
  const subtitledPath = buildVisualTempPath(userId, 'final', 'mp4');
  const trimmedPath = buildVisualTempPath(userId, 'trimmed_final', 'mp4');
  const thumbPath = buildVisualTempPath(userId, 'thumb', 'jpg');
  let hasAudio = true;
  let transcript: Awaited<ReturnType<typeof transcribeVideo>> | null = null;
  try {
    await extractAudioForTranscription(videoPath, audioPath);
    transcript = await transcribeVideo(audioPath);
  } catch (error) {
    if (!isNoAudioStreamError(error)) throw error;
    hasAudio = false;
  }

  // Step 1: Transcribe audio
  const highlight = normalizeHighlightWindow(
    transcript
      ? await planPipelineCHighlight(transcript, clipDuration, sourceDuration)
      : buildFallbackHighlight(sourceDuration, clipDuration),
    sourceDuration,
    clipDuration
  );
  
  // Step 2: Find best highlight with the configured OpenAI video planner.
  
  // Step 3: Cut clip
  await cutVideoClip(videoPath, highlight.start, highlight.end, clipPath, hasAudio);
  await assertVideoWasCut(clipPath, highlight.end - highlight.start, 'Pipeline C source cut');
  
  // Step 4: Enhance audio + resize to 9:16
  await processVideoForTikTok(clipPath, processedPath, hasAudio);

  const slicedTranscript = transcript
    ? sliceTranscriptToWindow(transcript, highlight.start, highlight.end)
    : null;
  const clipTranscript = hasAudio
    ? await transcribeCutClipForSubtitles(clipPath, clipAudioPath, slicedTranscript)
    : null;
  const hasSubtitleData = Boolean(clipTranscript && (clipTranscript.words.length > 0 || clipTranscript.segments.length > 0));
  let finalVideoPath = hasSubtitleData ? subtitledPath : processedPath;
  const openingCaption = buildOpeningCaption(highlight.opening_caption || highlight.hook_text || clipTranscript?.text || '');
  if (clipTranscript && hasSubtitleData) {
    if (clipTranscript.words.length > 0) {
      generateWordByWordASS(clipTranscript.words, 0, assPath, subStyle, openingCaption);
    } else {
      generateSegmentASS(clipTranscript.segments, assPath, subStyle, openingCaption);
    }
    await burnSubtitle(processedPath, assPath, subtitledPath);
    generateSRT(clipTranscript.segments, clipTranscript.words, srtPath);
  } else if (openingCaption) {
    generateSegmentASS([], assPath, subStyle, openingCaption);
    await burnSubtitle(processedPath, assPath, subtitledPath);
    finalVideoPath = subtitledPath;
  }

  finalVideoPath = await ensureVideoDurationLimit(
    finalVideoPath,
    trimmedPath,
    Math.max(1, highlight.end - highlight.start),
    hasAudio
  );
  
  // Step 7: Extract best thumbnail
  const clipLength = Math.max(1, highlight.end - highlight.start);
  const thumbTime = Math.min(
    Math.max(0.4, (highlight.hook_frame_time ?? highlight.start) - highlight.start),
    Math.max(0.5, clipLength - 0.4)
  );
  await extractThumbnail(finalVideoPath, thumbPath, thumbTime);
  
  // Step 8: Upload both
  const [videoUrl, thumbUrl, subtitleUrl] = await Promise.all([
    uploadToStorage(await readFile(finalVideoPath), `${userId}/video_${Date.now()}.mp4`, 'video/mp4'),
    uploadToStorage(await readFile(thumbPath), `${userId}/thumb_${Date.now()}.jpg`, 'image/jpeg'),
    hasSubtitleData
      ? uploadToStorage(await readFile(srtPath), `${userId}/subtitle_${Date.now()}.srt`, 'text/plain; charset=utf-8')
      : Promise.resolve(''),
  ]);
  
  // Cleanup
  [audioPath, clipAudioPath, clipPath, processedPath, assPath, srtPath, subtitledPath, trimmedPath, thumbPath]
    .forEach(p => fs.unlink(p, () => {}));

  return {
    tiktok_video: videoUrl,
    tiktok_thumbnail: thumbUrl,
    ...(subtitleUrl ? { subtitle_srt: subtitleUrl } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
async function removeBg(buffer: Buffer): Promise<Buffer> {
  if (!process.env.REMOVEBG_API_KEY) {
    console.warn('[Visual] No REMOVEBG_API_KEY — skipping background removal');
    return buffer;
  }

  const formData = new FormData();
  const blobPart = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  formData.append('image_file', new Blob([blobPart]), 'product.jpg');
  formData.append('size', 'auto');
  formData.append('type', 'product');
  formData.append('format', 'png');

  const res = await withRetry(
    () => withTimeout(
      () => fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': process.env.REMOVEBG_API_KEY! },
        body: formData,
      }),
      15_000
    ),
    { maxAttempts: 2 }
  );

  if (!res.ok) throw new Error(`Remove.bg error: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function upscaleImage(buffer: Buffer): Promise<Buffer> {
  if (!process.env.REPLICATE_API_TOKEN) return buffer;

  const replicateModuleName = 'replicate';
  const { default: Replicate } = await import(replicateModuleName);
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const base64 = buffer.toString('base64');
  const output = await withTimeout(
    () => replicate.run(
      'nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b',
      { input: { image: `data:image/jpeg;base64,${base64}`, scale: 2, face_enhance: false } }
    ) as Promise<string>,
    PIPELINE_A_UPSCALE_TIMEOUT_MS,
    `Upscale timed out after ${PIPELINE_A_UPSCALE_TIMEOUT_MS}ms`
  );

  const res = await withTimeout(() => fetch(output), 15_000, 'Upscale download timeout');
  if (!res.ok) throw new Error(`Upscale download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateBackground(prompt: string, platform: string): Promise<Buffer> {
  const sizeMap: Record<string, '1024x1024' | '1536x1024' | '1024x1536'> = {
    tiktok: '1024x1536', instagram_story: '1024x1536',
    facebook: '1536x1024', youtube: '1536x1024',
    zalo: '1536x1024',
  };
  const size = sizeMap[platform] ?? '1024x1024';
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
  const quality = process.env.OPENAI_IMAGE_QUALITY || 'high';

  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackBackground(platform);
  }

  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await withTimeout(
      () => openai.images.generate({ model, prompt, size, quality, n: 1 } as any),
      PIPELINE_A_BG_TIMEOUT_MS,
      `Background generation timed out after ${PIPELINE_A_BG_TIMEOUT_MS}ms`
    );
    const base64Image = res.data?.[0]?.b64_json;
    if (base64Image) return Buffer.from(base64Image, 'base64');

    const url = res.data?.[0]?.url;
    if (!url) throw new Error('OpenAI image response missing URL');
    return downloadBuffer(url);
  } catch (error) {
    console.warn(`[Visual] Background generation fallback for ${platform}: ${(error as Error).message}`);
    return generateFallbackBackground(platform);
  }
}

async function analyzePipelineAImage(buffer: Buffer, fallbackNiche: string, copy: PipelineACopyInput = {}): Promise<PipelineAImageAnalysis> {
  const fallback = defaultPipelineAAnalysis(fallbackNiche, copy);
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const image = await prepareVisionImageDataUrl(buffer);
    const response = await withTimeout(
      () => openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-5.5',
        response_format: { type: 'json_object' },
        max_tokens: 420,
        messages: [
          {
            role: 'system',
            content: [
              'You are an art director for e-commerce and social ads.',
              'Read the uploaded image first and treat the visible product/person/outfit as the source of truth.',
              'The user description is only supporting context for niche, benefits, and audience; never let it replace or contradict what is visible in the image.',
              'Identify the subject, define style, choose a layout with clean text space, pick a color palette, and propose short Vietnamese overlay copy.',
              'Do not invent brands, materials, features, discounts, or product claims unless they are visible in the image or explicitly described by the user.',
              'Return strict JSON only.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  'Return this JSON shape:',
                  '{"subjectKind":"product|person|fashion_model|food|home|other","subjectLabel":"short Vietnamese label from the image","niche":"beauty|tech|food|fashion|home|health","style":"premium studio style","background":"clean contextual background","palette":{"primary":"#111111","secondary":"#F7EEDF","accent":"#B91C1C","text":"#FFFFFF"},"headline":"ĐÁNG THỬ HÔM NAY","subline":"Lợi ích ngắn phù hợp sản phẩm","cta":"Xem ngay","badge":"HOT","preferredSubjectSide":"left|right|center|bottom","notes":"short visual notes based on image"}',
                  copy.productDescription ? `Supporting user description, use only if consistent with the image: ${copy.productDescription}` : '',
                  copy.headline ? `Legacy optional headline direction, use only if consistent with the image: ${copy.headline}` : '',
                  copy.subline ? `Legacy optional subline direction, use only if consistent with the image: ${copy.subline}` : '',
                  copy.cta ? `Legacy optional CTA direction: ${copy.cta}` : '',
                  copy.badge ? `Legacy optional badge direction: ${copy.badge}` : '',
                  'Keep overlay copy short, natural Vietnamese with full accents. If the image contains a fashion model or person, preserve the exact person and outfit as the hero subject.',
                ].filter(Boolean).join('\n'),
              },
              { type: 'image_url', image_url: { url: image, detail: 'low' } },
            ] as any,
          },
        ],
      } as any),
      PIPELINE_A_ANALYSIS_TIMEOUT_MS,
      `Pipeline A image analysis timed out after ${PIPELINE_A_ANALYSIS_TIMEOUT_MS}ms`
    );

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as Partial<PipelineAImageAnalysis>;
    return normalizePipelineAAnalysis(parsed, fallback);
  } catch (error) {
    console.warn(`[Visual] Pipeline A image analysis fallback: ${(error as Error).message}`);
    return fallback;
  }
}

async function prepareVisionImageDataUrl(buffer: Buffer): Promise<string> {
  const { default: sharp } = await import('sharp');
  const normalized = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  return `data:image/jpeg;base64,${normalized.toString('base64')}`;
}

function defaultPipelineAAnalysis(niche: string, copy: PipelineACopyInput = {}): PipelineAImageAnalysis {
  const normalizedNiche = normalizeNiche(niche);
  const palette = defaultPaletteForNiche(normalizedNiche);
  const describedSubject = subjectLabelFromDescription(copy.productDescription);
  return {
    subjectKind: normalizedNiche === 'fashion' ? 'fashion_model' : 'product',
    subjectLabel: describedSubject || (normalizedNiche === 'fashion' ? 'Bộ sưu tập thời trang' : 'Sản phẩm chính'),
    niche: normalizedNiche,
    style: normalizedNiche === 'fashion' ? 'Editorial cao cấp' : 'Studio quảng cáo cao cấp',
    background: normalizedNiche === 'fashion' ? 'studio tối giản với ánh sáng thời trang mềm' : 'studio tối giản với ánh sáng mềm và sạch',
    palette,
    headline: cleanOverlayCopy(copy.headline, normalizedNiche === 'fashion' ? 'BỘ SƯU TẬP MỚI' : 'ĐÁNG THỬ HÔM NAY', 34).toUpperCase(),
    subline: cleanOverlayCopy(copy.subline, normalizedNiche === 'fashion' ? 'Phong cách gọn gàng, dễ nổi bật' : benefitByNiche(normalizedNiche), 58),
    cta: cleanOverlayCopy(copy.cta, 'Xem ngay', 14),
    badge: cleanOverlayCopy(copy.badge, normalizedNiche === 'fashion' ? 'MỚI' : 'HOT', 18).toUpperCase(),
    preferredSubjectSide: 'right',
    notes: copy.productDescription
      ? `Ảnh là nguồn nhận diện sản phẩm chính; dùng mô tả này làm ngữ cảnh hỗ trợ nếu phù hợp: ${copy.productDescription}`
      : 'Tạo banner thương mại sạch, giữ sản phẩm trong ảnh làm chủ thể và chừa vùng trống cho chữ.',
  };
}

async function generatePipelineAAdContent(
  analysis: PipelineAImageAnalysis,
  niche: string,
  copy: PipelineACopyInput
): Promise<PipelineAAdContent> {
  const fallback = defaultPipelineAAdContent(analysis, niche, copy);
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await withTimeout(
      () => openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-5.5',
        response_format: { type: 'json_object' },
        max_tokens: 360,
        messages: [
          {
            role: 'system',
            content: [
              'You are a senior ad creative strategist.',
              'Create visual advertising content for a banner from the image-based product/subject analysis.',
              'The uploaded image analysis is the source of truth; the user description only supports benefits, audience, and positioning.',
              'The content must be expressed visually through scene, props, lighting, composition, and mood.',
              'Do not create claims, use cases, ingredients, specs, or product categories that conflict with the observed subject.',
              'Do not rely on readable text inside the image.',
              'Return strict JSON only.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Niche: ${niche}`,
              `Subject: ${analysis.subjectLabel}`,
              `Subject kind: ${analysis.subjectKind}`,
              copy.productDescription ? `Supporting product description, use only if consistent with the observed subject: ${copy.productDescription}` : '',
              `Style: ${analysis.style}`,
              `Existing notes: ${analysis.notes}`,
              copy.headline ? `Optional user headline direction: ${copy.headline}` : '',
              copy.subline ? `Optional user subline direction: ${copy.subline}` : '',
              'Return JSON shape: {"campaignAngle":"short angle","visualHook":"what should catch attention visually","keyBenefit":"benefit to communicate visually","audience":"target audience","mood":"premium mood","sceneProps":["prop 1","prop 2","prop 3"],"compositionNote":"short art direction"}',
            ].filter(Boolean).join('\n'),
          },
        ],
      } as any),
      25_000,
      'Pipeline A ad content generation timed out after 25000ms'
    );

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as Partial<PipelineAAdContent>;
    return normalizePipelineAAdContent(parsed, fallback);
  } catch (error) {
    console.warn(`[Visual] Pipeline A ad content fallback: ${(error as Error).message}`);
    return fallback;
  }
}

function defaultPipelineAAdContent(
  analysis: PipelineAImageAnalysis,
  niche: string,
  copy: PipelineACopyInput
): PipelineAAdContent {
  const nicheContent: Record<string, Omit<PipelineAAdContent, 'campaignAngle'>> = {
    beauty: {
      visualHook: 'glowing skin ritual, clean premium vanity moment',
      keyBenefit: 'fresh, confident daily beauty routine',
      audience: 'beauty shoppers looking for a polished daily upgrade',
      mood: 'soft, luminous, refined',
      sceneProps: ['clean vanity surface', 'soft fabric', 'subtle glass or floral accent'],
      compositionNote: 'make the product feel aspirational and fresh without clutter',
    },
    tech: {
      visualHook: 'sleek modern setup with clear subject silhouette',
      keyBenefit: 'smarter, cleaner, more efficient everyday use',
      audience: 'tech buyers who value performance and modern design',
      mood: 'precise, premium, futuristic',
      sceneProps: ['matte desk surface', 'subtle light streak', 'minimal metallic accent'],
      compositionNote: 'use controlled highlights and strong separation from the background',
    },
    food: {
      visualHook: 'fresh appetizing scene with natural ingredients',
      keyBenefit: 'easy, satisfying taste moment',
      audience: 'busy shoppers looking for tasty convenience',
      mood: 'warm, fresh, inviting',
      sceneProps: ['clean kitchen surface', 'fresh ingredient accents', 'natural daylight'],
      compositionNote: 'make the food/product feel appetizing, bright, and easy to choose',
    },
    fashion: {
      visualHook: 'editorial fashion moment focused on fabric, silhouette, and confidence',
      keyBenefit: 'standout style for a polished occasion',
      audience: 'fashion shoppers looking for an elegant statement piece',
      mood: 'elegant, classic, premium',
      sceneProps: ['minimal studio backdrop', 'soft fabric texture', 'subtle warm highlight'],
      compositionNote: 'preserve outfit identity and create a campaign-ready fashion banner',
    },
    home: {
      visualHook: 'calm modern home scene with tasteful styling',
      keyBenefit: 'cleaner, warmer, more organized living space',
      audience: 'home shoppers improving their everyday environment',
      mood: 'calm, warm, modern',
      sceneProps: ['soft natural textile', 'clean tabletop', 'subtle plant or decor accent'],
      compositionNote: 'make the scene feel livable and premium, not staged with clutter',
    },
    health: {
      visualHook: 'fresh wellness routine with clean active-lifestyle cues',
      keyBenefit: 'simple daily care and better habits',
      audience: 'wellness shoppers who want practical daily support',
      mood: 'fresh, clean, trustworthy',
      sceneProps: ['bright neutral surface', 'soft green accent', 'clean clinical-lifestyle detail'],
      compositionNote: 'communicate trust and freshness with restrained wellness styling',
    },
  };

  const base = nicheContent[niche] ?? nicheContent.beauty;
  return {
    campaignAngle: copy.headline || analysis.headline || subjectLabelFromDescription(copy.productDescription) || benefitByNiche(niche),
    ...base,
    keyBenefit: copy.productDescription
      ? cleanOverlayCopy(copy.productDescription, base.keyBenefit, 100)
      : base.keyBenefit,
  };
}

function subjectLabelFromDescription(description?: string): string {
  if (!description) return '';
  return cleanOverlayCopy(description, '', 56)
    .replace(/^(sản phẩm|san pham|product|mô tả|mo ta|description)\s*[:\-]\s*/i, '');
}

function normalizePipelineAAdContent(input: Partial<PipelineAAdContent>, fallback: PipelineAAdContent): PipelineAAdContent {
  return {
    campaignAngle: cleanOverlayCopy(input.campaignAngle, fallback.campaignAngle, 80),
    visualHook: cleanOverlayCopy(input.visualHook, fallback.visualHook, 120),
    keyBenefit: cleanOverlayCopy(input.keyBenefit, fallback.keyBenefit, 100),
    audience: cleanOverlayCopy(input.audience, fallback.audience, 100),
    mood: cleanOverlayCopy(input.mood, fallback.mood, 80),
    sceneProps: Array.isArray(input.sceneProps)
      ? input.sceneProps.filter((item): item is string => typeof item === 'string').slice(0, 5).map(item => cleanOverlayCopy(item, '', 60)).filter(Boolean)
      : fallback.sceneProps,
    compositionNote: cleanOverlayCopy(input.compositionNote, fallback.compositionNote, 140),
  };
}

function normalizePipelineAAnalysis(
  input: Partial<PipelineAImageAnalysis>,
  fallback: PipelineAImageAnalysis
): PipelineAImageAnalysis {
  const subjectKind = normalizeSubjectKind(input.subjectKind, fallback.subjectKind);
  const niche = normalizeNiche(input.niche || fallback.niche);
  return {
    subjectKind,
    subjectLabel: cleanOverlayCopy(input.subjectLabel, fallback.subjectLabel, 56),
    niche,
    style: cleanOverlayCopy(input.style, fallback.style, 64),
    background: cleanOverlayCopy(input.background, fallback.background, 120),
    palette: normalizePalette(input.palette, defaultPaletteForNiche(niche)),
    headline: cleanOverlayCopy(input.headline, fallback.headline, 34).toUpperCase(),
    subline: cleanOverlayCopy(input.subline, fallback.subline, 58),
    cta: cleanOverlayCopy(input.cta, fallback.cta, 14),
    badge: cleanOverlayCopy(input.badge, fallback.badge, 18).toUpperCase(),
    preferredSubjectSide: normalizeSubjectSide(input.preferredSubjectSide, fallback.preferredSubjectSide),
    notes: cleanOverlayCopy(input.notes, fallback.notes, 180),
  };
}

function normalizeSubjectKind(value: unknown, fallback: PipelineAImageAnalysis['subjectKind']): PipelineAImageAnalysis['subjectKind'] {
  return isOneOf(value, ['product', 'person', 'fashion_model', 'food', 'home', 'other']) ? value : fallback;
}

function normalizeSubjectSide(value: unknown, fallback: PipelineAImageAnalysis['preferredSubjectSide']): PipelineAImageAnalysis['preferredSubjectSide'] {
  return isOneOf(value, ['left', 'right', 'center', 'bottom']) ? value : fallback;
}

function normalizeNiche(value: unknown): string {
  return isOneOf(value, ['beauty', 'tech', 'food', 'fashion', 'home', 'health']) ? value : 'beauty';
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function cleanOverlayCopy(value: unknown, fallback: string, maxLength: number): string {
  const cleaned = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim()
    : '';
  return (cleaned || fallback).slice(0, maxLength);
}

function normalizePalette(input: unknown, fallback: CreativeDirection['palette']): CreativeDirection['palette'] {
  const value = typeof input === 'object' && input ? input as Partial<CreativeDirection['palette']> : {};
  return {
    primary: normalizeHexColor(value.primary, fallback.primary),
    secondary: normalizeHexColor(value.secondary, fallback.secondary),
    accent: normalizeHexColor(value.accent, fallback.accent),
    text: normalizeHexColor(value.text, fallback.text),
  };
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function defaultPaletteForNiche(niche: string): CreativeDirection['palette'] {
  return ({
    beauty: { primary: '#D9468F', secondary: '#FFF1F2', accent: '#FACC15', text: '#FFFFFF' },
    tech: { primary: '#2563EB', secondary: '#E0F2FE', accent: '#22D3EE', text: '#FFFFFF' },
    food: { primary: '#EA580C', secondary: '#FFF7ED', accent: '#FACC15', text: '#FFFFFF' },
    fashion: { primary: '#7F1D1D', secondary: '#F7EEDF', accent: '#D4AF37', text: '#FFFFFF' },
    home: { primary: '#047857', secondary: '#ECFDF5', accent: '#A7F3D0', text: '#FFFFFF' },
    health: { primary: '#0F766E', secondary: '#ECFEFF', accent: '#67E8F9', text: '#FFFFFF' },
  } as Record<string, CreativeDirection['palette']>)[niche] ?? {
    primary: '#111827',
    secondary: '#F3F4F6',
    accent: '#FACC15',
    text: '#FFFFFF',
  };
}

function buildPipelineACreativeDirection(
  analysis: PipelineAImageAnalysis,
  niche: string,
  platform: string
): CreativeDirection {
  const side = platform === 'tiktok' ? 'bottom' : analysis.preferredSubjectSide;
  const productPlacement = side === 'left' || side === 'right' || side === 'bottom' ? side : defaultProductPlacementForPlatform(platform);
  const textZone = productPlacement === 'right'
    ? 'left'
    : productPlacement === 'left'
      ? 'right'
      : platform === 'instagram'
        ? 'bottom'
        : 'top';

  return {
    theme: `${analysis.style}: ${analysis.background}`,
    palette: analysis.palette,
    headline: platform === 'youtube' && analysis.headline.length > 24
      ? analysis.badge
      : analysis.headline,
    subline: analysis.subline || benefitByNiche(niche),
    cta: analysis.cta || 'Mua ngay',
    badge: analysis.badge || 'NEW',
    productPlacement,
    textZone,
  };
}

function applyPipelineACopy(creative: CreativeDirection, copy: PipelineACopyInput): void {
  const headline = cleanOverlayCopy(copy.headline, '', 42);
  const subline = cleanOverlayCopy(copy.subline, '', 72);
  const cta = cleanOverlayCopy(copy.cta, '', 18);
  const badge = cleanOverlayCopy(copy.badge, '', 22);
  const description = cleanOverlayCopy(copy.productDescription, '', 120);

  if (headline) creative.headline = headline.toUpperCase();
  if (subline) creative.subline = subline;
  else if (description && creative.subline.length < 12) creative.subline = limitWords(description, 11);
  if (cta) creative.cta = cta;
  if (badge) creative.badge = badge.toUpperCase();
}

function defaultProductPlacementForPlatform(platform: string): CreativeDirection['productPlacement'] {
  return ({
    tiktok: 'bottom',
    facebook: 'right',
    instagram: 'center',
    youtube: 'right',
    zalo: 'right',
  } as Record<string, CreativeDirection['productPlacement']>)[platform] ?? 'right';
}

function buildPipelineAMarketingContext(
  analysis: PipelineAImageAnalysis,
  platform: string,
  adContent: PipelineAAdContent
): string {
  return [
    `Use the uploaded image as the primary product/subject identity reference and preserve the visible item, packaging, person, outfit, shape, and color family.`,
    `User description and niche are supporting context only; do not replace the observed subject with a different product.`,
    `Create a complete premium ${platform} advertising banner from that reference.`,
    `Subject: ${analysis.subjectLabel}.`,
    analysis.notes ? `User/product brief: ${analysis.notes}.` : '',
    `Niche: ${analysis.niche}.`,
    `Style: ${analysis.style}.`,
    `Background direction: ${analysis.background}.`,
    `Campaign angle: ${adContent.campaignAngle}.`,
    `Visual hook: ${adContent.visualHook}.`,
    `Key benefit to communicate visually: ${adContent.keyBenefit}.`,
    `Target audience: ${adContent.audience}.`,
    `Mood: ${adContent.mood}.`,
    `Suggested supporting props: ${adContent.sceneProps.join(', ')}.`,
    `Composition note: ${adContent.compositionNote}.`,
    `Commercial art direction: cohesive lighting, realistic scale, polished campaign composition, clean negative space for later text overlay, no manual cutout/composite look.`,
    `Keep the hero subject easy to recognize and do not duplicate it into multiple conflicting products.`,
    `Do not add readable text, slogans, UI, logos, price tags, watermarks, or fake typography.`,
    analysis.notes,
  ].filter(Boolean).join(', ');
}

async function generatePipelineAAsset(
  productBuffer: Buffer,
  niche: string,
  platform: string,
  analysis: PipelineAImageAnalysis,
  creative: CreativeDirection,
  adContent: PipelineAAdContent
): Promise<Buffer> {
  try {
    const generated = await withTimeout(
      () => generateImageFromCutout({
        cutoutBuffer: productBuffer,
        niche,
        platform,
        productName: analysis.subjectLabel,
        subjectKind: analysis.subjectKind,
        marketingContext: buildPipelineAMarketingContext(analysis, platform, adContent),
        creativeTheme: creative.theme,
        colorDirection: `${creative.palette.primary}, ${creative.palette.secondary}, ${creative.palette.accent}`,
        overlayTextIntent: `${creative.badge}; headline "${creative.headline}"; subline "${creative.subline}"; CTA "${creative.cta}"`,
        productPlacement: creative.productPlacement,
        textZone: creative.textZone,
        renderMode: 'complete_ad',
      }),
      PIPELINE_A_AD_TIMEOUT_MS,
      `Pipeline A ${platform} complete ad generation timed out after ${PIPELINE_A_AD_TIMEOUT_MS}ms`
    );
    return renderPipelineBBanner(
      generated,
      platform,
      { name: analysis.subjectLabel || adContent.campaignAngle || 'Sản phẩm' },
      creative,
      'AI product banner'
    );
  } catch (error) {
    throw new Error(`Pipeline A ${platform} OpenAI banner generation failed: ${(error as Error).message}`);
  }
}

async function generatePhotorealisticProductScene(
  productBuffer: Buffer,
  niche: string,
  platform: string,
  product: { name?: string; price?: number; rating?: number; sold?: number; discount?: number },
  creative: CreativeDirection
): Promise<Buffer> {
  try {
    return await generateImageFromCutout({
      cutoutBuffer: productBuffer,
      niche,
      platform,
      productName: product.name ? shortProductName(product.name) : undefined,
      marketingContext: buildPipelineBMarketingContext(product, niche, platform),
      creativeTheme: creative.theme,
      colorDirection: `${creative.palette.primary}, ${creative.palette.secondary}, ${creative.palette.accent}`,
      overlayTextIntent: `${creative.badge}; headline "${creative.headline}"; subline "${creative.subline}"; CTA "${creative.cta}"`,
      productPlacement: creative.productPlacement,
      textZone: creative.textZone,
    });
  } catch (error) {
    console.warn(`[Visual] Photorealistic image edit fallback for ${platform}: ${(error as Error).message}`);
    const bgPrompt = buildBgPrompt(niche, platform, product, creative);
    const bgBuffer = await generateBackground(bgPrompt, platform);
    return compositeImages(bgBuffer, productBuffer, platform, creative);
  }
}

async function compositeImages(
  bgBuffer: Buffer,
  productBuffer: Buffer,
  platform: string,
  creative?: CreativeDirection
): Promise<Buffer> {
  const { default: sharp } = await import('sharp');

  const bgMeta = await sharp(bgBuffer).metadata();
  const bgWidth = bgMeta.width ?? 1024;
  const bgHeight = bgMeta.height ?? 1024;
  const scaleMap: Record<string, number> = { tiktok: 0.62, facebook: 0.50, instagram: 0.58, youtube: 0.48, zalo: 0.48 };
  const scale = scaleMap[platform] ?? 0.60;
  const prodWidth = Math.floor(bgWidth * scale);
  const prodHeight = Math.floor(bgHeight * 0.82);

  const resized = await sharp(productBuffer)
    .resize(prodWidth, prodHeight, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const prodMeta = await sharp(resized).metadata();
  const finalProdWidth = Math.min(prodMeta.width ?? prodWidth, bgWidth);
  const finalProdHeight = Math.min(prodMeta.height ?? prodHeight, bgHeight);

  const placement = creative?.productPlacement
    ?? ({ tiktok: 'bottom', facebook: 'right', instagram: 'center', youtube: 'right', zalo: 'right' }[platform] as CreativeDirection['productPlacement'])
    ?? 'center';

  let left = Math.floor((bgWidth - finalProdWidth) / 2);
  let top  = Math.floor((bgHeight - finalProdHeight) / 2);

  if (placement === 'right') {
    left = bgWidth - finalProdWidth - Math.round(bgWidth * 0.06);
    top  = Math.floor((bgHeight - finalProdHeight) / 2);
  } else if (placement === 'left') {
    left = Math.round(bgWidth * 0.06);
    top  = Math.floor((bgHeight - finalProdHeight) / 2);
  } else if (placement === 'bottom') {
    left = Math.floor((bgWidth - finalProdWidth) / 2);
    top = bgHeight - finalProdHeight - Math.round(bgHeight * 0.07);
  }

  left = clamp(left, 0, Math.max(0, bgWidth - finalProdWidth));
  top = clamp(top, 0, Math.max(0, bgHeight - finalProdHeight));

  const shadow = await createProductShadow(finalProdWidth, finalProdHeight);
  const shadowLeft = clamp(left + 16, 0, Math.max(0, bgWidth - finalProdWidth));
  const shadowTop = clamp(top + 22, 0, Math.max(0, bgHeight - finalProdHeight));

  return sharp(bgBuffer).composite([
    { input: shadow, left: shadowLeft, top: shadowTop, blend: 'multiply' },
    { input: resized, left, top },
  ]).jpeg({ quality: 95 }).toBuffer();
}

async function addTextOverlay(
  buffer: Buffer, platform: string,
  product: { name: string; price?: number; rating?: number; sold?: number; discount?: number }
): Promise<Buffer> {
  // Simple overlay using sharp SVG composite
  const { default: sharp } = await import('sharp');
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1080;

  const discount = product.discount ? `GIẢM ${product.discount}%` : '';
  const social   = product.rating ? `⭐ ${product.rating} · Đã bán ${(product.sold ?? 0).toLocaleString()}+` : '';
  const price    = product.price ? `${product.price.toLocaleString()}đ` : '';

  const svgText = `
    <svg width="${w}" height="${h}">
      ${discount ? `<rect x="40" y="${h - 200}" width="200" height="50" rx="8" fill="#E8500A"/>
      <text x="50" y="${h - 165}" font-family="Arial" font-size="28" font-weight="bold" fill="white">${discount}</text>` : ''}
      ${price ? `<text x="40" y="${h - 100}" font-family="Arial" font-size="36" font-weight="bold" fill="#FFD700">${price}</text>` : ''}
      ${social ? `<text x="40" y="${h - 55}" font-family="Arial" font-size="20" fill="white">${social}</text>` : ''}
    </svg>`;

  return sharp(buffer).composite([{ input: Buffer.from(svgText), blend: 'over' }]).jpeg({ quality: 95 }).toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
async function addCreativeTextOverlay(
  buffer: Buffer,
  platform: string,
  product: { name: string; price?: number; rating?: number; sold?: number; discount?: number },
  creative: CreativeDirection
): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1080;
  const zone = getTextZone(w, h, creative.textZone);
  const pad = Math.max(22, Math.round(Math.min(w, h) * 0.032));
  const maxTextWidth = zone.width - pad * 2;
  const headlineSize = fitTextSize(creative.headline, maxTextWidth, platform === 'tiktok' ? 82 : 64, platform === 'zalo' ? 36 : 42);
  const sublineSize = fitTextSize(creative.subline, maxTextWidth, platform === 'tiktok' ? 33 : 27, 18);
  const headlineLines = wrapTextByWidth(creative.headline, maxTextWidth, headlineSize, 2);
  const sublineLines = wrapTextByWidth(creative.subline, maxTextWidth, sublineSize, 2);
  const price = product.price ? `${product.price.toLocaleString('vi-VN')}d` : '';
  const social = product.rating ? `${product.rating.toFixed(1)} sao - đã bán ${(product.sold ?? 0).toLocaleString('vi-VN')}+` : '';
  const badge = product.discount ? `GIẢM ${product.discount}%` : creative.badge;
  const palette = creative.palette;
  const textColor = readableTextColor(palette.text);
  const mutedColor = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.86)' : 'rgba(17,24,39,0.78)';
  const panelFill = textColor === '#FFFFFF' ? 'rgba(17,24,39,0.34)' : 'rgba(255,255,255,0.68)';
  const panelStroke = textColor === '#FFFFFF' ? 'rgba(255,255,255,0.18)' : 'rgba(17,24,39,0.10)';
  const badgeFill = palette.accent;
  const badgeText = contrastTextColor(badgeFill);
  const headlineY = zone.y + pad + 82;
  const headlineLineGap = Math.round(headlineSize * 1.04);
  const sublineY = headlineY + headlineLines.length * headlineLineGap + Math.round(sublineSize * 0.9);
  const sublineLineGap = Math.round(sublineSize * 1.35);
  const ctaWidth = Math.min(Math.max(132, creative.cta.length * 13 + 48), Math.max(120, zone.width - pad * 2));
  const ctaHeight = Math.max(42, Math.round(Math.min(w, h) * 0.048));
  const ctaX = zone.x + pad;
  const ctaY = Math.min(
    zone.y + zone.height - pad - ctaHeight,
    sublineY + sublineLines.length * sublineLineGap + Math.round(sublineSize * 0.85)
  );
  const priceY = ctaY - 22;

  const svgText = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.20"/>
        </filter>
      </defs>
      <rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" rx="24" fill="${panelFill}" stroke="${panelStroke}" filter="url(#softShadow)"/>
      <rect x="${zone.x + pad}" y="${zone.y + pad}" width="${Math.min(Math.max(88, badge.length * 11 + 38), zone.width - pad * 2)}" height="38" rx="19" fill="${badgeFill}"/>
      <text x="${zone.x + pad + 19}" y="${zone.y + pad + 25}" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="800" letter-spacing="1.8" fill="${badgeText}">${escapeXml(badge)}</text>
      ${headlineLines.map((line, index) =>
        `<text x="${zone.x + pad}" y="${headlineY + index * headlineLineGap}" font-family="Inter, Arial, sans-serif" font-size="${headlineSize}" font-weight="900" letter-spacing="0" fill="${textColor}">${escapeXml(line)}</text>`
      ).join('')}
      ${sublineLines.map((line, index) =>
        `<text x="${zone.x + pad}" y="${sublineY + index * sublineLineGap}" font-family="Inter, Arial, sans-serif" font-size="${sublineSize}" font-weight="600" fill="${mutedColor}">${escapeXml(line)}</text>`
      ).join('')}
      ${price ? `<text x="${zone.x + pad}" y="${priceY}" font-family="Inter, Arial, sans-serif" font-size="${Math.round(headlineSize * 0.58)}" font-weight="900" fill="${palette.accent}">${escapeXml(price)}</text>` : ''}
      ${social ? `<text x="${zone.x + pad}" y="${priceY + 34}" font-family="Inter, Arial, sans-serif" font-size="19" font-weight="600" fill="${mutedColor}">${escapeXml(social)}</text>` : ''}
      <rect x="${ctaX}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${palette.primary}"/>
      <text x="${ctaX + 24}" y="${ctaY + Math.round(ctaHeight * 0.64)}" font-family="Inter, Arial, sans-serif" font-size="${Math.min(20, Math.max(16, ctaHeight - 24))}" font-weight="800" fill="${contrastTextColor(palette.primary)}">${escapeXml(creative.cta)}</text>
    </svg>`;

  return sharp(buffer).composite([{ input: Buffer.from(svgText), blend: 'over' }]).jpeg({ quality: 95 }).toBuffer();
}

async function renderPipelineBBanner(
  buffer: Buffer,
  platform: string,
  product: { name: string; price?: number; rating?: number; sold?: number; discount?: number },
  creative: CreativeDirection,
  sourceLabel = 'Lazada/Shopee deal'
): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const dimensions = platformDimensions(platform);
  const normalized = await sharp(buffer, { failOn: 'none' })
    .resize(dimensions.width, dimensions.height, { fit: 'cover' })
    .jpeg({ quality: 96 })
    .toBuffer();
  const meta = await sharp(normalized).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1080;
  const layout = getPipelineBTextLayout(w, h, platform, creative.textZone);
  const pad = layout.pad;
  const maxTextWidth = layout.width - pad * 2;
  const productName = titleCaseVi(cleanMarketingTitle(product.name));
  const headline = limitWords(creative.headline || productName, platform === 'tiktok' ? 6 : 5);
  const subline = limitWords(creative.subline || productName, platform === 'tiktok' ? 12 : 10);
  const headlineSize = fitTextSize(headline, maxTextWidth, layout.headlineSize, layout.minHeadlineSize);
  const sublineSize = fitTextSize(subline, maxTextWidth, layout.sublineSize, 18);
  const headlineLines = wrapTextByWidth(headline, maxTextWidth, headlineSize, 2);
  const sublineLines = wrapTextByWidth(subline, maxTextWidth, sublineSize, 2);
  const price = formatVnd(product.price);
  const originalPrice = product.discount && product.price
    ? `Tiết kiệm ${product.discount}%`
    : socialProofText(product);
  const badge = product.discount ? `Giảm ${product.discount}%` : creative.badge;
  const badgeText = titleCaseVi(limitWords(badge, 4));
  const textColor = '#FFFFFF';
  const mutedColor = 'rgba(255,255,255,0.82)';
  const accent = creative.palette.accent || '#FDE047';
  const accentText = contrastTextColor(accent);
  const cta = creative.cta || 'Xem deal';
  const ctaWidth = Math.min(Math.max(138, cta.length * 12 + 56), maxTextWidth);
  const ctaHeight = Math.round(Math.max(42, Math.min(w, h) * 0.055));
  const headlineY = layout.y + pad + layout.badgeHeight + Math.round(headlineSize * 1.12);
  const headlineGap = Math.round(headlineSize * 1.05);
  const sublineY = headlineY + headlineLines.length * headlineGap + Math.round(sublineSize * 0.9);
  const sublineGap = Math.round(sublineSize * 1.32);
  const priceY = sublineY + sublineLines.length * sublineGap + Math.round(headlineSize * 0.78);
  const ctaY = Math.min(layout.y + layout.height - pad - ctaHeight, priceY + Math.round(headlineSize * 0.42));
  const scrim = buildPipelineBScrim(w, h, creative.textZone);

  const svg = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="scrim" x1="${scrim.x1}" y1="${scrim.y1}" x2="${scrim.x2}" y2="${scrim.y2}">
          <stop offset="0%" stop-color="#05070D" stop-opacity="${scrim.strong}"/>
          <stop offset="58%" stop-color="#05070D" stop-opacity="${scrim.mid}"/>
          <stop offset="100%" stop-color="#05070D" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="7" stdDeviation="12" flood-color="#000000" flood-opacity="0.34"/>
        </filter>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#scrim)"/>
      <g filter="url(#shadow)">
        <rect x="${layout.x + pad}" y="${layout.y + pad}" width="${Math.min(Math.max(102, badgeText.length * 10 + 38), maxTextWidth)}" height="${layout.badgeHeight}" rx="${Math.round(layout.badgeHeight / 2)}" fill="${accent}"/>
        <text x="${layout.x + pad + 19}" y="${layout.y + pad + Math.round(layout.badgeHeight * 0.65)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(layout.badgeHeight * 0.42)}" font-weight="800" fill="${accentText}">${escapeXml(badgeText)}</text>
        ${headlineLines.map((line, index) =>
          `<text x="${layout.x + pad}" y="${headlineY + index * headlineGap}" font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="900" letter-spacing="0" fill="${textColor}">${escapeXml(line)}</text>`
        ).join('')}
        ${sublineLines.map((line, index) =>
          `<text x="${layout.x + pad}" y="${sublineY + index * sublineGap}" font-family="Arial, Helvetica, sans-serif" font-size="${sublineSize}" font-weight="600" fill="${mutedColor}">${escapeXml(line)}</text>`
        ).join('')}
        ${price ? `<text x="${layout.x + pad}" y="${priceY}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(headlineSize * 0.58)}" font-weight="900" fill="${accent}">${escapeXml(price)}</text>` : ''}
        ${originalPrice ? `<text x="${layout.x + pad}" y="${priceY + Math.round(headlineSize * 0.52)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(18, Math.round(sublineSize * 0.86))}" font-weight="600" fill="${mutedColor}">${escapeXml(originalPrice)}</text>` : ''}
        <rect x="${layout.x + pad}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="${creative.palette.primary}"/>
        <text x="${layout.x + pad + 24}" y="${ctaY + Math.round(ctaHeight * 0.64)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(16, Math.round(ctaHeight * 0.38))}" font-weight="800" fill="${contrastTextColor(creative.palette.primary)}">${escapeXml(cta)}</text>
        <text x="${layout.x + pad}" y="${layout.y + layout.height - Math.round(pad * 0.45)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(13, Math.round(sublineSize * 0.62))}" font-weight="600" fill="rgba(255,255,255,0.58)">${escapeXml(sourceLabel)}</text>
      </g>
    </svg>`;

  return sharp(normalized).composite([{ input: Buffer.from(svg), blend: 'over' }]).jpeg({ quality: 96 }).toBuffer();
}

function platformDimensions(platform: string): { width: number; height: number } {
  const dimensions: Record<string, { width: number; height: number }> = {
    tiktok: { width: 1080, height: 1920 },
    facebook: { width: 1200, height: 628 },
    instagram: { width: 1080, height: 1080 },
    youtube: { width: 1280, height: 720 },
    zalo: { width: 700, height: 400 },
  };
  return dimensions[platform] ?? dimensions.instagram;
}

function getPipelineBTextLayout(width: number, height: number, platform: string, zone: CreativeDirection['textZone']): {
  x: number; y: number; width: number; height: number; pad: number;
  headlineSize: number; minHeadlineSize: number; sublineSize: number; badgeHeight: number;
} {
  const basePad = Math.round(Math.min(width, height) * 0.055);
  const wide = width > height;
  const leftZone = zone === 'left' || (wide && zone !== 'right');
  const rightZone = zone === 'right';
  const verticalTop = zone === 'top';
  const x = rightZone ? Math.round(width * 0.50) : leftZone ? Math.round(width * 0.04) : Math.round(width * 0.07);
  const y = verticalTop ? Math.round(height * 0.055) : zone === 'bottom' ? Math.round(height * 0.52) : Math.round(height * 0.11);
  const boxWidth = wide
    ? Math.round(width * 0.45)
    : Math.round(width * 0.88);
  const boxHeight = wide
    ? Math.round(height * 0.80)
    : zone === 'bottom' ? Math.round(height * 0.40) : Math.round(height * 0.42);

  return {
    x,
    y,
    width: Math.min(boxWidth, width - x - Math.round(width * 0.04)),
    height: Math.min(boxHeight, height - y - Math.round(height * 0.04)),
    pad: basePad,
    headlineSize: platform === 'tiktok' ? 74 : wide ? 58 : 62,
    minHeadlineSize: platform === 'tiktok' ? 42 : 34,
    sublineSize: platform === 'tiktok' ? 30 : 24,
    badgeHeight: platform === 'tiktok' ? 46 : 38,
  };
}

function buildPipelineBScrim(width: number, height: number, zone: CreativeDirection['textZone']): {
  x1: string; y1: string; x2: string; y2: string; strong: number; mid: number;
} {
  if (zone === 'right') return { x1: '1', y1: '0', x2: '0', y2: '0', strong: 0.76, mid: 0.34 };
  if (zone === 'top') return { x1: '0', y1: '0', x2: '0', y2: '1', strong: height > width ? 0.74 : 0.62, mid: 0.22 };
  if (zone === 'bottom') return { x1: '0', y1: '1', x2: '0', y2: '0', strong: 0.78, mid: 0.28 };
  return { x1: '0', y1: '0', x2: '1', y2: '0', strong: 0.76, mid: 0.34 };
}

function cleanMarketingTitle(name: string): string {
  return name
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(chính hãng|hàng mới|new|authentic|sale|hot|deal|lazada|shopee)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 7)
    .join(' ');
}

function titleCaseVi(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_, space: string, char: string) => `${space}${char.toUpperCase()}`);
}

function limitWords(value: string, maxWords: number): string {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

function formatVnd(value?: number): string {
  if (!value || value <= 0) return '';
  return `${Math.round(value).toLocaleString('vi-VN')}đ`;
}

function socialProofText(product: { rating?: number; sold?: number }): string {
  const parts: string[] = [];
  if (product.rating && product.rating > 0) parts.push(`${product.rating.toFixed(1)} sao`);
  if (product.sold && product.sold > 0) parts.push(`${product.sold.toLocaleString('vi-VN')}+ đã bán`);
  return parts.join(' · ');
}

function buildCreativeDirection(niche: string, platform: string, product: VisualProductData): CreativeDirection {
  const palettes: Record<string, CreativeDirection['palette']> = {
    beauty: { primary: '#DB2777', secondary: '#FDF2F8', accent: '#FDE047', text: '#FFFFFF' },
    tech: { primary: '#2563EB', secondary: '#DBEAFE', accent: '#22D3EE', text: '#FFFFFF' },
    food: { primary: '#EA580C', secondary: '#FFF7ED', accent: '#FACC15', text: '#FFFFFF' },
    fashion: { primary: '#7C3AED', secondary: '#F5F3FF', accent: '#F0ABFC', text: '#FFFFFF' },
    home: { primary: '#059669', secondary: '#ECFDF5', accent: '#A7F3D0', text: '#FFFFFF' },
    health: { primary: '#0D9488', secondary: '#ECFEFF', accent: '#67E8F9', text: '#FFFFFF' },
  };

  const themes: Record<string, string[]> = {
    beauty: ['premium skincare studio with soft light', 'clean vanity counter campaign', 'modern beauty shelf hero scene'],
    tech: ['premium desk setup with crisp reflections', 'clean tech launch scene', 'modern device showroom'],
    food: ['fresh editorial kitchen scene', 'bright appetizing product scene', 'clean market-inspired setup'],
    fashion: ['magazine retail campaign', 'boutique product display', 'minimal editorial styling'],
    home: ['warm interior refresh', 'clean lifestyle corner', 'modern home decor scene'],
    health: ['wellness morning routine', 'fresh supplement studio', 'clean active lifestyle scene'],
  };

  const placementByPlatform: Record<string, CreativeDirection['productPlacement']> = {
    tiktok: 'bottom',
    facebook: 'right',
    instagram: 'center',
    youtube: 'right',
    zalo: 'right',
  };
  const textZoneByPlatform: Record<string, CreativeDirection['textZone']> = {
    tiktok: 'top',
    facebook: 'left',
    instagram: 'bottom',
    youtube: 'left',
    zalo: 'left',
  };

  const name = titleCaseVi(cleanMarketingTitle(product.name));
  const badge = product.discount ? `Giảm ${product.discount}%` : 'Deal đáng xem';
  const socialProof = product.rating
    ? `${product.rating.toFixed(1)} sao - ${(product.sold ?? 0).toLocaleString('vi-VN')}+ đã bán`
    : 'Được nhiều người quan tâm';
  const benefit = benefitByNiche(niche);

  return {
    theme: pickStable(themes[niche] ?? themes.beauty, `${product.name}:${platform}`),
    palette: palettes[niche] ?? palettes.beauty,
    headline: platform === 'youtube' ? badge : conciseHeadline(name, niche, platform),
    subline: platform === 'instagram' ? `${benefit} - ${socialProof}` : `${benefit} - ${socialProof}`,
    cta: platform === 'youtube' ? 'Xem ngay' : 'Xem deal',
    badge,
    productPlacement: placementByPlatform[platform] ?? 'center',
    textZone: textZoneByPlatform[platform] ?? 'left',
  };
}

function buildPipelineBMarketingContext(
  product: { name?: string; price?: number; rating?: number; sold?: number; discount?: number },
  niche: string,
  platform: string
): string {
  const parts = [
    product.name ? `product ${shortProductName(product.name)}` : `${niche} product`,
    `${niche} affiliate campaign`,
    `${platform} placement`,
    product.discount ? `${product.discount}% discount` : '',
    product.rating ? `${product.rating.toFixed(1)} star rating` : '',
    product.sold ? `${product.sold.toLocaleString('vi-VN')} sold` : '',
  ];
  return parts.filter(Boolean).join(', ');
}

function conciseHeadline(name: string, niche: string, platform: string): string {
  if (platform === 'tiktok') return 'Đáng thử thật';
  if (platform === 'facebook') return 'Deal đáng xem';
  if (platform === 'zalo') return 'Ưu đãi hôm nay';
  return name || benefitByNiche(niche);
}

function benefitByNiche(niche: string): string {
  return ({
    beauty: 'Nâng tầm routine',
    tech: 'Gọn hơn, tiện hơn',
    food: 'Ngon và tiện lợi',
    fashion: 'Dễ phối mỗi ngày',
    home: 'Nhà gọn đẹp hơn',
    health: 'Chăm sóc mỗi ngày',
  } as Record<string, string>)[niche] ?? 'Đáng để thử';
}

async function createProductShadow(width: number, height: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="blur"><feGaussianBlur stdDeviation="${Math.max(10, Math.round(width * 0.035))}"/></filter>
      </defs>
      <ellipse cx="${Math.round(width / 2)}" cy="${Math.round(height * 0.88)}" rx="${Math.round(width * 0.34)}" ry="${Math.round(height * 0.08)}" fill="#000000" opacity="0.34" filter="url(#blur)"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function getTextZone(width: number, height: number, zone: CreativeDirection['textZone']): {
  x: number; y: number; width: number; height: number;
} {
  if (zone === 'top') {
    return { x: Math.round(width * 0.06), y: Math.round(height * 0.05), width: Math.round(width * 0.88), height: Math.round(height * 0.31) };
  }
  if (zone === 'bottom') {
    return { x: Math.round(width * 0.06), y: Math.round(height * 0.64), width: Math.round(width * 0.88), height: Math.round(height * 0.30) };
  }
  if (zone === 'right') {
    return { x: Math.round(width * 0.52), y: Math.round(height * 0.13), width: Math.round(width * 0.40), height: Math.round(height * 0.70) };
  }
  return { x: Math.round(width * 0.07), y: Math.round(height * 0.13), width: Math.round(width * 0.40), height: Math.round(height * 0.70) };
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length > 0 ? lines : ['DEAL HOT'];
}

function fitTextSize(text: string, maxWidth: number, preferred: number, min: number): number {
  const longestWord = text.split(/\s+/).reduce((longest, word) => Math.max(longest, word.length), 1);
  const approximateWidth = Math.max(longestWord, Math.min(text.length, 18)) * preferred * 0.58;
  if (approximateWidth <= maxWidth) return preferred;
  return Math.max(min, Math.floor(preferred * (maxWidth / approximateWidth)));
}

function wrapTextByWidth(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const maxChars = Math.max(8, Math.floor(maxWidth / (fontSize * 0.55)));
  return wrapText(text, maxChars, maxLines);
}

function readableTextColor(color: string): '#FFFFFF' | '#111827' {
  return relativeLuminance(color) < 0.45 ? '#FFFFFF' : '#111827';
}

function contrastTextColor(background: string): '#FFFFFF' | '#111827' {
  return relativeLuminance(background) < 0.55 ? '#FFFFFF' : '#111827';
}

function relativeLuminance(hex: string): number {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '111827';
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(normalized.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function shortProductName(name: string): string {
  const cleaned = name
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').slice(0, 5).join(' ').toUpperCase() || 'SẢN PHẨM HOT';
}

function carouselBenefitByNiche(niche: string): string {
  const copy: Record<string, string> = {
    beauty: 'Cho routine đẹp hơn mỗi ngày',
    tech: 'Nâng cấp setup gọn và xịn hơn',
    food: 'Dễ ăn ngon hơn mà không cầu kỳ',
    fashion: 'Để outfit có điểm nhấn hơn',
    home: 'Làm không gian gọn và đẹp hơn',
    health: 'Hỗ trợ thói quen sống khoẻ',
  };
  return copy[niche] ?? 'Lựa chọn đáng cân nhắc hôm nay';
}

function pickStable<T>(items: T[], seed: string): T {
  const sum = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return items[sum % items.length];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildVisualTempPath(userId: string, label: string, ext: string): string {
  const dir = join(tmpdir(), 'affiliateai-visual-c');
  mkdirSync(dir, { recursive: true });
  const userTag = userId.slice(0, 8);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return join(dir, `${userTag}_${label}_${suffix}.${ext}`);
}

async function getFfmpegPath(): Promise<string> {
  const { default: ffmpegPath } = await import('ffmpeg-static').catch(() => ({ default: 'ffmpeg' }));
  return String(ffmpegPath || 'ffmpeg');
}

async function getFfmpeg(): Promise<any> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  const ffmpegPath = await getFfmpegPath();
  if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
    ffmpeg.setFfmpegPath(ffmpegPath);
  }
  return ffmpeg;
}

async function getVideoDuration(input: string): Promise<number> {
  const ffmpeg = await getFfmpeg();
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (error: Error | undefined, data: { format?: { duration?: number } }) => {
      if (error) {
        reject(error);
        return;
      }
      const duration = Number(data?.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('Unable to detect video duration'));
        return;
      }
      resolve(duration);
    });
  });
}

async function extractAudioForTranscription(input: string, output: string): Promise<void> {
  const ffmpegPath = await getFfmpegPath();
  const args = ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', output];

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr || stdout || error.message;
        reject(new Error(`ffmpeg audio extract failed: ${detail}`));
        return;
      }
      resolve();
    });
  });
}

function isNoAudioStreamError(error: unknown): boolean {
  const message = (error as Error | undefined)?.message?.toLowerCase() ?? '';
  return (
    message.includes('output file does not contain any stream')
    || message.includes('does not contain any stream')
    || message.includes('stream #0:0')
    || message.includes('invalid argument')
  );
}

async function transcribeVideo(videoPath: string, options: { preferTimestamps?: boolean } = {}): Promise<{
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
  segments: Array<{ text: string; start: number; end: number }>;
  duration: number;
}> {
  const { default: OpenAI } = await import('openai');
  const { default: fs } = await import('fs');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const configuredModel = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';
  const model = options.preferTimestamps
    ? (process.env.OPENAI_SUBTITLE_TRANSCRIPTION_MODEL || (isWhisperTranscriptionModel(configuredModel) ? configuredModel : 'whisper-1'))
    : configuredModel;
  const supportsVerboseJson = isWhisperTranscriptionModel(model);
  const request: Record<string, unknown> = {
    file: fs.createReadStream(videoPath) as any,
    model,
    language: 'vi',
    response_format: supportsVerboseJson ? 'verbose_json' : 'json',
  };

  if (supportsVerboseJson) {
    request.timestamp_granularities = ['word', 'segment'];
  }

  const transcript = await openai.audio.transcriptions.create(request as any);
  const text = (typeof transcript === 'string' ? transcript : transcript.text) ?? '';
  const duration = (transcript as any).duration ?? await getVideoDuration(videoPath).catch(() => 0);
  const segments = (transcript as any).segments ?? estimateTranscriptSegments(text, duration);
  const rawWords = (transcript as any).words;
  const words = Array.isArray(rawWords) && rawWords.length > 0
    ? rawWords
    : estimateWordsFromSegments(segments);

  return {
    text,
    words,
    segments,
    duration,
  };
}

function isWhisperTranscriptionModel(model: string): boolean {
  return /^whisper-1(?:$|[-.:])/.test(model.trim().toLowerCase());
}

function estimateTranscriptSegments(text: string, duration: number): Array<{ text: string; start: number; end: number }> {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const chunks = sentences.length > 0 ? sentences : [clean];
  const safeDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : Math.max(3, clean.split(/\s+/).length * 0.45);
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || clean.length;

  let cursor = 0;
  return chunks.map((chunk, index) => {
    const proportional = index === chunks.length - 1
      ? safeDuration - cursor
      : (chunk.length / totalChars) * safeDuration;
    const segmentDuration = Math.max(0.1, proportional);
    const start = round2(cursor);
    const end = round2(Math.min(safeDuration, cursor + segmentDuration));
    cursor = end;
    return { text: chunk, start, end };
  }).filter(segment => segment.end > segment.start);
}

function estimateWordsFromSegments(segments: Array<{ text: string; start: number; end: number }>): Array<{ word: string; start: number; end: number }> {
  const words: Array<{ word: string; start: number; end: number }> = [];
  for (const segment of segments) {
    const parts = segment.text
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    if (parts.length === 0 || segment.end <= segment.start) continue;

    const slot = (segment.end - segment.start) / parts.length;
    parts.forEach((word, index) => {
      const start = segment.start + slot * index;
      const end = index === parts.length - 1
        ? segment.end
        : segment.start + slot * (index + 1);
      words.push({
        word,
        start: round2(start),
        end: round2(Math.max(start + 0.08, end)),
      });
    });
  }
  return words;
}

async function transcribeCutClipForSubtitles(
  clipPath: string,
  clipAudioPath: string,
  fallback: {
    text: string;
    words: Array<{ word: string; start: number; end: number }>;
    segments: Array<{ text: string; start: number; end: number }>;
  } | null
): Promise<{
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
  segments: Array<{ text: string; start: number; end: number }>;
} | null> {
  try {
    await extractAudioForTranscription(clipPath, clipAudioPath);
    const transcript = await transcribeVideo(clipAudioPath, { preferTimestamps: true });
    const duration = await getVideoDuration(clipPath).catch(() => transcript.duration);
    return normalizeClipTranscriptTiming(transcript, duration);
  } catch (error) {
    console.warn(`[Visual] Clip subtitle transcription fallback: ${(error as Error).message}`);
    return fallback;
  }
}

function normalizeClipTranscriptTiming(
  transcript: {
    text: string;
    words: Array<{ word: string; start: number; end: number }>;
    segments: Array<{ text: string; start: number; end: number }>;
    duration?: number;
  },
  clipDuration: number
): {
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
  segments: Array<{ text: string; start: number; end: number }>;
} {
  const safeDuration = Number.isFinite(clipDuration) && clipDuration > 0
    ? clipDuration
    : Math.max(0, transcript.duration ?? 0);

  const segments = transcript.segments
    .map(segment => ({
      text: segment.text.trim(),
      start: round2(clamp(segment.start, 0, safeDuration)),
      end: round2(clamp(segment.end, 0, safeDuration)),
    }))
    .filter(segment => segment.text && segment.end > segment.start);

  const words = transcript.words
    .map(word => ({
      word: word.word.trim(),
      start: round2(clamp(word.start, 0, safeDuration)),
      end: round2(clamp(word.end, 0, safeDuration)),
    }))
    .filter(word => word.word && word.end > word.start);

  return {
    text: transcript.text,
    words: words.length > 0 ? words : estimateWordsFromSegments(segments),
    segments,
  };
}

async function findHighlight(transcript: {
  text: string; segments: Array<{ text: string; start: number; end: number }>;
}, clipDuration = 45): Promise<{ start: number; end: number; hook_text: string; hook_frame_time?: number }> {
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_VIDEO_AGENT_MODEL || 'gpt-5.5',
    messages: [
      {
        role: 'system',
        content: [
          'Bạn là editor video affiliate ngắn cho TikTok/Reels.',
          'Chọn một đoạn liên tục có thể đứng độc lập, giữ người xem và có giá trị bán hàng tự nhiên.',
          'Trả JSON hợp lệ duy nhất, không markdown, không giải thích.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Hãy tìm đoạn tối đa ${clipDuration} giây hay nhất để cắt thành video dọc.`,
          'Tiêu chí:',
          '- 1-3 giây đầu có hook rõ, tránh lời chào hoặc mở đầu lan man.',
          '- Có review/demo/vấn đề-giải pháp/bằng chứng/lý do mua.',
          '- Không chọn đoạn chỉ nói giá hoặc CTA cứng nếu thiếu ngữ cảnh.',
          '- Kết thúc ở một ý trọn vẹn hoặc CTA nhẹ.',
          '- hook_text là tiếng Việt tự nhiên, tối đa 80 ký tự.',
          '- hook_frame_time nằm trong đoạn được chọn và là khoảnh khắc đẹp để làm title/thumbnail.',
          `Segments: ${JSON.stringify(transcript.segments.slice(0, 40))}`,
          'Trả về đúng JSON shape:',
          '{"start": 5.2, "end": 50.1, "hook_text": "Đoạn đáng xem nhất", "hook_frame_time": 6.0}',
        ].join('\n'),
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 260,
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content ?? '{}');
    const start = Math.max(0, Number(parsed.start) || 0);
    const end = Math.max(start + 1, Number(parsed.end) || (start + clipDuration));
    return {
      start,
      end: Math.min(end, start + clipDuration),
      hook_text: parsed.hook_text ?? '',
      hook_frame_time: Number(parsed.hook_frame_time) || start,
    };
  } catch {
    return {
      start: 0,
      end: Math.min(clipDuration, (transcript as any).duration ?? clipDuration),
      hook_text: transcript.segments[0]?.text ?? '',
    };
  }
}

async function findHighlightForClip(transcript: {
  text: string;
  segments: Array<{ text: string; start: number; end: number }>;
  duration?: number;
}, clipDuration = 45, videoDuration = 45): Promise<PipelineCHighlight> {
  const cleanedSegments = transcript.segments
    .filter(segment => segment.text?.trim())
    .map(segment => ({
      start: round2(segment.start),
      end: round2(segment.end),
      text: segment.text.trim().replace(/\s+/g, ' '),
    }));

  if (cleanedSegments.length === 0) {
    return buildFallbackHighlight(videoDuration, clipDuration, transcript.text);
  }

  const segmentSummary = cleanedSegments
    .slice(0, 120)
    .map((segment, index) => `${index + 1}. [${segment.start}-${segment.end}] ${segment.text}`)
    .join('\n')
    .slice(0, 12_000);

  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_VIDEO_AGENT_MODEL || 'gpt-5.5',
      messages: [
        {
          role: 'system',
          content: [
            'You are a Vietnamese short-form affiliate video editor.',
            'Pick one contiguous highlight that can become a complete vertical clip.',
            'Return valid JSON only, with no markdown or explanation.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Choose the strongest TikTok/Reels highlight, maximum ${clipDuration} seconds.`,
            `Source duration: ${round2(videoDuration)} seconds.`,
            'Selection rules:',
            '- Skip weak greetings, filler, and long setup when possible.',
            '- The first 1-3 seconds must make sense and create curiosity.',
            '- Prefer product review, demo, problem-solution, result, comparison, objection handling, or soft recommendation.',
            '- Avoid choosing a segment that is only price/discount unless it includes a reason to buy.',
            '- End on a complete thought, payoff, or natural CTA.',
            '- hook_text must be Vietnamese, natural, punchy, and max 80 characters.',
            '- hook_frame_time must be inside the selected window and point to the best title/thumbnail moment.',
            'Transcript segments:',
            segmentSummary,
            'Return exactly this JSON shape:',
            '{"start": 12.5, "end": 52.5, "hook_text": "Cau mo dau ngan gon", "hook_frame_time": 14.0}',
          ].join('\n'),
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 280,
    });

    const parsed = JSON.parse(res.choices[0].message.content ?? '{}');
    return normalizeHighlightWindow({
      start: Number(parsed.start),
      end: Number(parsed.end),
      hook_text: typeof parsed.hook_text === 'string' ? parsed.hook_text : cleanedSegments[0]?.text ?? '',
      hook_frame_time: Number(parsed.hook_frame_time),
      opening_caption: typeof parsed.opening_caption === 'string' ? parsed.opening_caption : '',
    }, videoDuration, clipDuration);
  } catch {
    return heuristicHighlightFromTranscript(cleanedSegments, videoDuration, clipDuration);
  }
}

async function planPipelineCHighlight(transcript: {
  text: string;
  segments: Array<{ text: string; start: number; end: number }>;
  duration?: number;
}, clipDuration = 45, videoDuration = 45): Promise<PipelineCHighlight> {
  try {
    const plan = await generateVideoEditPlan({
      transcriptText: transcript.text,
      segments: transcript.segments,
      clipDuration,
      videoDuration,
    });

    return normalizeHighlightWindow({
      start: Number(plan.start),
      end: Number(plan.end),
      hook_text: typeof plan.hook_text === 'string' ? plan.hook_text : transcript.segments[0]?.text ?? '',
      hook_frame_time: Number(plan.hook_frame_time),
      opening_caption: typeof plan.opening_caption === 'string' ? plan.opening_caption : '',
    }, videoDuration, clipDuration);
  } catch (error) {
    console.warn(`[Visual] OpenAI video mini-agent fallback: ${(error as Error).message}`);
    return findHighlightForClip(transcript, clipDuration, videoDuration);
  }
}

async function cutVideoClip(input: string, start: number, end: number, output: string, hasAudio = true): Promise<void> {
  const ffmpegPath = await getFfmpegPath();
  const safeStart = Math.max(0, round2(start));
  const duration = Math.max(0.5, round2(end - start));
  const args = [
    '-y',
    '-i', input,
    '-ss', String(safeStart),
    '-t', String(duration),
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0?'] : ['-an']),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    output,
  ];

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffmpeg video cut failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });
  });
}

async function assertVideoWasCut(input: string, expectedDuration: number, label: string): Promise<void> {
  const actualDuration = await getVideoDuration(input).catch(() => 0);
  if (!actualDuration) return;
  const tolerance = Math.max(1.2, expectedDuration * 0.08);
  if (actualDuration > expectedDuration + tolerance) {
    throw new Error(`${label} failed: expected about ${round2(expectedDuration)}s, got ${round2(actualDuration)}s`);
  }
}

async function ensureVideoDurationLimit(
  input: string,
  output: string,
  maxDuration: number,
  hasAudio = true
): Promise<string> {
  const actualDuration = await getVideoDuration(input).catch(() => 0);
  if (!actualDuration || actualDuration <= maxDuration + 0.8) return input;
  await trimVideoToDuration(input, output, maxDuration, hasAudio);
  await assertVideoWasCut(output, maxDuration, 'Pipeline C final trim');
  return output;
}

async function trimVideoToDuration(input: string, output: string, duration: number, hasAudio = true): Promise<void> {
  const ffmpegPath = await getFfmpegPath();
  const args = [
    '-y',
    '-i', input,
    '-t', String(Math.max(0.5, round2(duration))),
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0?'] : ['-an']),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-movflags', '+faststart',
    output,
  ];

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffmpeg final trim failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });
  });
}

async function processVideoForTikTok(input: string, output: string, hasAudio = true): Promise<void> {
  const ffmpegPath = await getFfmpegPath();
  const videoFilter = [
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.05:saturation=0.9[bg]',
    '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg]',
    '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,eq=contrast=1.06:saturation=1.08:brightness=0.01,unsharp=5:5:0.55:5:5:0.0,drawbox=x=0:y=0:w=iw:h=260:color=black@0.18:t=fill,drawbox=x=0:y=ih-360:w=iw:h=360:color=black@0.16:t=fill[v]',
  ].join(';');

  const args = [
    '-y',
    '-i', input,
    '-filter_complex', videoFilter,
    '-map', '[v]',
    ...(hasAudio
      ? [
          '-map', '0:a:0?',
          '-af', 'highpass=f=80,lowpass=f=12500,afftdn=nf=-24,dynaudnorm=p=0.9,loudnorm=I=-16:LRA=11:TP=-1.5',
          '-c:a', 'aac',
          '-b:a', '160k',
        ]
      : ['-an']),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-shortest',
    output,
  ];

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffmpeg video process failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolve();
    });
  });
}

function generateWordByWordASS(
  words: Array<{ word: string; start: number; end: number }>,
  offsetStart: number,
  outputPath: string,
  subStyle = 'tiktok',
  openingCaption = ''
): void {
  let content = buildASSHeader(subStyle);
  content += buildOpeningTitleDialogue(openingCaption);

  // Group words into lines of max 4 words
  const lines: Array<Array<typeof words[0]>> = [];
  let current: typeof words = [];
  for (const w of words) {
    current.push({ ...w, start: w.start - offsetStart, end: w.end - offsetStart });
    if (current.length >= 4) { lines.push(current); current = []; }
  }
  if (current.length) lines.push(current);

  for (const line of lines) {
    const s = formatASSTime(Math.max(0, line[0].start));
    const e = formatASSTime(Math.max(0, line[line.length - 1].end));

    // Build karaoke-style text with timing
    let text = '';
    for (const w of line) {
      const dur = Math.round((w.end - w.start) * 100);
      text += `{\\k${dur}}${escapeAssText(w.word.toUpperCase())} `;
    }

    content += `Dialogue: 0,${s},${e},Default,,0,0,0,,${text.trim()}\n`;
  }

  writeFileSync(outputPath, content, 'utf-8');
}

function generateSegmentASS(
  segments: Array<{ text: string; start: number; end: number }>,
  outputPath: string,
  subStyle = 'tiktok',
  openingCaption = ''
): void {
  let content = buildASSHeader(subStyle);
  content += buildOpeningTitleDialogue(openingCaption);

  for (const segment of segments) {
    if (!segment.text.trim()) continue;
    const start = formatASSTime(Math.max(0, segment.start));
    const end = formatASSTime(Math.max(segment.start + 0.2, segment.end));
    const text = escapeAssText(segment.text.replace(/\s+/g, ' ').toUpperCase());
    content += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
  }

  writeFileSync(outputPath, content, 'utf-8');
}

function generateSRT(
  segments: Array<{ text: string; start: number; end: number }>,
  words: Array<{ word: string; start: number; end: number }>,
  outputPath: string
): void {
  const cues = segments.length > 0
    ? segments
        .filter(segment => segment.text.trim())
        .map(segment => ({
          start: segment.start,
          end: Math.max(segment.start + 0.2, segment.end),
          text: segment.text.replace(/\s+/g, ' ').trim(),
        }))
    : chunkWordsToCues(words);

  const content = cues
    .map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}\n`)
    .join('\n');

  writeFileSync(outputPath, content, 'utf-8');
}

async function burnSubtitle(video: string, assFile: string, output: string): Promise<void> {
  const ffmpeg = await getFfmpeg();
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .videoFilters([`ass='${escapeFfmpegFilterPath(assFile)}'`])
      .outputOptions(['-c:v libx264', '-preset medium', '-crf 20', '-c:a aac', '-b:a 160k', '-movflags +faststart', '-pix_fmt yuv420p'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function extractThumbnail(video: string, output: string, time: number): Promise<void> {
  const ffmpeg = await getFfmpeg();
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .screenshots({ timestamps: [time], filename: basename(output), folder: dirname(output), size: '1080x1920' })
      .on('end', () => resolve())
      .on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════
async function scrapeProduct(url: string): Promise<{
  name: string; images: string[]; price: number; rating: number;
  sold: number; originalPrice: number; discount: number;
}> {
  const normalized = url.toLowerCase();
  if (normalized.includes('shopee') || normalized.includes('shp.ee')) {
    const product = await scrapeShopeeUrl(url);
    if (!product) {
      throw new Error('Shopee Open API không trả về dữ liệu sản phẩm');
    }

    return {
      name: product.name,
      images: product.images,
      price: product.price,
      rating: product.rating,
      sold: product.sold,
      originalPrice: product.originalPrice,
      discount: product.discount,
    };
  }

  throw new Error('Nền tảng này cần fallback HTML parser');
}

async function preparePipelineBProductReference(images: string[]): Promise<ProductImageCandidate> {
  if (images.length === 0) throw new Error('Không có ảnh để xử lý');

  const candidates = await inspectProductImageCandidates(images);
  if (candidates.length === 0) {
    throw new Error('Không tìm thấy ảnh sản phẩm đủ chất lượng từ URL này');
  }

  const bestUrl = await selectBestProductImageCandidate(candidates);
  const selected = candidates.find(candidate => candidate.url === bestUrl) ?? candidates[0];
  const normalized = await normalizeProductReferenceImage(selected.buffer);
  return { ...selected, buffer: normalized };
}

async function inspectProductImageCandidates(images: string[]): Promise<ProductImageCandidate[]> {
  const uniqueImages = [...new Set(images)].slice(0, 12);
  const settled = await Promise.allSettled(uniqueImages.map(inspectProductImageCandidate));
  const candidates = settled
    .filter((item): item is PromiseFulfilledResult<ProductImageCandidate> => item.status === 'fulfilled')
    .map(item => item.value)
    .filter(candidate => isUsableProductImage(candidate))
    .sort((a, b) => b.score - a.score);

  for (const item of settled) {
    if (item.status === 'rejected') {
      console.warn(`[Visual] Pipeline B image candidate skipped: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
    }
  }

  return candidates.slice(0, 8);
}

async function inspectProductImageCandidate(url: string): Promise<ProductImageCandidate> {
  const { default: sharp } = await import('sharp');
  const buffer = await downloadBuffer(url);
  const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const warnings: string[] = [];
  const area = width * height;
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const ratio = shortestSide > 0 ? longestSide / shortestSide : Number.POSITIVE_INFINITY;

  let score = 0;
  score += Math.min(area / 1_000_000, 2.5) * 40;
  score += Math.min(buffer.length / 250_000, 2) * 12;
  score += ratio <= 1.35 ? 22 : ratio <= 1.8 ? 10 : -28;
  score += shortestSide >= 900 ? 22 : shortestSide >= 650 ? 15 : shortestSide >= 500 ? 8 : -25;

  const lowerUrl = url.toLowerCase();
  if (/(?:banner|sprite|logo|avatar|icon|placeholder|default|transparent|loading)/i.test(lowerUrl)) {
    score -= 55;
    warnings.push('url_looks_non_product');
  }
  if (/(?:thumb|thumbnail|_tn|small|resize|w_?120|w_?240|w_?300|80x80|100x100|200x200)/i.test(lowerUrl)) {
    score -= 22;
    warnings.push('url_looks_thumbnail');
  }
  if (buffer.length < 25_000) {
    score -= 30;
    warnings.push('small_file');
  }
  if (shortestSide < 320 || area < 160_000) {
    warnings.push('low_resolution');
  }
  if (ratio > 2.4) {
    warnings.push('extreme_aspect_ratio');
  }

  return { url, buffer, width, height, format: metadata.format, score, warnings };
}

function isUsableProductImage(candidate: ProductImageCandidate): boolean {
  const area = candidate.width * candidate.height;
  const shortestSide = Math.min(candidate.width, candidate.height);
  const longestSide = Math.max(candidate.width, candidate.height);
  const ratio = shortestSide > 0 ? longestSide / shortestSide : Number.POSITIVE_INFINITY;

  return (
    candidate.width > 0 &&
    candidate.height > 0 &&
    shortestSide >= 320 &&
    area >= 160_000 &&
    ratio <= 2.8 &&
    candidate.buffer.length >= 15_000 &&
    candidate.score > -10
  );
}

async function normalizeProductReferenceImage(buffer: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
  const shortestSide = Math.min(metadata.width ?? 0, metadata.height ?? 0);
  const shouldUpscale = shortestSide > 0 && shortestSide < 900;

  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: shouldUpscale ? 1400 : 1600,
      height: shouldUpscale ? 1400 : 1600,
      fit: 'inside',
      withoutEnlargement: !shouldUpscale,
      kernel: 'lanczos3',
    })
    .modulate({ saturation: 1.04, brightness: 1.01 })
    .sharpen({ sigma: 0.8, m1: 0.8, m2: 1.8 })
    .png({ compressionLevel: 8, adaptiveFiltering: true })
    .toBuffer();
}

async function selectBestProductImageCandidate(candidates: ProductImageCandidate[]): Promise<string> {
  if (candidates.length === 0) throw new Error('Không có ảnh để xử lý');
  if (candidates.length === 1) return candidates[0].url;

  if (!process.env.OPENAI_API_KEY) return candidates[0].url;

  const rankedCandidates = candidates.slice(0, 6);
  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await withTimeout(
      () => openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_VIDEO_AGENT_MODEL || 'gpt-5.5',
        response_format: { type: 'json_object' },
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content: [
              'You are selecting the best source image for an affiliate product ad.',
              'Pick the image that will work best as the reference for generating a complete premium advertising creative.',
              'Prefer a single clear product, front-facing packaging, readable label, high resolution, clean edges, minimal clutter, and no people.',
              'Avoid collages, lifestyle scenes with hands/faces, screenshots, text-heavy promo banners, duplicate products, blurry images, and cropped packaging.',
              'Return strict JSON only.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  'Choose exactly one best candidate.',
                  'Return JSON shape: {"index": 0, "reason": "single clear product with readable label"}',
                  'Reject images that are low-resolution, blurry, text-heavy sale banners, collages, thumbnails, placeholders, people/hands lifestyle shots, or cropped product packaging.',
                  'Candidate images:',
                ].join('\n'),
              },
              ...rankedCandidates.flatMap((candidate, index) => [
                {
                  type: 'text',
                  text: `Candidate ${index}: ${candidate.width}x${candidate.height}, heuristic score ${Math.round(candidate.score)}, warnings ${candidate.warnings.join(', ') || 'none'}`,
                },
                { type: 'image_url', image_url: { url: candidate.url, detail: 'low' } },
              ]),
            ] as any,
          },
        ],
      } as any),
      25_000,
      'Vision image ranking timed out after 25000ms'
    );

    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { index?: unknown };
    const selectedIndex = Number(parsed.index);
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < rankedCandidates.length) {
      return rankedCandidates[selectedIndex].url;
    }
  } catch (error) {
    console.warn(`[Visual] Vision image ranking fallback: ${(error as Error).message}`);
  }

  return rankedCandidates[0].url;
}

async function rankAndPickBestImage(images: string[]): Promise<string> {
  if (images.length === 0) throw new Error('Không có ảnh để xử lý');
  if (images.length === 1) return images[0];

  if (!process.env.OPENAI_API_KEY) return images[0];

  const candidates = images.slice(0, 8);
  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await withTimeout(
      () => openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_VIDEO_AGENT_MODEL || 'gpt-5.5',
        response_format: { type: 'json_object' },
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content: [
              'You are selecting the best source image for an affiliate product ad.',
              'Pick the image that will work best as the reference for generating a complete premium advertising creative.',
              'Prefer a single clear product, front-facing packaging, readable label, high resolution, clean edges, minimal clutter, and no people.',
              'Avoid collages, lifestyle scenes with hands/faces, screenshots, text-heavy promo banners, duplicate products, blurry images, and cropped packaging.',
              'Return strict JSON only.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  'Choose exactly one best candidate.',
                  'Return JSON shape: {"index": 0, "reason": "single clear product with readable label"}',
                  'Candidate images:',
                ].join('\n'),
              },
              ...candidates.flatMap((url, index) => [
                { type: 'text', text: `Candidate ${index}` },
                { type: 'image_url', image_url: { url, detail: 'low' } },
              ]),
            ] as any,
          },
        ],
      } as any),
      25_000,
      'Vision image ranking timed out after 25000ms'
    );

    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { index?: unknown };
    const selectedIndex = Number(parsed.index);
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < candidates.length) {
      return candidates[selectedIndex];
    }
  } catch (error) {
    console.warn(`[Visual] Vision image ranking fallback: ${(error as Error).message}`);
  }

  return candidates[0];
}

async function generateCarousel(userId: string, product: VisualProductData, niche: string, productImageBuffer: Buffer): Promise<string[]> {
  // Tạo 5 slides carousel cho Instagram
  // TODO: implement đầy đủ
  const slides = [
    { headline: 'LÝ DO ĐÁNG THỬ', subline: shortProductName(product.name), badge: 'Slide 1/5' },
    { headline: product.discount ? `TIẾT KIỆM ${product.discount}%` : 'DEAL NỔI BẬT', subline: product.price ? `${product.price.toLocaleString('vi-VN')}đ` : 'Giá tốt hôm nay', badge: 'Slide 2/5' },
    { headline: 'REVIEW NHANH', subline: product.rating ? `${product.rating.toFixed(1)} sao - ${(product.sold ?? 0).toLocaleString('vi-VN')}+ đã bán` : 'Được nhiều người quan tâm', badge: 'Slide 3/5' },
    { headline: 'PHÙ HỢP VỚI BẠN', subline: carouselBenefitByNiche(niche), badge: 'Slide 4/5' },
    { headline: 'CHỐT DEAL NGAY', subline: 'Bấm xem sản phẩm để kiểm tra ưu đãi', badge: 'Slide 5/5' },
  ];

  const urls: string[] = [];
  for (const [index, slide] of slides.entries()) {
    try {
      const baseCreative = buildCreativeDirection(niche, 'instagram', product);
      const creative: CreativeDirection = {
        ...baseCreative,
        headline: slide.headline,
        subline: slide.subline,
        badge: slide.badge,
        productPlacement: index % 2 === 0 ? 'bottom' : 'right',
        textZone: index % 2 === 0 ? 'top' : 'left',
      };
      const withText = await generateCompletePipelineBAd(productImageBuffer, niche, 'instagram', product, creative);
      const url = await uploadToStorage(withText, `${userId}/carousel_${index + 1}_${Date.now()}.jpg`);
      urls.push(url);
    } catch (error) {
      console.warn(`[Visual] Carousel slide ${index + 1} failed: ${(error as Error).message}`);
    }
  }

  return urls;
}

// ═══════════════════════════════════════════════════════════════════════════════
async function scrapeProductFallback(url: string, existing?: {
  name: string; images: string[]; price: number; rating: number;
  sold: number; originalPrice: number; discount: number;
}): Promise<{
  name: string; images: string[]; price: number; rating: number;
  sold: number; originalPrice: number; discount: number;
}> {
  const normalized = url.toLowerCase();
  const shopeeProduct = await tryScrapeShopeeProduct(url);
  if (shopeeProduct?.images?.length) {
    return mergeScrapedProduct(existing, shopeeProduct);
  }

  if (normalized.includes('shopee') || normalized.includes('shp.ee')) {
    throw new Error('URL Shopee không được fallback sang crawl HTML. Hãy kiểm tra SHOPEE_APP_ID/SHOPEE_SECRET hoặc URL sản phẩm.');
  }

  const res = await withTimeout(() => fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  }), 20_000, 'Product page fetch timeout');

  if (!res.ok) {
    throw new Error(`Không đọc được trang sản phẩm: HTTP ${res.status}`);
  }

  const html = await res.text();
  const finalUrl = res.url || url;
  const structured = extractMarketplaceProductData(html, finalUrl);
  const images = uniqueStrings([
    ...(structured.images ?? []),
    ...extractProductImages(html, finalUrl),
  ]).slice(0, 12);
  if (images.length === 0) {
    throw new Error('Không tìm thấy ảnh sản phẩm từ URL này');
  }

  const title = decodeHtml(
    structured.name
    || extractMetaContent(html, 'property', 'og:title')
    || extractMetaContent(html, 'name', 'twitter:title')
    || extractTitleTag(html)
    || existing?.name
    || 'Sản phẩm'
  );

  const price = parsePriceValue(
    structured.price
    || extractMetaContent(html, 'property', 'product:price:amount')
    || extractJsonString(html, 'price')
    || extractJsonString(html, 'salePrice')
    || extractJsonString(html, 'priceShow')
    || extractJsonString(html, 'price_min')
    || ''
  ) || existing?.price || 0;

  const rating = parseNumberValue(
    structured.rating
    || extractMetaContent(html, 'property', 'product:rating:value')
    || extractJsonString(html, 'ratingValue')
    || extractJsonString(html, 'average')
    || extractJsonString(html, 'rating_star')
    || ''
  ) || existing?.rating || 0;

  const sold = parseIntegerValue(
    structured.sold
    || extractJsonString(html, 'historical_sold')
    || extractJsonString(html, 'soldCount')
    || extractJsonString(html, 'itemSoldCntShow')
    || extractJsonString(html, 'sold')
    || ''
  ) || existing?.sold || 0;

  const originalPrice = parsePriceValue(
    structured.originalPrice
    || extractJsonString(html, 'price_before_discount')
    || extractJsonString(html, 'originalPrice')
    || extractJsonString(html, 'originalPriceShow')
    || extractJsonString(html, 'price_max_before_discount')
    || ''
  ) || existing?.originalPrice || 0;

  const discount = originalPrice > 0 && price > 0 && originalPrice > price
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : (existing?.discount || 0);

  return {
    name: title.trim().slice(0, 200),
    images,
    price,
    rating,
    sold,
    originalPrice,
    discount,
  };
}

async function tryScrapeShopeeProduct(url: string): Promise<{
  name: string; images: string[]; price: number; rating: number;
  sold: number; originalPrice: number; discount: number;
} | null> {
  const normalized = url.toLowerCase();
  if (!normalized.includes('shopee') && !normalized.includes('shp.ee')) {
    return null;
  }

  try {
    const scraped = await scrapeShopeeUrl(url);
    if (!scraped) return null;

    return {
      name: scraped.name,
      images: scraped.images,
      price: scraped.price,
      rating: scraped.rating,
      sold: scraped.sold,
      originalPrice: scraped.originalPrice,
      discount: scraped.discount,
    };
  } catch (error) {
    console.warn(`[Visual] Shopee Open API lookup failed: ${(error as Error).message}`);
    return null;
  }
}

function mergeScrapedProduct(
  existing: {
    name: string; images: string[]; price: number; rating: number;
    sold: number; originalPrice: number; discount: number;
  } | undefined,
  incoming: {
    name: string; images: string[]; price: number; rating: number;
    sold: number; originalPrice: number; discount: number;
  }
): {
  name: string; images: string[]; price: number; rating: number;
  sold: number; originalPrice: number; discount: number;
} {
  return {
    name: incoming.name || existing?.name || 'Sản phẩm',
    images: incoming.images.length > 0 ? incoming.images : (existing?.images ?? []),
    price: incoming.price || existing?.price || 0,
    rating: incoming.rating || existing?.rating || 0,
    sold: incoming.sold || existing?.sold || 0,
    originalPrice: incoming.originalPrice || existing?.originalPrice || incoming.price || existing?.price || 0,
    discount: incoming.discount || existing?.discount || 0,
  };
}

function extractMarketplaceProductData(html: string, baseUrl: string): {
  name?: string;
  images?: string[];
  price?: string;
  originalPrice?: string;
  rating?: string;
  sold?: string;
} {
  const out: {
    name?: string;
    images: string[];
    price?: string;
    originalPrice?: string;
    rating?: string;
    sold?: string;
  } = { images: [] };

  for (const json of extractJsonLdBlocks(html)) {
    const products = Array.isArray(json) ? json : [json];
    for (const item of products) {
      if (!item || typeof item !== 'object') continue;
      const data = item as Record<string, unknown>;
      const type = String(data['@type'] ?? '').toLowerCase();
      if (type && !type.includes('product')) continue;
      out.name ||= firstStringValue(data.name);
      const image = data.image;
      if (Array.isArray(image)) out.images.push(...image.map(String));
      else if (typeof image === 'string') out.images.push(image);
      const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
      if (offers && typeof offers === 'object') {
        const offer = offers as Record<string, unknown>;
        out.price ||= firstStringValue(offer.price, offer.lowPrice, offer.highPrice);
      }
      const aggregate = data.aggregateRating;
      if (aggregate && typeof aggregate === 'object') {
        out.rating ||= firstStringValue((aggregate as Record<string, unknown>).ratingValue);
      }
    }
  }

  const pageData = extractNextDataJson(html)
    || extractWindowDataJson(html, '__moduleData__')
    || extractWindowDataJson(html, '__NEXT_DATA__');
  if (pageData) {
    const flat = flattenObject(pageData, 900);
    out.name ||= firstStringValue(
      flat.title,
      flat.name,
      flat.productTitle,
      flat.productName,
      flat.itemTitle,
    );
    out.price ||= firstStringValue(flat.price, flat.salePrice, flat.priceShow, flat.salePriceShow, flat.finalPrice);
    out.originalPrice ||= firstStringValue(flat.originalPrice, flat.originalPriceShow, flat.priceBeforeDiscount, flat.marketPrice);
    out.rating ||= firstStringValue(flat.ratingValue, flat.ratingScore, flat.average, flat.rating);
    out.sold ||= firstStringValue(flat.sold, flat.soldCount, flat.itemSoldCntShow, flat.tradeCount);
  }

  for (const key of ['title', 'name', 'productTitle', 'productName', 'itemTitle']) {
    out.name ||= extractJsonString(html, key) ?? undefined;
  }
  out.price ||= extractJsonString(html, 'salePrice') || extractJsonString(html, 'priceShow') || extractJsonString(html, 'price') || undefined;
  out.originalPrice ||= extractJsonString(html, 'originalPriceShow') || extractJsonString(html, 'originalPrice') || undefined;
  out.rating ||= extractJsonString(html, 'ratingValue') || extractJsonString(html, 'average') || undefined;
  out.sold ||= extractJsonString(html, 'itemSoldCntShow') || extractJsonString(html, 'soldCount') || undefined;

  return {
    ...out,
    name: out.name ? decodeHtml(out.name).replace(/\s*[-|]\s*(Shopee|Lazada).*$/i, '').trim() : undefined,
    images: uniqueStrings(out.images.map(image => normalizeImageUrl(image, baseUrl)).filter((value): value is string => Boolean(value))),
  };
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      blocks.push(JSON.parse(decodeHtml(match[1].trim())));
    } catch {
      // Ignore invalid marketplace JSON-LD.
    }
  }
  return blocks;
}

function extractNextDataJson(html: string): unknown | null {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(decodeHtml(match[1].trim()));
  } catch {
    return null;
  }
}

function extractWindowDataJson(html: string, key: string): unknown | null {
  const pattern = new RegExp(`${escapeRegExp(key)}\\s*=\\s*({[\\s\\S]*?})\\s*(?:;|<\\/script>)`, 'i');
  const match = html.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function flattenObject(input: unknown, limit: number): Record<string, string> {
  const output: Record<string, string> = {};
  const queue: unknown[] = [input];
  let visited = 0;
  while (queue.length > 0 && visited < limit) {
    visited += 1;
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item)) {
      queue.push(...item.slice(0, 20));
      continue;
    }
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') {
        output[key] ||= String(value);
      } else if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return output;
}

function firstStringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    output.push(clean);
  }
  return output;
}

function extractProductImages(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  const push = (value: string | undefined) => {
    if (!value) return;
    const normalized = normalizeImageUrl(value, baseUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  };

  for (const match of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) {
    push(match[1]);
  }

  for (const match of html.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) {
    push(match[1]);
  }

  for (const match of html.matchAll(/"(?:imageUrl|mainImage|largeImage|thumb|src)"\s*:\s*"([^"]+)"/gi)) {
    push(match[1]);
  }

  for (const match of html.matchAll(/"images"\s*:\s*\[(.*?)\]/gi)) {
    for (const nested of match[1].matchAll(/"([^"]+)"/g)) {
      push(nested[1]);
    }
  }

  for (const match of html.matchAll(/<img[^>]+(?:src|data-src|data-ks-lazyload|data-spm-anchor-id)=["']([^"']+)["']/gi)) {
    push(match[1]);
    if (urls.length >= 8) break;
  }

  return urls.slice(0, 8);
}

function normalizeImageUrl(input: string, baseUrl: string): string | null {
  const raw = decodeHtml(input.trim())
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');

  if (!raw) return null;

  try {
    const resolved = raw.startsWith('//')
      ? new URL(`https:${raw}`)
      : new URL(raw, baseUrl);
    if (!/^https?:$/i.test(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, attr: 'property' | 'name', value: string): string | null {
  const pattern = new RegExp(`<meta[^>]+${attr}=["']${escapeRegExp(value)}["'][^>]+content=["']([^"']+)["']`, 'i');
  return pattern.exec(html)?.[1] ?? null;
}

function extractTitleTag(html: string): string | null {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null;
}

function extractJsonString(html: string, key: string): string | null {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*("?)([^",}\\]]+)\\1`, 'i');
  return pattern.exec(html)?.[2] ?? null;
}

function parsePriceValue(input: string): number {
  const digits = input.replace(/[^\d]/g, '');
  if (!digits) return 0;
  const numeric = Number(digits);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  if (numeric > 10_000) return numeric;
  return numeric * 100_000;
}

function parseNumberValue(input: string): number {
  const normalized = input.replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0] ?? '';
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function parseIntegerValue(input: string): number {
  const digits = input.match(/\d+/)?.[0] ?? '';
  const value = Number(digits);
  return Number.isFinite(value) ? value : 0;
}

function decodeHtml(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// STORAGE
// ═══════════════════════════════════════════════════════════════════════════════
async function uploadToStorage(buffer: Buffer, path: string, mimeType = 'image/jpeg'): Promise<string> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { data, error } = await supabase.storage
    .from('visual-assets')
    .upload(path, buffer, { contentType: mimeType, upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage.from('visual-assets').getPublicUrl(path);
  return urlData.publicUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════
async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await withTimeout(() => fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  }), 15_000, 'Download timeout');
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function readFile(path: string): Promise<Buffer> {
  const { default: fs } = await import('fs/promises');
  return fs.readFile(path);
}

function buildBgPrompt(
  niche: string,
  platform: string,
  product?: { name?: string; price?: number; rating?: number; sold?: number; discount?: number },
  creative?: CreativeDirection
): string {
  const nichePrompts: Record<string, string[]> = {
    beauty: ['soft blush stone surface, diffused daylight, elegant cosmetic studio scene', 'clean vanity counter, warm daylight, minimalist product backdrop'],
    tech: ['minimal dark studio with blue accent light and soft reflections', 'clean desk surface, subtle glow, modern product showcase scene'],
    food: ['bright kitchen surface, natural daylight, simple fresh ingredient styling', 'clean stone table, appetizing editorial food backdrop, airy light'],
    fashion: ['neutral studio backdrop, soft shadows, modern lifestyle set', 'clean interior corner, gentle natural light, editorial product staging'],
    home: ['calm modern interior, natural daylight, Scandinavian styling', 'cozy room surface, warm light, clean home decor backdrop'],
    health: ['fresh clean studio backdrop, soft green accents, wellness product scene', 'bright neutral counter, airy light, minimalist health product setup'],
  };
  const prompts = nichePrompts[niche] ?? nichePrompts.beauty;
  const bg = prompts[Math.floor(Math.random() * prompts.length)];

  const spaceHint = platform === 'tiktok'
    ? 'leave 35% empty space at top for text overlay'
    : 'leave 40% empty space on left side for text overlay';

  if (creative) {
    return [
      `Create a premium ${platform} advertising background for an affiliate product campaign.`,
      `Product context: ${product?.name ? shortProductName(product?.name ?? '') : niche} in the ${niche} niche.`,
      `Creative theme: ${creative.theme}.`,
      `Color direction: ${creative.palette.primary}, ${creative.palette.secondary}, ${creative.palette.accent}. Use these colors as accents only, with a tasteful neutral base.`,
      `${spaceHint}. Keep this zone calm, low-detail, and high-contrast enough for later text overlays.`,
      'Use a cohesive commercial art direction: balanced negative space, realistic depth, premium lighting, tasteful niche-relevant props, natural shadows, and a clear surface where the product can sit.',
      'The scene must feel like one real ad photo after the product is composited: consistent perspective, realistic contact area, no busy clutter, no competing hero object.',
      'Background only. Do not include product packaging, people, hands, faces, readable text, logos, watermarks, fake UI, collages, or duplicate products.',
    ].join(' ');
  }

  return `${bg}, ${spaceHint}, premium commercial product photography background, cohesive color palette, balanced negative space, realistic surface for product placement, tasteful niche-relevant props, soft realistic shadows, no people, no hands, no face, no body, no text, no logo, no watermark, no duplicate product`;
}

async function generateFallbackBackground(platform: string): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const dimensions: Record<string, { width: number; height: number }> = {
    tiktok: { width: 1080, height: 1920 },
    facebook: { width: 1200, height: 628 },
    instagram: { width: 1080, height: 1080 },
    youtube: { width: 1280, height: 720 },
    zalo: { width: 700, height: 400 },
  };
  const paletteMap: Record<string, { start: string; end: string; accent: string }> = {
    tiktok: { start: '#fff5ef', end: '#ffd6c7', accent: '#ff8a5b' },
    facebook: { start: '#eef6ff', end: '#c7dcff', accent: '#5b8cff' },
    instagram: { start: '#fff7ea', end: '#ffd8b0', accent: '#ff9a3d' },
    youtube: { start: '#f5f7fa', end: '#d9e3f0', accent: '#5e7fa3' },
    zalo: { start: '#edf7ff', end: '#cde8ff', accent: '#3e95ff' },
  };

  const { width, height } = dimensions[platform] ?? { width: 1080, height: 1080 };
  const palette = paletteMap[platform] ?? paletteMap.instagram;
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette.start}"/>
          <stop offset="100%" stop-color="${palette.end}"/>
        </linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="50"/></filter>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.18)}" r="${Math.round(Math.min(width, height) * 0.12)}" fill="${palette.accent}" opacity="0.22" filter="url(#blur)"/>
      <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.82)}" r="${Math.round(Math.min(width, height) * 0.18)}" fill="#ffffff" opacity="0.5" filter="url(#blur)"/>
      <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.08)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.84)}" rx="${Math.round(Math.min(width, height) * 0.04)}" fill="none" stroke="rgba(255,255,255,0.35)"/>
    </svg>
  `;

  return sharp(Buffer.from(svg)).jpeg({ quality: 94 }).toBuffer();
}

function inferNiche(productName: string): string {
  const lower = productName.toLowerCase();
  if (lower.match(/kem|serum|son|mỹ phẩm|dưỡng|beauty|skincare/)) return 'beauty';
  if (lower.match(/điện|laptop|tai nghe|phone|tech|máy/)) return 'tech';
  if (lower.match(/áo|quần|váy|giày|túi|fashion/)) return 'fashion';
  if (lower.match(/đồ ăn|nước|snack|bánh|food/)) return 'food';
  if (lower.match(/nội thất|đèn|ghế|bàn|home/)) return 'home';
  return 'beauty';
}

function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function formatSrtTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildFallbackHighlight(duration: number, clipDuration: number, hookText = ''): {
  start: number;
  end: number;
  hook_text: string;
  hook_frame_time: number;
  opening_caption: string;
} {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : clipDuration;
  const maxStart = Math.max(0, safeDuration - clipDuration);
  const start = safeDuration <= clipDuration
    ? 0
    : Math.min(maxStart, Math.max(0, safeDuration * 0.15));
  const end = Math.min(safeDuration, start + clipDuration);
  return {
    start: round2(start),
    end: round2(end),
    hook_text: hookText.trim().slice(0, 120),
    hook_frame_time: round2(Math.min(end - 0.4, start + Math.min(1.5, Math.max(0.8, end - start)))),
    opening_caption: buildOpeningCaption(hookText),
  };
}

function normalizeHighlightWindow(
  highlight: { start?: number; end?: number; hook_text?: string; hook_frame_time?: number; opening_caption?: string },
  duration: number,
  clipDuration: number
): PipelineCHighlight {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : clipDuration;
  const maxStart = Math.max(0, safeDuration - Math.max(1, clipDuration));
  const start = clamp(Number.isFinite(highlight.start) ? Number(highlight.start) : 0, 0, maxStart);
  const requestedEnd = Number.isFinite(highlight.end) ? Number(highlight.end) : start + clipDuration;
  const end = clamp(requestedEnd, start + 1, Math.min(safeDuration, start + clipDuration));
  const hookFrame = clamp(
    Number.isFinite(highlight.hook_frame_time) ? Number(highlight.hook_frame_time) : start + 0.8,
    start,
    Math.max(start, end - 0.1)
  );
  const hookText = (highlight.hook_text ?? '').toString().trim().slice(0, 140);
  return {
    start: round2(start),
    end: round2(end),
    hook_text: hookText,
    hook_frame_time: round2(hookFrame),
    opening_caption: buildOpeningCaption(highlight.opening_caption || hookText),
  };
}

function heuristicHighlightFromTranscript(
  segments: Array<{ text: string; start: number; end: number }>,
  duration: number,
  clipDuration: number
): PipelineCHighlight {
  const keywordPattern = /(khong the|không thể|must|nen mua|nên mua|sale|giam|giảm|hot|review|test|ket qua|kết quả|before|after|siêu|xịn|đỉnh|tot hon|tốt hơn|re|wow)/i;
  let bestSegment = segments[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [index, segment] of segments.entries()) {
    const lengthScore = Math.min(segment.text.length, 120) / 6;
    const keywordScore = keywordPattern.test(segment.text) ? 18 : 0;
    const punctuationScore = /[!?]/.test(segment.text) ? 4 : 0;
    const introPenalty = index <= 1 ? 6 : 0;
    const score = lengthScore + keywordScore + punctuationScore - introPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestSegment = segment;
    }
  }

  return normalizeHighlightWindow({
    start: Math.max(0, bestSegment.start - 1.2),
    end: Math.max(bestSegment.end, bestSegment.start + clipDuration),
    hook_text: bestSegment.text,
    hook_frame_time: bestSegment.start + 0.6,
  }, duration, clipDuration);
}

function sliceTranscriptToWindow(
  transcript: {
    text: string;
    words: Array<{ word: string; start: number; end: number }>;
    segments: Array<{ text: string; start: number; end: number }>;
  },
  start: number,
  end: number
): {
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
  segments: Array<{ text: string; start: number; end: number }>;
} {
  const words = transcript.words
    .filter(word => word.end > start && word.start < end)
    .map(word => ({
      word: word.word,
      start: round2(Math.max(0, word.start - start)),
      end: round2(Math.max(0.05, Math.min(end, word.end) - start)),
    }))
    .filter(word => word.end > word.start);

  const segments = transcript.segments
    .filter(segment => segment.end > start && segment.start < end)
    .map(segment => ({
      text: segment.text.trim(),
      start: round2(Math.max(0, segment.start - start)),
      end: round2(Math.max(0.1, Math.min(end, segment.end) - start)),
    }))
    .filter(segment => segment.text && segment.end > segment.start);

  return {
    text: segments.map(segment => segment.text).join(' ').trim(),
    words,
    segments,
  };
}

function chunkWordsToCues(words: Array<{ word: string; start: number; end: number }>): Array<{ start: number; end: number; text: string }> {
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let current: Array<{ word: string; start: number; end: number }> = [];

  for (const word of words) {
    current.push(word);
    const duration = current[current.length - 1].end - current[0].start;
    if (current.length >= 6 || duration >= 2.6) {
      cues.push({
        start: current[0].start,
        end: current[current.length - 1].end,
        text: current.map(item => item.word).join(' '),
      });
      current = [];
    }
  }

  if (current.length > 0) {
    cues.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map(item => item.word).join(' '),
    });
  }

  return cues;
}

function buildASSHeader(subStyle = 'tiktok'): string {
  const styleMap: Record<string, string> = {
    tiktok: 'Style: Default,Arial,72,&H00FFFFFF,&H00000000,&H80000000,1,0,1,4,0,2,10,10,80',
    clean: 'Style: Default,Arial,54,&H00FFFFFF,&H00202020,&H64000000,0,0,1,2,0,2,80,80,120',
    karaoke: 'Style: Default,Arial,66,&H00FFF200,&H00000000,&H80000000,1,0,1,3,0,2,20,20,90',
  };
  const assStyle = styleMap[subStyle] ?? styleMap.tiktok;
  const titleStyle = 'Style: Title,Arial,78,&H00FFFFFF,&H00000000,&H90000000,1,0,1,5,0,8,64,64,160';

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV
${assStyle}
${titleStyle}

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
}

function buildOpeningCaption(text: string): string {
  const clean = text
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .trim();
  if (!clean) return '';

  const words = clean.split(' ').filter(Boolean);
  const short = words.length > 8 ? words.slice(0, 8).join(' ') : clean;
  return short.replace(/[.!?,;:]+$/g, '').slice(0, 64);
}

function buildOpeningTitleDialogue(caption: string): string {
  const clean = buildOpeningCaption(caption);
  if (!clean) return '';
  return `Dialogue: 1,0:00:00.00,0:00:02.60,Title,,0,0,0,,{\\fad(120,180)}${escapeAssText(clean.toUpperCase())}\n`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function escapeFfmpegFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/'/g, "\\'");
}
