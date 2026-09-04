import { afterEach, describe, expect, it } from 'vitest';
import { applyExperienceScope, getExperienceScope, isResearcherPath, isStudentExperience } from './researcher-experience';

describe('researcher typography experience scope', () => {
  afterEach(() => delete document.documentElement.dataset.experience);

  it('recognizes the researcher root and every researcher child route', () => {
    expect(isResearcherPath('/researcher')).toBe(true);
    expect(isResearcherPath('/researcher/participants')).toBe(true);
    expect(isResearcherPath('/lessons')).toBe(false);
  });

  it('changes only the experience scope and preserves the saved readability preference', () => {
    document.documentElement.style.setProperty('--readability-scale', '1.3');
    applyExperienceScope('researcher');
    expect(document.documentElement.dataset.experience).toBe('researcher');
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
    applyExperienceScope('student');
    expect(document.documentElement.dataset.experience).toBe('student');
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
  });

  it('keeps unresolved bootstrap typography neutral without clearing Large Text', () => {
    document.documentElement.style.setProperty('--readability-scale', '1.3');
    applyExperienceScope('neutral');
    expect(document.documentElement.dataset.experience).toBe('neutral');
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
  });

  it('treats missing or non-student scope as non-student audio state', () => {
    expect(getExperienceScope()).toBe('neutral');
    expect(isStudentExperience()).toBe(false);

    applyExperienceScope('student');
    expect(getExperienceScope()).toBe('student');
    expect(isStudentExperience()).toBe(true);

    applyExperienceScope('researcher');
    expect(getExperienceScope()).toBe('researcher');
    expect(isStudentExperience()).toBe(false);
  });
});
