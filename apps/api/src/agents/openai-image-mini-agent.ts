import OpenAI, { toFile } from 'openai';
import { withRetry, withTimeout } from '../lib/resilience.js';

export interface OpenAiImageMiniAgentInput {
  cutoutBuffer: Buffer;
  niche?: string;
  platform: string;
}

let openaiClient: OpenAI | null = null;

export async function generateImageFromCutout(input: OpenAiImageMiniAgentInput): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const preparedCutout = await normalizeCutout(input.cutoutBuffer);
  const imageFile = await toFile(preparedCutout, 'product-cutout.png', { type: 'image/png' });
  const prompt = buildOpenAiImagePrompt(input.niche ?? 'beauty', input.platform);
  const size = resolveImageSize(input.platform);

  const response = await withRetry(
    () => withTimeout(
      () => getOpenAiClient().images.edit({
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
        image: imageFile as any,
        prompt,
        size,
        quality: (process.env.OPENAI_IMAGE_QUALITY || 'low') as any,
      } as any),
      90_000,
      'OpenAI image mini-agent timed out after 90000ms'
    ),
    { maxAttempts: 2, baseDelayMs: 1500 }
  );

  const base64Image = response.data?.[0]?.b64_json;
  if (base64Image) {
    return Buffer.from(base64Image, 'base64');
  }

  const imageUrl = response.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error('OpenAI image mini-agent returned no image payload');
  }

  const downloadResponse = await withTimeout(() => fetch(imageUrl), 20_000, 'OpenAI image download timeout');
  if (!downloadResponse.ok) {
    throw new Error(`OpenAI image download failed: ${downloadResponse.status}`);
  }
  return Buffer.from(await downloadResponse.arrayBuffer());
}

function getOpenAiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function normalizeCutout(buffer: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

function buildOpenAiImagePrompt(niche: string, platform: string): string {
  const platformName: Record<string, string> = {
    tiktok: 'TikTok vertical ad',
    facebook: 'Facebook feed ad',
    instagram: 'Instagram square post',
    youtube: 'YouTube thumbnail style banner',
    zalo: 'Zalo promotional banner',
  };

  const nicheScenes: Record<string, string> = {
    beauty: 'clean vanity counter, premium skincare studio light, soft natural shadows, elegant lifestyle background',
    tech: 'modern studio desk, subtle reflections, premium lighting, sleek tech showroom atmosphere',
    food: 'fresh kitchen setup, daylight, appetizing editorial food styling, bright realistic mood',
    fashion: 'editorial lifestyle set, soft daylight, premium retail atmosphere, clean styling',
    home: 'modern interior corner, warm daylight, tasteful decor, commercial furniture photography vibe',
    health: 'bright wellness studio, clean minimal surface, soft green accents, premium product lighting',
  };

  const scene = nicheScenes[niche] ?? nicheScenes.beauty;
  const spaceHint = platform === 'tiktok'
    ? 'Leave clean breathing room near the top and bottom for later overlay text.'
    : 'Leave clean breathing room on one side for later overlay text.';

  return [
    `Create a photorealistic ${platformName[platform] ?? 'marketing image'} using the provided product cutout as the hero product.`,
    'Preserve the exact product identity, label, colors, proportions, and packaging details from the input image.',
    `Place the product in a ${scene}.`,
    'Single hero product only, premium commercial product photography, realistic contact shadow, realistic reflections, crisp focus.',
    spaceHint,
    'No people, no hands, no faces, no extra products, no text, no logo, no watermark.',
  ].join(' ');
}

function resolveImageSize(platform: string): '1024x1024' | '1536x1024' | '1024x1536' {
  const sizeMap: Record<string, '1024x1024' | '1536x1024' | '1024x1536'> = {
    tiktok: '1024x1536',
    instagram: '1024x1024',
    facebook: '1536x1024',
    youtube: '1536x1024',
    zalo: '1536x1024',
  };
  return sizeMap[platform] ?? '1024x1024';
}
