import OpenAI, { toFile } from 'openai';
import { withRetry, withTimeout } from '../lib/resilience.js';

export interface OpenAiImageMiniAgentInput {
  cutoutBuffer: Buffer;
  niche?: string;
  platform: string;
  productName?: string;
  marketingContext?: string;
  creativeTheme?: string;
  colorDirection?: string;
  overlayTextIntent?: string;
  productPlacement?: 'center' | 'right' | 'left' | 'bottom';
  textZone?: 'top' | 'left' | 'right' | 'bottom';
}

let openaiClient: OpenAI | null = null;

export async function generateImageFromCutout(input: OpenAiImageMiniAgentInput): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const preparedCutout = await normalizeCutout(input.cutoutBuffer);
  const imageFile = await toFile(preparedCutout, 'product-cutout.png', { type: 'image/png' });
  const prompt = buildOpenAiImagePrompt(input);
  const size = resolveImageSize(input.platform);

  const response = await withRetry(
    () => withTimeout(
      () => getOpenAiClient().images.edit({
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
        image: imageFile as any,
        prompt,
        size,
        quality: (process.env.OPENAI_IMAGE_QUALITY || 'high') as any,
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

function buildOpenAiImagePrompt(input: OpenAiImageMiniAgentInput): string {
  const niche = input.niche ?? 'beauty';
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
  const compositionStyle: Record<string, string> = {
    tiktok: 'vertical mobile-first composition, strong foreground/background separation, generous safe space for short-form ad copy',
    facebook: 'wide feed composition, balanced negative space, clear product silhouette that remains readable in a scrolling feed',
    instagram: 'square premium social post composition, editorial balance, refined props and clean visual rhythm',
    youtube: 'wide thumbnail composition, high contrast subject separation, instantly readable product shape at small size',
    zalo: 'wide promotional banner composition, clean commercial layout, calm negative space for later messaging',
  };
  const harmonyStyle: Record<string, string> = {
    beauty: 'soft neutral palette with blush, cream, glass, stone, or warm metallic accents that complement the packaging',
    tech: 'controlled cool neutrals with subtle blue, graphite, chrome, or glass accents that make the product feel premium',
    food: 'fresh natural palette with appetizing highlights, warm daylight, clean surfaces, and realistic ingredient accents',
    fashion: 'tasteful editorial palette with textile texture, soft shadows, and modern retail styling',
    home: 'warm modern interior palette with natural materials, calm decor, and realistic daylight',
    health: 'fresh wellness palette with white, soft green, pale blue, and clean clinical-lifestyle details',
  };
  const productPlacement = input.productPlacement ?? defaultProductPlacement(input.platform);
  const textZone = input.textZone ?? defaultTextZone(input.platform);
  const productHint: Record<NonNullable<OpenAiImageMiniAgentInput['productPlacement']>, string> = {
    center: 'Keep the product as the centered hero subject.',
    right: 'Place the product naturally on the right third of the frame.',
    left: 'Place the product naturally on the left third of the frame.',
    bottom: 'Place the product naturally in the lower half of the frame.',
  };
  const zoneHint: Record<NonNullable<OpenAiImageMiniAgentInput['textZone']>, string> = {
    top: 'Leave the upper part of the image clean and low-detail for later text overlay.',
    left: 'Leave the left side clean and low-detail for later text overlay.',
    right: 'Leave the right side clean and low-detail for later text overlay.',
    bottom: 'Leave the lower part of the image clean and low-detail for later text overlay.',
  };

  return [
    `Create a photorealistic, premium ${platformName[input.platform] ?? 'marketing image'} using the provided product cutout as the only hero product.`,
    input.productName ? `The product is: ${input.productName}.` : '',
    input.marketingContext ? `Marketing context: ${input.marketingContext}.` : '',
    input.creativeTheme ? `Creative theme: ${input.creativeTheme}.` : '',
    input.colorDirection ? `Color direction: ${input.colorDirection}.` : '',
    input.overlayTextIntent ? `Later overlay intent: ${input.overlayTextIntent}. Keep the reserved overlay zone visually calm and readable.` : '',
    'Preserve the exact product identity, label, colors, proportions, geometry, cap, packaging material, and visible details from the input image.',
    `Place the product in a ${scene}.`,
    `Use ${compositionStyle[input.platform] ?? 'a clean commercial composition with balanced negative space and a clear product silhouette'}.`,
    `Use a harmonious art direction: ${harmonyStyle[niche] ?? harmonyStyle.beauty}. Match the background colors to the product packaging without overpowering it.`,
    productHint[productPlacement],
    zoneHint[textZone],
    'Integrate the product into the scene with consistent perspective, realistic scale, grounded placement, soft contact shadow, subtle ambient occlusion, and natural reflections where appropriate.',
    'Use one coherent key light direction, soft commercial studio lighting, realistic depth of field, crisp product focus, high-end retouching, and clean material detail.',
    'Make the whole image look like one real photograph, not a pasted cutout: blend edges naturally, remove halos, match color temperature, match contrast, and avoid floating or warped packaging.',
    'Keep supporting props minimal, tasteful, and niche-relevant. Props must stay secondary and must not compete with the product.',
    'No people, no hands, no faces, no extra products, no readable text, no generated logos, no watermark, no UI elements, no distorted label, no duplicate product.',
  ].filter(Boolean).join(' ');
}

function defaultProductPlacement(platform: string): NonNullable<OpenAiImageMiniAgentInput['productPlacement']> {
  return ({
    tiktok: 'bottom',
    facebook: 'right',
    instagram: 'center',
    youtube: 'right',
    zalo: 'right',
  } as Record<string, NonNullable<OpenAiImageMiniAgentInput['productPlacement']>>)[platform] ?? 'center';
}

function defaultTextZone(platform: string): NonNullable<OpenAiImageMiniAgentInput['textZone']> {
  return ({
    tiktok: 'top',
    facebook: 'left',
    instagram: 'top',
    youtube: 'left',
    zalo: 'left',
  } as Record<string, NonNullable<OpenAiImageMiniAgentInput['textZone']>>)[platform] ?? 'top';
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
