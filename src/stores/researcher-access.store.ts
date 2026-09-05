import { create } from 'zustand';
import { isCurrentUserResearcher } from '@/features/researcher/researcher.service';

export type ResearcherAccessStatus = 'idle' | 'loading' | 'authorized' | 'denied' | 'error';

interface ResearcherAccessState {
  status: ResearcherAccessStatus;
  userId: string | null;
  checkAccess: (userId: string) => Promise<void>;
  clear: () => void;
}

let accessGeneration = 0;
let pendingCheck: { userId: string; promise: Promise<void> } | null = null;

export const useResearcherAccessStore = create<ResearcherAccessState>((set, get) => ({
  status: 'idle',
  userId: null,
  checkAccess: async (userId) => {
    const current = get();
    if (
      current.userId === userId &&
      (current.status === 'authorized' || current.status === 'denied')
    ) {
      return;
    }

    if (pendingCheck?.userId === userId) return pendingCheck.promise;
    const generation = ++accessGeneration;
    const promise = (async () => {
      set({ status: 'loading', userId });
      try {
        const status = (await isCurrentUserResearcher()) ? 'authorized' : 'denied';
        if (generation === accessGeneration && get().userId === userId) set({ status });
      } catch {
        if (generation === accessGeneration && get().userId === userId) set({ status: 'error' });
      } finally {
        if (generation === accessGeneration && pendingCheck?.userId === userId) {
          pendingCheck = null;
        }
      }
    })();
    pendingCheck = { userId, promise };
    return promise;
  },
  clear: () => {
    accessGeneration += 1;
    pendingCheck = null;
    set({ status: 'idle', userId: null });
  },
}));

export function assertParticipantLearningAccess(): void {
  if (useResearcherAccessStore.getState().status === 'authorized') {
    throw new Error('Researcher accounts cannot create participant learning records.');
  }
}
