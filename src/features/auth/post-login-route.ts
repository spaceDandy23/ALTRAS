import type { ResearcherAccessStatus } from '@/stores/researcher-access.store';

export function resolvePostLoginDestination(
  researcherStatus: ResearcherAccessStatus,
  requestedPath?: string,
): string {
  if (researcherStatus === 'authorized') return '/researcher/results';
  if (!requestedPath || requestedPath.startsWith('/researcher')) return '/';
  return requestedPath;
}
