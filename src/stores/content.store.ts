import { create } from 'zustand';
import { db } from '@/db/database';
import { initializePackagedContent } from '@/features/lessons/content/content.service';

type ContentStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ContentState {
  status: ContentStatus;
  error: string | null;
  initialize: () => Promise<void>;
}

export const useContentStore = create<ContentState>((set, get) => ({
  status: 'idle',
  error: null,
  initialize: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      await initializePackagedContent(db);
      set({ status: 'ready' });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Lesson content is unavailable.',
      });
    }
  },
}));
