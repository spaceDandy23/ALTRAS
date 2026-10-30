import { create } from 'zustand';
import {
  loginOnlineUser,
  logoutOnlineUser,
  registerOnlineUser,
  restoreOnlineSession,
  subscribeToOnlineAuthChanges,
} from '@/features/auth/online-auth.service';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';
import { hydrateVisualPreferencesForUser } from '@/features/settings/visual-preferences.bootstrap';
import { deactivateVisualPreferences } from '@/features/settings/visual-preferences.cache';
import { resetAudio } from '@/services/audio/audio.manager';
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
  subscribeToAuthChanges: () => () => void;
}

let authGeneration = 0;

export const useAuthStore = create<AuthState>((set, get) => {
  const clearUserScope = () => {
    useResearcherAccessStore.getState().clear();
    deactivateVisualPreferences();
    applyExperienceScope('neutral');
    resetAudio();
  };

  const authenticate = async (user: PublicUser, generation: number) => {
    await hydrateVisualPreferencesForUser(user.id);
    if (generation === authGeneration) set({ user, status: 'authenticated' });
  };

  const acceptAuthUser = (user: PublicUser | null) => {
    if (user && get().status === 'authenticated' && get().user?.id === user.id) {
      set({ user });
      return;
    }
    const generation = ++authGeneration;
    clearUserScope();
    if (!user) {
      set({ user: null, status: 'guest' });
      return;
    }
    set({ user: null, status: 'loading' });
    void authenticate(user, generation).catch(() => {
      if (generation === authGeneration) set({ user: null, status: 'guest' });
    });
  };

  return {
    status: 'idle',
    user: null,
    initialize: async () => {
      if (get().status !== 'idle') return;
      const generation = ++authGeneration;
      set({ status: 'loading' });
      try {
        const user = await restoreOnlineSession();
        if (generation !== authGeneration) return;
        if (!user) {
          clearUserScope();
          set({ user: null, status: 'guest' });
          return;
        }
        await authenticate(user, generation);
      } catch {
        if (generation !== authGeneration) return;
        clearUserScope();
        set({ user: null, status: 'guest' });
      }
    },
    login: async (input) => {
      const generation = ++authGeneration;
      clearUserScope();
      const user = await loginOnlineUser(input);
      if (generation !== authGeneration) return;
      await authenticate(user, generation);
    },
    register: async (input) => {
      const generation = ++authGeneration;
      clearUserScope();
      const user = await registerOnlineUser(input);
      if (generation !== authGeneration) return;
      await authenticate(user, generation);
    },
    logout: async () => {
      await logoutOnlineUser();
      authGeneration += 1;
      clearUserScope();
      set({ user: null, status: 'guest' });
    },
    replaceUser: (user) => set({ user }),
    subscribeToAuthChanges: () => subscribeToOnlineAuthChanges(acceptAuthUser),
  };
});
