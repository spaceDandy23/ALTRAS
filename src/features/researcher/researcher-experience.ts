export function isResearcherPath(pathname: string): boolean {
  return pathname === '/researcher' || pathname.startsWith('/researcher/');
}

export type ExperienceScope = 'neutral' | 'student' | 'researcher';

export function getExperienceScope(): ExperienceScope {
  if (typeof document === 'undefined') return 'neutral';
  const scope = document.documentElement.dataset.experience;
  return scope === 'student' || scope === 'researcher' ? scope : 'neutral';
}

export function isStudentExperience(): boolean {
  return getExperienceScope() === 'student';
}

export function applyExperienceScope(scope: ExperienceScope): void {
  document.documentElement.dataset.experience = scope;
}
