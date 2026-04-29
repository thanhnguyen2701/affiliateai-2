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
import type { BrandKit, ProductInfo } from '../../../../packages/shared/src/types.js';

const db = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const PIPELINE_A_BG_TIMEOUT_MS = 35_000;
const PIPELINE_A_UPSCALE_TIMEOUT_MS = 45_000;

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
        assets = await runPipelineA(userId, config.source_path, config.platforms, config.niche);
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
  niche = 'beauty'
): Promise<Record<string, string>> {
  const imageBuffer = await readFile(imagePath);
  const selectedPlatforms = [...new Set(platforms)].slice(0, 5);
  
  // Step 1: Remove background
  const noBgBuffer = await removeBg(imageBuffer).catch((error) => {
    console.warn(`[Visual] Remove background fallback: ${(error as Error).message}`);
    return imageBuffer;
  });
  
  // Step 2: Upscale if small
  const enhanced = imageBuffer.length < 200_000
    ? await upscaleImage(noBgBuffer).catch((error) => {
        console.warn(`[Visual] Upscale fallback: ${(error as Error).message}`);
        return noBgBuffer;
      })
    : noBgBuffer;
  
  // Step 3: Generate per platform in parallel
  const results: Record<string, string> = {};
  const settled = await Promise.allSettled(selectedPlatforms.map(async (platform) => {
    const generated = await generatePipelineAAsset(enhanced, niche, platform);
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
  
  // Step 2: Pick best image
  const bestImageUrl = await rankAndPickBestImage(product.images);
  
  // Step 3: Remove background
  const imgBuffer = await downloadBuffer(bestImageUrl);
  const noBg = await removeBg(imgBuffer);
  
  // Step 4: Generate backgrounds per platform
  const results: Record<string, string> = {};
  const niche = inferNiche(product.name);
  const selectedPlatforms = [...new Set(platforms)].slice(0, 5);
  
  await Promise.all(selectedPlatforms.map(async (platform) => {
    const creative = buildCreativeDirection(niche, platform, product);
    const scene = await generatePhotorealisticProductScene(noBg, niche, platform, product, creative);
    const withText = await addCreativeTextOverlay(scene, platform, {
      name:    product.name,
      price:   product.price,
      rating:  product.rating,
      sold:    product.sold,
      discount: product.discount,
    }, creative);
    const url = await uploadToStorage(withText, `${userId}/banner_${platform}_${Date.now()}.jpg`);
    results[`${platform}_banner`] = url;
  }));
  
  // Also generate a creative Instagram carousel when possible.
  const carouselUrls = await generateCarousel(userId, product, niche, noBg);
  if (carouselUrls.length > 0) {
    results['instagram_carousel'] = carouselUrls.join(',');
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE C — video raw + AI edit + subtitle
// ═══════════════════════════════════════════════════════════════════════════════
async function runPipelineC(
  userId: string,
  videoPath: string,
  options: { subStyle?: string; clipDuration?: number } = {}
): Promise<Record<string, string>> {

  const { default: fs } = await import('fs');
  const clipDuration = Number.isFinite(options.clipDuration) && (options.clipDuration ?? 0) > 0
    ? Math.round(options.clipDuration as number)
    : 45;
  const subStyle = options.subStyle || 'tiktok';
  const sourceDuration = await getVideoDuration(videoPath).catch(() => clipDuration);
  const audioPath = buildVisualTempPath(userId, 'transcribe_audio', 'wav');
  const clipPath = buildVisualTempPath(userId, 'clip', 'mp4');
  const processedPath = buildVisualTempPath(userId, 'processed', 'mp4');
  const assPath = buildVisualTempPath(userId, 'sub', 'ass');
  const srtPath = buildVisualTempPath(userId, 'sub', 'srt');
  const subtitledPath = buildVisualTempPath(userId, 'final', 'mp4');
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

  // Step 1: Transcribe với Whisper
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
  
  // Step 4: Enhance audio + resize to 9:16
  await processVideoForTikTok(clipPath, processedPath, hasAudio);
  
  const clipTranscript = transcript
    ? sliceTranscriptToWindow(transcript, highlight.start, highlight.end)
    : null;
  const hasSubtitleData = Boolean(clipTranscript && (clipTranscript.words.length > 0 || clipTranscript.segments.length > 0));
  const finalVideoPath = hasSubtitleData ? subtitledPath : processedPath;
  if (clipTranscript && hasSubtitleData) {
    if (clipTranscript.words.length > 0) {
      generateWordByWordASS(clipTranscript.words, 0, assPath, subStyle);
    } else {
      generateSegmentASS(clipTranscript.segments, assPath, subStyle);
    }
    await burnSubtitle(processedPath, assPath, subtitledPath);
    generateSRT(clipTranscript.segments, clipTranscript.words, srtPath);
  }
  
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
  [audioPath, clipPath, processedPath, assPath, srtPath, subtitledPath, thumbPath]
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
  formData.append('image_file', new Blob([buffer]), 'product.jpg');
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

  const { Replicate } = await import('replicate');
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
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
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

async function generatePipelineAAsset(productBuffer: Buffer, niche: string, platform: string): Promise<Buffer> {
  try {
    return await generateImageFromCutout({
      cutoutBuffer: productBuffer,
      niche,
      platform,
    });
  } catch (error) {
    console.warn(`[Visual] OpenAI image mini-agent fallback for ${platform}: ${(error as Error).message}`);
    const bgPrompt = buildBgPrompt(niche, platform);
    const bgBuffer = await generateBackground(bgPrompt, platform);
    return compositeImages(bgBuffer, productBuffer, platform);
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
  const headlineLines = wrapText(creative.headline, platform === 'tiktok' ? 18 : 22, 2);
  const sublineLines = wrapText(creative.subline, platform === 'tiktok' ? 28 : 34, 2);
  const price = product.price ? `${product.price.toLocaleString('vi-VN')}d` : '';
  const social = product.rating ? `${product.rating.toFixed(1)} sao - da ban ${(product.sold ?? 0).toLocaleString('vi-VN')}+` : '';
  const badge = product.discount ? `GIAM ${product.discount}%` : creative.badge;
  const headlineSize = platform === 'tiktok' ? 76 : platform === 'instagram' ? 58 : 54;
  const sublineSize = platform === 'tiktok' ? 31 : 25;
  const priceSize = platform === 'tiktok' ? 46 : 38;
  const palette = creative.palette;

  const svgText = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.26"/>
        </filter>
      </defs>
      <rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" rx="26" fill="rgba(0,0,0,0.20)" filter="url(#softShadow)"/>
      <rect x="${zone.x + 18}" y="${zone.y + 18}" width="${Math.min(230, zone.width - 36)}" height="42" rx="21" fill="${palette.accent}"/>
      <text x="${zone.x + 34}" y="${zone.y + 47}" font-family="Arial, sans-serif" font-size="20" font-weight="800" fill="#111827">${escapeXml(badge)}</text>
      ${headlineLines.map((line, index) =>
        `<text x="${zone.x + 26}" y="${zone.y + 112 + index * (headlineSize + 4)}" font-family="Arial, sans-serif" font-size="${headlineSize}" font-weight="900" fill="${palette.text}">${escapeXml(line)}</text>`
      ).join('')}
      ${sublineLines.map((line, index) =>
        `<text x="${zone.x + 28}" y="${zone.y + 232 + headlineLines.length * 18 + index * (sublineSize + 8)}" font-family="Arial, sans-serif" font-size="${sublineSize}" font-weight="600" fill="rgba(255,255,255,0.88)">${escapeXml(line)}</text>`
      ).join('')}
      ${price ? `<text x="${zone.x + 28}" y="${zone.y + zone.height - 78}" font-family="Arial, sans-serif" font-size="${priceSize}" font-weight="900" fill="${palette.accent}">${escapeXml(price)}</text>` : ''}
      ${social ? `<text x="${zone.x + 28}" y="${zone.y + zone.height - 36}" font-family="Arial, sans-serif" font-size="21" font-weight="600" fill="rgba(255,255,255,0.82)">${escapeXml(social)}</text>` : ''}
      <rect x="${zone.x + zone.width - 184}" y="${zone.y + zone.height - 76}" width="154" height="46" rx="23" fill="${palette.primary}"/>
      <text x="${zone.x + zone.width - 158}" y="${zone.y + zone.height - 46}" font-family="Arial, sans-serif" font-size="19" font-weight="800" fill="#ffffff">${escapeXml(creative.cta)}</text>
    </svg>`;

  return sharp(buffer).composite([{ input: Buffer.from(svgText), blend: 'over' }]).jpeg({ quality: 95 }).toBuffer();
}

function buildCreativeDirection(niche: string, platform: string, product: VisualProductData): CreativeDirection {
  const palettes: Record<string, CreativeDirection['palette']> = {
    beauty: { primary: '#EC4899', secondary: '#FDF2F8', accent: '#FDE047', text: '#FFFFFF' },
    tech: { primary: '#2563EB', secondary: '#DBEAFE', accent: '#22D3EE', text: '#FFFFFF' },
    food: { primary: '#F97316', secondary: '#FFF7ED', accent: '#FACC15', text: '#FFFFFF' },
    fashion: { primary: '#7C3AED', secondary: '#F5F3FF', accent: '#F0ABFC', text: '#FFFFFF' },
    home: { primary: '#059669', secondary: '#ECFDF5', accent: '#A7F3D0', text: '#FFFFFF' },
    health: { primary: '#10B981', secondary: '#ECFEFF', accent: '#67E8F9', text: '#FFFFFF' },
  };

  const themes: Record<string, string[]> = {
    beauty: ['premium skincare shelfie', 'clinical beauty studio', 'soft luxury vanity scene'],
    tech: ['premium desk setup', 'clean tech showroom', 'modern device launch scene'],
    food: ['fresh editorial kitchen', 'bright appetizing product scene', 'clean market-inspired setup'],
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

  const name = shortProductName(product.name);
  const discountHeadline = product.discount ? `GIAM ${product.discount}%` : 'DANG CHU Y';
  const socialProof = product.rating
    ? `${product.rating.toFixed(1)} sao - ${(product.sold ?? 0).toLocaleString('vi-VN')}+ da ban`
    : 'Duoc nhieu nguoi quan tam';
  const benefit = benefitByNiche(niche);

  return {
    theme: pickStable(themes[niche] ?? themes.beauty, `${product.name}:${platform}`),
    palette: palettes[niche] ?? palettes.beauty,
    headline: platform === 'youtube' ? discountHeadline : conciseHeadline(name, niche, platform),
    subline: platform === 'instagram' ? `${benefit} - ${socialProof}` : `${discountHeadline} - ${benefit}`,
    cta: platform === 'youtube' ? 'Xem ngay' : 'Xem deal',
    badge: discountHeadline,
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
  if (platform === 'tiktok') return 'DANG THU THAT';
  if (platform === 'facebook') return 'DEAL DANG XEM';
  if (platform === 'zalo') return 'UU DAI HOM NAY';
  return name || benefitByNiche(niche);
}

function benefitByNiche(niche: string): string {
  return ({
    beauty: 'Nang tam routine',
    tech: 'Gon hon, tien hon',
    food: 'Ngon va tien loi',
    fashion: 'De phoi moi ngay',
    home: 'Nha gon dep hon',
    health: 'Cham soc moi ngay',
  } as Record<string, string>)[niche] ?? 'Dang de thu';
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
    return { x: Math.round(width * 0.06), y: Math.round(height * 0.05), width: Math.round(width * 0.88), height: Math.round(height * 0.28) };
  }
  if (zone === 'bottom') {
    return { x: Math.round(width * 0.06), y: Math.round(height * 0.66), width: Math.round(width * 0.88), height: Math.round(height * 0.28) };
  }
  if (zone === 'right') {
    return { x: Math.round(width * 0.50), y: Math.round(height * 0.12), width: Math.round(width * 0.44), height: Math.round(height * 0.76) };
  }
  return { x: Math.round(width * 0.06), y: Math.round(height * 0.12), width: Math.round(width * 0.44), height: Math.round(height * 0.76) };
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

function shortProductName(name: string): string {
  const cleaned = name
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.split(' ').slice(0, 5).join(' ').toUpperCase() || 'SAN PHAM HOT';
}

function carouselBenefitByNiche(niche: string): string {
  const copy: Record<string, string> = {
    beauty: 'Cho routine dep hon moi ngay',
    tech: 'Nang cap setup gon va xin hon',
    food: 'De an ngon hon ma khong cau ky',
    fashion: 'De outfit co diem nhan hon',
    home: 'Lam khong gian gon va dep hon',
    health: 'Ho tro thoi quen song khoe',
  };
  return copy[niche] ?? 'Lua chon dang can nhac hom nay';
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

async function transcribeVideo(videoPath: string): Promise<{
  text: string;
  words: Array<{ word: string; start: number; end: number }>;
  segments: Array<{ text: string; start: number; end: number }>;
  duration: number;
}> {
  const { default: OpenAI } = await import('openai');
  const { default: fs } = await import('fs');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const transcript = await openai.audio.transcriptions.create({
    file: fs.createReadStream(videoPath) as any,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe',
    language: 'vi',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
  });

  return {
    text:     transcript.text,
    words:    (transcript as any).words ?? [],
    segments: (transcript as any).segments ?? [],
    duration: (transcript as any).duration ?? 0,
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
}, clipDuration = 45, videoDuration = 45): Promise<{ start: number; end: number; hook_text: string; hook_frame_time?: number }> {
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
    }, videoDuration, clipDuration);
  } catch {
    return heuristicHighlightFromTranscript(cleanedSegments, videoDuration, clipDuration);
  }
}

async function planPipelineCHighlight(transcript: {
  text: string;
  segments: Array<{ text: string; start: number; end: number }>;
  duration?: number;
}, clipDuration = 45, videoDuration = 45): Promise<{ start: number; end: number; hook_text: string; hook_frame_time?: number }> {
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
    }, videoDuration, clipDuration);
  } catch (error) {
    console.warn(`[Visual] OpenAI video mini-agent fallback: ${(error as Error).message}`);
    return findHighlightForClip(transcript, clipDuration, videoDuration);
  }
}

async function cutVideoClip(input: string, start: number, end: number, output: string, hasAudio = true): Promise<void> {
  const ffmpeg = await getFfmpeg();
  return new Promise((resolve, reject) => {
    const command = ffmpeg(input)
      .setStartTime(start)
      .setDuration(end - start)
      .outputOptions(hasAudio
        ? ['-c:v libx264', '-c:a aac', '-preset fast', '-crf 23', '-movflags +faststart']
        : ['-c:v libx264', '-an', '-preset fast', '-crf 23', '-movflags +faststart'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject);
    command.run();
  });
}

async function processVideoForTikTok(input: string, output: string, hasAudio = true): Promise<void> {
  const ffmpeg = await getFfmpeg();
  return new Promise((resolve, reject) => {
    const command = ffmpeg(input)
      .videoFilters([
        'scale=1080:1920:force_original_aspect_ratio=decrease',
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
        'fps=30',
        'eq=contrast=1.04:saturation=1.08:brightness=0.015',
        'unsharp=5:5:0.6:5:5:0.0',
        'drawbox=x=0:y=0:w=iw:h=150:color=black@0.18:t=fill',
        'drawbox=x=0:y=ih-190:w=iw:h=190:color=black@0.10:t=fill',
      ])
      .outputOptions(hasAudio
        ? ['-c:v libx264', '-c:a aac', '-preset fast', '-crf 23', '-movflags +faststart', '-pix_fmt yuv420p']
        : ['-c:v libx264', '-an', '-preset fast', '-crf 23', '-movflags +faststart', '-pix_fmt yuv420p'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject);
    if (hasAudio) {
      command.audioFilters(['highpass=f=80', 'lowpass=f=12000', 'afftdn=nf=-25', 'dynaudnorm=p=0.9']);
    }
    command.run();
  });
}

function generateWordByWordASS(
  words: Array<{ word: string; start: number; end: number }>,
  offsetStart: number,
  outputPath: string,
  subStyle = 'tiktok'
): void {
  let content = buildASSHeader(subStyle);

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
  subStyle = 'tiktok'
): void {
  let content = buildASSHeader(subStyle);

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
      .outputOptions(['-movflags +faststart', '-pix_fmt yuv420p'])
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
              'Pick the image that will work best for background removal and premium product photography.',
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

async function generateCarousel(userId: string, product: VisualProductData, niche: string, productCutout: Buffer): Promise<string[]> {
  // Tạo 5 slides carousel cho Instagram
  // TODO: implement đầy đủ
  const slides = [
    { headline: 'LY DO DANG THU', subline: shortProductName(product.name), badge: 'Slide 1/5' },
    { headline: product.discount ? `TIET KIEM ${product.discount}%` : 'DEAL NOI BAT', subline: product.price ? `${product.price.toLocaleString('vi-VN')}d` : 'Gia tot hom nay', badge: 'Slide 2/5' },
    { headline: 'REVIEW NHANH', subline: product.rating ? `${product.rating.toFixed(1)} sao - ${(product.sold ?? 0).toLocaleString('vi-VN')}+ da ban` : 'Duoc nhieu nguoi quan tam', badge: 'Slide 3/5' },
    { headline: 'PHU HOP VOI BAN', subline: carouselBenefitByNiche(niche), badge: 'Slide 4/5' },
    { headline: 'CHOT DEAL NGAY', subline: 'Bam xem san pham de kiem tra uu dai', badge: 'Slide 5/5' },
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
      const scene = await generatePhotorealisticProductScene(productCutout, niche, 'instagram', product, creative);
      const withText = await addCreativeTextOverlay(scene, 'instagram', product, creative);
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
    throw new Error(`Khong doc duoc trang san pham: HTTP ${res.status}`);
  }

  const html = await res.text();
  const finalUrl = res.url || url;
  const images = extractProductImages(html, finalUrl);
  if (images.length === 0) {
    throw new Error('Khong tim thay anh san pham tu URL nay');
  }

  const title = decodeHtml(
    extractMetaContent(html, 'property', 'og:title')
    || extractMetaContent(html, 'name', 'twitter:title')
    || extractTitleTag(html)
    || existing?.name
    || 'San pham'
  );

  const price = parsePriceValue(
    extractMetaContent(html, 'property', 'product:price:amount')
    || extractJsonString(html, 'price')
    || extractJsonString(html, 'price_min')
    || ''
  ) || existing?.price || 0;

  const rating = parseNumberValue(
    extractMetaContent(html, 'property', 'product:rating:value')
    || extractJsonString(html, 'ratingValue')
    || extractJsonString(html, 'rating_star')
    || ''
  ) || existing?.rating || 0;

  const sold = parseIntegerValue(
    extractJsonString(html, 'historical_sold')
    || extractJsonString(html, 'sold')
    || ''
  ) || existing?.sold || 0;

  const originalPrice = parsePriceValue(
    extractJsonString(html, 'price_before_discount')
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
    name: incoming.name || existing?.name || 'San pham',
    images: incoming.images.length > 0 ? incoming.images : (existing?.images ?? []),
    price: incoming.price || existing?.price || 0,
    rating: incoming.rating || existing?.rating || 0,
    sold: incoming.sold || existing?.sold || 0,
    originalPrice: incoming.originalPrice || existing?.originalPrice || incoming.price || existing?.price || 0,
    discount: incoming.discount || existing?.discount || 0,
  };
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

  for (const match of html.matchAll(/"images"\s*:\s*\[(.*?)\]/gi)) {
    for (const nested of match[1].matchAll(/"([^"]+)"/g)) {
      push(nested[1]);
    }
  }

  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
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
  const res = await withTimeout(() => fetch(url), 15_000, 'Download timeout');
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
  };
}

function normalizeHighlightWindow(
  highlight: { start?: number; end?: number; hook_text?: string; hook_frame_time?: number },
  duration: number,
  clipDuration: number
): { start: number; end: number; hook_text: string; hook_frame_time: number } {
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
  return {
    start: round2(start),
    end: round2(end),
    hook_text: (highlight.hook_text ?? '').toString().trim().slice(0, 140),
    hook_frame_time: round2(hookFrame),
  };
}

function heuristicHighlightFromTranscript(
  segments: Array<{ text: string; start: number; end: number }>,
  duration: number,
  clipDuration: number
): { start: number; end: number; hook_text: string; hook_frame_time: number } {
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

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV
${assStyle}

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
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
