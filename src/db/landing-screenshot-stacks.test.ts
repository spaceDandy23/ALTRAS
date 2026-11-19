// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('landing screenshot stack validation', () => {
  it('accepts legacy and multiple images; rejects malformed, duplicate and cross-section paths', async () => {
    const pg = new PGlite();
    try {
      await pg.exec(readFileSync('supabase/migrations/20261119071851_landing_screenshot_stacks.sql', 'utf8'));
      const content = Object.fromEntries(['heroHeading', 'heroEmphasis', 'heroDescription', 'aboutTitle', 'aboutDescription', 'closingHeading', 'learnHeading', 'learnDescription', 'practiceHeading', 'practiceDescription', 'progressHeading', 'progressDescription'].map((key) => [key, 'Content']));
      const validate = (value: object) => pg.query('select public.validate_public_content($1,$2)', ['landing', value]);
      await expect(validate(content)).resolves.toBeDefined();
      await expect(validate({ ...content, understandImagePath: 'landing/understand/legacy.webp' })).resolves.toBeDefined();
      const image = { path: 'landing/understand/one.webp', alt: 'Teaching screen' };
      await expect(validate({ ...content, showcaseImages: { understand: [image, { ...image, path: 'landing/understand/two.webp' }] } })).resolves.toBeDefined();
      await expect(validate({ ...content, showcaseImages: { understand: [] } })).resolves.toBeDefined();
      for (const images of [[image, image], [{ ...image, path: 'landing/apply/one.webp' }], [{ path: image.path }], Array.from({ length: 9 }, (_, i) => ({ ...image, path: `landing/understand/${i}.webp` }))]) {
        await expect(validate({ ...content, showcaseImages: { understand: images } })).rejects.toThrow();
      }
    } finally { await pg.close(); }
  });
});
