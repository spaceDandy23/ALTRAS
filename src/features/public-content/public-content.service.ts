import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';

export const pageKeys = ['landing', 'privacy-policy', 'terms-and-conditions'] as const;
export type PublicContentPageKey = (typeof pageKeys)[number];

export const landingShowcaseSlots = ['understand', 'apply', 'reflect'] as const;
export type LandingShowcaseSlot = (typeof landingShowcaseSlots)[number];

const landingContentSchema = z.object({
  showcaseImages: z.object({
    understand: z.array(z.object({ path: z.string().min(1), alt: z.string().max(300) })).max(8).optional(),
    apply: z.array(z.object({ path: z.string().min(1), alt: z.string().max(300) })).max(8).optional(),
    reflect: z.array(z.object({ path: z.string().min(1), alt: z.string().max(300) })).max(8).optional(),
  }).optional(),
  heroHeading: z.string().min(1),
  heroEmphasis: z.string().min(1),
  heroDescription: z.string().min(1),
  aboutTitle: z.string().min(1),
  aboutDescription: z.string().min(1),
  closingHeading: z.string().min(1),
  learnHeading: z.string().min(1),
  learnDescription: z.string().min(1),
  practiceHeading: z.string().min(1),
  practiceDescription: z.string().min(1),
  progressHeading: z.string().min(1),
  progressDescription: z.string().min(1),
  understandImagePath: z.string().nullable().optional(),
  understandImageAlt: z.string().max(300).optional(),
  applyImagePath: z.string().nullable().optional(),
  applyImageAlt: z.string().max(300).optional(),
  reflectImagePath: z.string().nullable().optional(),
  reflectImageAlt: z.string().max(300).optional(),
});
const legalSectionSchema = z.object({ heading: z.string().min(1), body: z.string().min(1) });
const legalContentSchema = z.object({
  title: z.string().min(1),
  versionLabel: z.string().min(1),
  summary: z.string().min(1),
  childFriendlyNotice: z.string().min(1),
  sections: z.array(legalSectionSchema),
});

export type LandingContent = z.infer<typeof landingContentSchema>;
export function getShowcaseImages(content: LandingContent, slot: LandingShowcaseSlot) {
  const images = content.showcaseImages?.[slot];
  if (images) return images;
  const path = content[`${slot}ImagePath`];
  return path ? [{ path, alt: content[`${slot}ImageAlt`] ?? '' }] : [];
}
export type LegalContent = z.infer<typeof legalContentSchema>;
export type PublicContent = LandingContent | LegalContent;

const showcaseImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const maxShowcaseImageBytes = 5 * 1024 * 1024;
const showcaseBucket = 'public-content-assets';

export function getPublishedShowcaseImageUrl(path: string) {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  return baseUrl ? `${baseUrl}/functions/v1/public-content-image?path=${encodeURIComponent(path)}` : '';
}

export function validateShowcaseImage(file: File) {
  if (!showcaseImageTypes.includes(file.type as (typeof showcaseImageTypes)[number])) {
    throw new Error('Choose a WebP, PNG, or JPEG screenshot.');
  }
  if (file.size > maxShowcaseImageBytes) throw new Error('Screenshot images must be 5 MB or smaller.');
}

async function validateShowcaseDimensions(file: File) {
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error('The selected file is not a readable image.'));
      next.src = source;
    });
    if (image.naturalWidth < 320 || image.naturalHeight < 180 || image.naturalWidth > 3840 || image.naturalHeight > 3840) {
      throw new Error('Screenshot dimensions must be between 320×180 and 3840×3840 pixels.');
    }
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function uploadLandingShowcaseImage(slot: LandingShowcaseSlot, file: File) {
  validateShowcaseImage(file);
  await validateShowcaseDimensions(file);
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const path = `landing/${slot}/${crypto.randomUUID()}.${extension}`;
  const { error } = await getSupabaseClient().storage.from(showcaseBucket).upload(path, file, {
    cacheControl: '31536000', contentType: file.type, upsert: false,
  });
  if (error) throw new Error(error.message || 'Unable to upload screenshot.');
  return path;
}

export async function getDraftShowcaseImageUrl(path: string) {
  const { data, error } = await getSupabaseClient().storage.from(showcaseBucket).createSignedUrl(path, 60 * 15);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Unable to load screenshot preview.');
  return data.signedUrl;
}

const contentPageSchema = z.object({
  pageKey: z.enum(pageKeys),
  draftContent: z.union([landingContentSchema, legalContentSchema]),
  publishedContent: z.union([landingContentSchema, legalContentSchema]).nullable(),
  revision: z.number(),
  updatedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export type ContentPage = z.infer<typeof contentPageSchema>;

async function call(name: string, args?: Record<string, unknown>) {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw new Error(error.message || 'Unable to manage public content.');
  return data;
}

export async function getPublishedContent<T extends PublicContent>(pageKey: PublicContentPageKey) {
  const data = (await call('get_public_content', { p_page_key: pageKey })) as {
    content?: unknown;
  } | null;
  if (!data?.content) return null;
  return (pageKey === 'landing' ? landingContentSchema : legalContentSchema).parse(data.content) as T;
}

export async function listContentPages(): Promise<ContentPage[]> {
  return z.array(contentPageSchema).parse(await call('get_public_content_cms'));
}

export async function saveContentDraft(
  pageKey: PublicContentPageKey,
  content: PublicContent,
  revision: number,
): Promise<ContentPage> {
  return contentPageSchema.parse(
    await call('save_public_content_draft', {
      p_page_key: pageKey,
      p_content: content,
      p_revision: revision,
    }),
  );
}

export async function publishContent(
  pageKey: PublicContentPageKey,
  revision: number,
): Promise<ContentPage> {
  return contentPageSchema.parse(
    await call('publish_public_content', { p_page_key: pageKey, p_revision: revision }),
  );
}

export function isLegalContent(content: PublicContent): content is LegalContent {
  return 'sections' in content;
}
