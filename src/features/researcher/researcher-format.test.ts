import { describe, expect, it } from 'vitest';
import {
  formatResearchNumber,
  formatResearchPercent,
  formatResearchPoints,
} from './researcher-format';

describe('researcher numeric presentation', () => {
  it.each([
    [85.22222222222223, '85.2%'],
    [55.666666666666664, '55.7%'],
    [100, '100%'],
    [0, '0%'],
  ])('formats percentage %s as %s', (value, expected) => {
    expect(formatResearchPercent(value)).toBe(expected);
  });

  it('formats signed changes and general metrics with at most one decimal', () => {
    expect(formatResearchPoints(-33.466666666)).toBe('-33.5 pts');
    expect(formatResearchPoints(12.04)).toBe('+12 pts');
    expect(formatResearchNumber(1.25)).toBe('1.3');
  });

  it('uses the requested no-data label without changing input values', () => {
    const value = 85.22222222222223;
    expect(formatResearchPercent(null, '—')).toBe('—');
    expect(formatResearchPercent(value)).toBe('85.2%');
    expect(value).toBe(85.22222222222223);
  });
});
