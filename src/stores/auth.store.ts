import { create } from 'zustand';
import {
  loginOnlineUser,
  logoutOnlineUser,
  registerOnlineUser,
  restoreOnlineSession,
} from '@/features/auth/online-auth.service';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { hydrateVisualPreferencesForUser } from '@/features/settings/visual-preferences.bootstrap';
import { deactivateVisualPreferences } from '@/features/settings/visual-preferences.cache';
import type { LoginInput, RegistrationInput } from '@/features/auth/auth.schemas';
import type { PublicUser } from '@/types/models';

type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'guest';

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  initialize: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegistrationInput) => Promise<void>;
  logout: () => Promise<void>;
  replaceUser: (user: PublicUser) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  initialize: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const user = await restoreOnlineSession();
      if (!user) {
        deactivateVisualPreferences();
        set({ user: null, status: 'guest' });
        return;
      }
      await hydrateVisualPreferencesForUser(user.id);
      set({ user, status: 'authenticated' });
    } catch {
      deactivateVisualPreferences();
      set({ user: null, status: 'guest' });
    }
  },
  login: async (input) => {
    const user = await loginOnlineUser(input);
    await hydrateVisualPreferencesForUser(user.id);
    set({ user, status: 'authenticated' });
  },
  register: async (input) => {
    const user = await registerOnlineUser(input);
    await hydrateVisualPreferencesForUser(user.id);
    set({ user, status: 'authenticated' });
  },
  logout: async () => {
    await logoutOnlineUser();
    deactivateVisualPreferences();
    set({ user: null, status: 'guest' });
    useResearcherAccessStore.getState().clear();
  },
  replaceUser: (user) => set({ user }),
}));
