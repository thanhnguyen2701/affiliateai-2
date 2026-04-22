// apps/api/src/services/visual/visual-queue.ts
// Visual AI Queue: Pipeline A (ảnh thực) | B (Shopee/Lazada) | C (video raw)

import { createClient } from '@supabase/supabase-js';
import { withRetry, withTimeout } from '../../lib/resilience.js';
import type { BrandKit, ProductInfo } from '../../../../packages/shared/src/types.js';

const db = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
export const visualQueue = {
  async add(jobId: string, userId: string, config: {
    product_url?: string;
    source_path?: string;
    platforms: string[];
    pipeline: string;
  }): Promise<void> {
    try {
      await db().from('visual_jobs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', jobId);

      let assets: Record<string, string | string[]> = {};

      if (config.pipeline === 'B' && config.product_url) {
        assets = await runPipelineB(userId, config.product_url, config.platforms);
      } else if (config.pipeline === 'C' && config.source_path) {
        assets = await runPipelineC(userId, config.source_path);
      } else if (config.pipeline === 'A' && config.source_path) {
        assets = await runPipelineA(userId, config.source_path, config.platforms);
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
  platforms: string[]
): Promise<Record<string, string>> {
  const imageBuffer = await readFile(imagePath);
  
  // Step 1: Remove background
  const noBgBuffer = await removeBg(imageBuffer);
  
  // Step 2: Upscale if small
  const enhanced = imageBuffer.length < 200_000
    ? await upscaleImage(noBgBuffer)
    : noBgBuffer;
  
  // Step 3: Generate per platform in parallel
  const results: Record<string, string> = {};
  
  await Promise.all(platforms.map(async (platform) => {
    const bgPrompt = buildBgPrompt('beauty', platform); // default niche
    const bgBuffer = await generateBackground(bgPrompt, platform);
    const composited = await compositeImages(bgBuffer, enhanced, platform);
    const url = await uploadToStorage(composited, `${userId}/banner_${platform}_${Date.now()}.jpg`);
    results[`${platform}_banner`] = url;
  }));
  
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

  // Step 1: Scrape product
  const product = await scrapeProduct(productUrl);
  
  // Step 2: Pick best image
  const bestImageUrl = await rankAndPickBestImage(product.images);
  
  // Step 3: Remove background
  const imgBuffer = await downloadBuffer(bestImageUrl);
  const noBg = await removeBg(imgBuffer);
  
  // Step 4: Generate backgrounds per platform
  const results: Record<string, string> = {};
  const niche = inferNiche(product.name);
  
  await Promise.all(platforms.map(async (platform) => {
    const bgPrompt  = buildBgPrompt(niche, platform);
    const bgBuffer  = await generateBackground(bgPrompt, platform);
    const composited = await compositeImages(bgBuffer, noBg, platform);
    const withText  = await addTextOverlay(composited, platform, {
      name:    product.name,
      price:   product.price,
      rating:  product.rating,
      sold:    product.sold,
      discount: product.discount,
    });
    const url = await uploadToStorage(withText, `${userId}/banner_${platform}_${Date.now()}.jpg`);
    results[`${platform}_banner`] = url;
  }));
  
  // Also generate carousel (5 slides)
  const carouselUrls = await generateCarousel(userId, product, niche);
  results['instagram_carousel'] = carouselUrls.join(',');
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE C — video raw + AI edit + subtitle
// ═══════════════════════════════════════════════════════════════════════════════
async function runPipelineC(
  userId: string,
  videoPath: string
): Promise<Record<string, string>> {

  const { default: ffmpegPath } = await import('ffmpeg-static').catch(() => ({ default: 'ffmpeg' }));

  // Step 1: Transcribe với Whisper
  const transcript = await transcribeVideo(videoPath);
  
  // Step 2: Find best 45s highlight với GPT-4o
  const highlight = await findHighlight(transcript);
  
  // Step 3: Cut clip
  const clipPath = `/tmp/${userId}_clip_${Date.now()}.mp4`;
  await cutVideoClip(videoPath, highlight.start, highlight.end, clipPath);
  
  // Step 4: Enhance audio + resize to 9:16
  const processedPath = `/tmp/${userId}_processed_${Date.now()}.mp4`;
  await processVideoForTikTok(clipPath, processedPath);
  
  // Step 5: Generate word-by-word subtitle
  const assPath = `/tmp/${userId}_sub_${Date.now()}.ass`;
  generateWordByWordASS(transcript.words, highlight.start, assPath);
  
  // Step 6: Burn subtitle
  const subtitledPath = `/tmp/${userId}_final_${Date.now()}.mp4`;
  await burnSubtitle(processedPath, assPath, subtitledPath);
  
  // Step 7: Extract best thumbnail
  const thumbPath = `/tmp/${userId}_thumb_${Date.now()}.jpg`;
  await extractThumbnail(subtitledPath, thumbPath, highlight.hook_frame_time ?? 1);
  
  // Step 8: Upload both
  const [videoUrl, thumbUrl] = await Promise.all([
    uploadToStorage(await readFile(subtitledPath), `${userId}/video_${Date.now()}.mp4`, 'video/mp4'),
    uploadToStorage(await readFile(thumbPath), `${userId}/thumb_${Date.now()}.jpg`, 'image/jpeg'),
  ]);
  
  // Cleanup
  [clipPath, processedPath, assPath, subtitledPath, thumbPath]
    .forEach(p => fs.unlink(p, () => {}));

  return { tiktok_video: videoUrl, tiktok_thumbnail: thumbUrl };
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
  const output = await replicate.run(
    'nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b',
    { input: { image: `data:image/jpeg;base64,${base64}`, scale: 2, face_enhance: false } }
  ) as string;

  const res = await fetch(output);
  return Buffer.from(await res.arrayBuffer());
}

async function generateBackground(prompt: string, platform: string): Promise<Buffer> {
  const sizeMap: Record<string, '1024x1024' | '1792x1024' | '1024x1792'> = {
    tiktok: '1024x1792', instagram_story: '1024x1792',
    facebook: '1792x1024', youtube: '1792x1024',
  };
  const size = sizeMap[platform] ?? '1024x1024';

  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const res = await openai.images.generate({ model: 'dall-e-3', prompt, size, quality: 'standard', n: 1 });
  const url = res.data[0].url!;
  return downloadBuffer(url);
}

async function compositeImages(bgBuffer: Buffer, productBuffer: Buffer, platform: string): Promise<Buffer> {
  const { default: sharp } = await import('sharp');

  const bgMeta = await sharp(bgBuffer).metadata();
  const scaleMap: Record<string, number> = { tiktok: 0.65, facebook: 0.55, instagram: 0.60, youtube: 0.50 };
  const scale = scaleMap[platform] ?? 0.60;
  const prodWidth = Math.floor((bgMeta.width ?? 1024) * scale);

  const resized = await sharp(productBuffer).resize(prodWidth, null, { fit: 'inside' }).png().toBuffer();
  const prodMeta = await sharp(resized).metadata();

  const gravityMap: Record<string, string> = { tiktok: 'center', facebook: 'right', instagram: 'center', youtube: 'right' };
  const gravity = gravityMap[platform] ?? 'center';

  let left = Math.floor(((bgMeta.width ?? 1024) - (prodMeta.width ?? prodWidth)) / 2);
  let top  = Math.floor(((bgMeta.height ?? 1024) - (prodMeta.height ?? prodWidth)) / 2);

  if (gravity === 'right') {
    left = (bgMeta.width ?? 1024) - (prodMeta.width ?? prodWidth) - 60;
    top  = Math.floor(((bgMeta.height ?? 1024) - (prodMeta.height ?? prodWidth)) / 2);
  }

  return sharp(bgBuffer).composite([{ input: resized, left, top }]).jpeg({ quality: 95 }).toBuffer();
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
    model: 'whisper-1',
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
}): Promise<{ start: number; end: number; hook_text: string; hook_frame_time?: number }> {
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Transcript video affiliate này, tìm đoạn 45 giây HAY NHẤT để cắt làm TikTok.
Tiêu chí: hook mạnh, có giá trị, kết thúc tốt.
Segments: ${JSON.stringify(transcript.segments.slice(0, 30))}
Trả về JSON: {"start": 5.2, "end": 50.1, "hook_text": "...", "hook_frame_time": 5.2}`,
    }],
    response_format: { type: 'json_object' },
    max_tokens: 200,
  });

  try {
    return JSON.parse(res.choices[0].message.content ?? '{}');
  } catch {
    return { start: 0, end: Math.min(45, (transcript as any).duration ?? 45), hook_text: transcript.segments[0]?.text ?? '' };
  }
}

async function cutVideoClip(input: string, start: number, end: number, output: string): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .setDuration(end - start)
      .outputOptions(['-c:v libx264', '-c:a aac', '-preset fast', '-crf 23'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function processVideoForTikTok(input: string, output: string): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioFilters(['highpass=f=80', 'lowpass=f=12000', 'afftdn=nf=-25', 'dynaudnorm=p=0.9'])
      .videoFilters([
        'scale=1080:1920:force_original_aspect_ratio=decrease',
        'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      ])
      .outputOptions(['-c:v libx264', '-c:a aac', '-preset fast', '-crf 23'])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function generateWordByWordASS(
  words: Array<{ word: string; start: number; end: number }>,
  offsetStart: number,
  outputPath: string
): void {
  const { writeFileSync } = require('fs');

  let content = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV
Style: Default,Arial,72,&H00FFFFFF,&H00000000,&H80000000,1,0,1,4,0,2,10,10,80

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;

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
      text += `{\\k${dur}}${w.word.toUpperCase()} `;
    }

    content += `Dialogue: 0,${s},${e},Default,,0,0,0,,${text.trim()}\n`;
  }

  writeFileSync(outputPath, content, 'utf-8');
}

async function burnSubtitle(video: string, assFile: string, output: string): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .outputOptions([`-vf ass=${assFile}`])
      .output(output)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function extractThumbnail(video: string, output: string, time: number): Promise<void> {
  const { default: ffmpeg } = await import('fluent-ffmpeg');
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .screenshots({ timestamps: [time], filename: require('path').basename(output), folder: require('path').dirname(output), size: '1080x1920' })
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
  // Shopee open API (cần SHOPEE_APP_ID)
  // Fallback: Apify hoặc simple fetch + parse
  // TODO: Implement proper Shopee API call khi có credentials
  // For now: extract item_id from URL and call API
  const match = url.match(/i\.(\d+)\.(\d+)/);
  if (!match) throw new Error('URL Shopee không hợp lệ — cần format: shopee.vn/product/i.shopid.itemid');

  // Placeholder — thay bằng Shopee API thực
  return {
    name: 'Sản phẩm Shopee',
    images: [],
    price: 0, rating: 0, sold: 0, originalPrice: 0, discount: 0,
  };
}

async function rankAndPickBestImage(images: string[]): Promise<string> {
  if (images.length === 0) throw new Error('Không có ảnh để xử lý');
  if (images.length === 1) return images[0];

  // Dùng GPT-4o Vision để rank nếu có nhiều ảnh
  // Simple fallback: chọn ảnh đầu tiên
  return images[0];
}

async function generateCarousel(userId: string, product: Record<string, unknown>, niche: string): Promise<string[]> {
  // Tạo 5 slides carousel cho Instagram
  // TODO: implement đầy đủ
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
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

function buildBgPrompt(niche: string, platform: string): string {
  const nichePrompts: Record<string, string[]> = {
    beauty:   ['soft pink marble surface, white flowers, golden hour light, luxury spa aesthetic', 'clean bathroom counter, morning light, instagram aesthetic'],
    tech:     ['dark gradient background, subtle blue neon glow, minimalist studio, Apple product photography style', 'clean white desk setup, selective dramatic lighting'],
    food:     ['rustic wooden table, natural daylight, fresh herbs and spices scattered, appetizing food photography', 'marble surface, colorful ingredients, top-down flat lay'],
    fashion:  ['clean white seamless background, soft studio lighting, editorial fashion photography', 'lifestyle setting, natural light, modern minimal apartment'],
    home:     ['clean modern interior, natural light, Scandinavian style aesthetic', 'cozy room setting, warm lighting, home decor photography'],
  };
  const prompts = nichePrompts[niche] ?? nichePrompts.beauty;
  const bg = prompts[Math.floor(Math.random() * prompts.length)];

  const spaceHint = platform === 'tiktok'
    ? 'leave 35% empty space at top for text overlay'
    : 'leave 40% empty space on left side for text overlay';

  return `${bg}, ${spaceHint}, no text in image, no people, commercial product photography, 8k quality`;
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

// Import fs cho cleanup
import * as fs from 'fs';
