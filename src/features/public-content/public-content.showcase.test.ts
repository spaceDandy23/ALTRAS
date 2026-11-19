import { describe, expect, it } from 'vitest';
import { getPublishedShowcaseImageUrl, getShowcaseImages, validateShowcaseImage, type LandingContent } from './public-content.service';

describe('landing showcase images', () => {
  it('restores legacy images but honors an explicitly empty or replaced stack', () => {
    const content = { understandImagePath: 'landing/understand/old.webp', understandImageAlt: 'Legacy image' } as LandingContent;
    expect(getShowcaseImages(content, 'understand')).toEqual([{ path: content.understandImagePath, alt: 'Legacy image' }]);
    expect(getShowcaseImages({ ...content, showcaseImages: { understand: [] } }, 'understand')).toEqual([]);
    const images = [{ path: 'landing/understand/new.webp', alt: 'New image' }];
    expect(getShowcaseImages({ ...content, showcaseImages: { understand: images } }, 'understand')).toEqual(images);
    expect(getShowcaseImages(content, 'apply')).toEqual([]);
  });
  it('accepts supported screenshot types and rejects unsafe uploads', () => {
    expect(() => validateShowcaseImage(new File(['image'], 'lesson.webp', { type: 'image/webp' }))).not.toThrow();
    expect(() => validateShowcaseImage(new File(['text'], 'lesson.svg', { type: 'image/svg+xml' }))).toThrow(/WebP, PNG, or JPEG/i);
    expect(() => validateShowcaseImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).toThrow(/5 MB/i);
  });

  it('uses the public image endpoint instead of exposing the private storage bucket', () => {
    expect(getPublishedShowcaseImageUrl('landing/understand/example.webp')).toContain('/functions/v1/public-content-image?path=');
  });
});
