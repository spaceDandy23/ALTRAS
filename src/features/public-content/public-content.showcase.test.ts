import { describe, expect, it } from 'vitest';
import { getPublishedShowcaseImageUrl, validateShowcaseImage } from './public-content.service';

describe('landing showcase images', () => {
  it('accepts supported screenshot types and rejects unsafe uploads', () => {
    expect(() => validateShowcaseImage(new File(['image'], 'lesson.webp', { type: 'image/webp' }))).not.toThrow();
    expect(() => validateShowcaseImage(new File(['text'], 'lesson.svg', { type: 'image/svg+xml' }))).toThrow(/WebP, PNG, or JPEG/i);
    expect(() => validateShowcaseImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).toThrow(/5 MB/i);
  });

  it('uses the public image endpoint instead of exposing the private storage bucket', () => {
    expect(getPublishedShowcaseImageUrl('landing/understand/example.webp')).toContain('/functions/v1/public-content-image?path=');
  });
});
