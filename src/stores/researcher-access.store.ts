import { create } from 'zustand';
import { isCurrentUserResearcher } from '@/features/researcher/researcher.service';

export type ResearcherAccessStatus = 'idle' | 'loading' | 'authorized' | 'denied' | 'error';

interface ResearcherAccessState {
  status: ResearcherAccessStatus;
  userId: string | null;
  checkAccess: (userId: string) => Promise<void>;
  clear: () => void;
}

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

    set({ status: 'loading', userId });
    try {
      set({ status: (await isCurrentUserResearcher()) ? 'authorized' : 'denied' });
    } catch {
      set({ status: 'error' });
    }
  },
  clear: () => set({ status: 'idle', userId: null }),
}));

export function assertParticipantLearningAccess(): void {
  if (useResearcherAccessStore.getState().status === 'authorized') {
    throw new Error('Researcher accounts cannot create participant learning records.');
  }
}
