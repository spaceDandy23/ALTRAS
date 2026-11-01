import { create } from 'zustand';
import { isCurrentUserAdmin } from '@/features/admin/lesson-management.service';
import { isCurrentUserResearcher } from '@/features/researcher/researcher.service';

export type ResearcherAccessStatus = 'idle' | 'loading' | 'authorized' | 'denied' | 'error';
export type AdminAccessStatus = 'idle' | 'loading' | 'allowed' | 'denied' | 'error';

interface ResearcherAccessState {
  status: ResearcherAccessStatus;
  userId: string | null;
  adminStatus: AdminAccessStatus;
  adminUserId: string | null;
  checkAccess: (userId: string) => Promise<void>;
  checkAdminAccess: (userId: string) => Promise<void>;
  clear: () => void;
}

let accessGeneration = 0;
let pendingCheck: { userId: string; promise: Promise<void> } | null = null;
let adminAccessGeneration = 0;
let pendingAdminCheck: { userId: string; promise: Promise<void> } | null = null;

export const useResearcherAccessStore = create<ResearcherAccessState>((set, get) => ({
  status: 'idle',
  userId: null,
  adminStatus: 'idle',
  adminUserId: null,
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
  checkAdminAccess: async (userId) => {
    const current = get();
    if (
      current.adminUserId === userId &&
      (current.adminStatus === 'allowed' || current.adminStatus === 'denied')
    ) {
      return;
    }

    if (pendingAdminCheck?.userId === userId) return pendingAdminCheck.promise;
    const generation = ++adminAccessGeneration;
    const promise = (async () => {
      set({ adminStatus: 'loading', adminUserId: userId });
      try {
        const status = (await isCurrentUserAdmin()) ? 'allowed' : 'denied';
        if (generation === adminAccessGeneration && get().adminUserId === userId) {
          set({ adminStatus: status });
        }
      } catch {
        if (generation === adminAccessGeneration && get().adminUserId === userId) {
          set({ adminStatus: 'error' });
        }
      } finally {
        if (generation === adminAccessGeneration && pendingAdminCheck?.userId === userId) {
          pendingAdminCheck = null;
        }
      }
    })();
    pendingAdminCheck = { userId, promise };
    return promise;
  },
  clear: () => {
    accessGeneration += 1;
    adminAccessGeneration += 1;
    pendingCheck = null;
    pendingAdminCheck = null;
    set({ status: 'idle', userId: null, adminStatus: 'idle', adminUserId: null });
  },
}));

export function assertParticipantLearningAccess(): void {
  if (useResearcherAccessStore.getState().status === 'authorized') {
    throw new Error('Researcher accounts cannot create participant learning records.');
  }
}
