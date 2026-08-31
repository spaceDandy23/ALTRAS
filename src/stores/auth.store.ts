import { create } from 'zustand';
import { db } from '@/db/database';
import { loginUser, logoutUser, registerUser, restoreSession } from '@/features/auth/auth.service';
import {
  loginOnlineUser,
  logoutOnlineUser,
  registerOnlineUser,
  restoreOnlineSession,
} from '@/features/auth/online-auth.service';
import { isSupabaseConfigured } from '@/services/supabase.client';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
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
      const user = isSupabaseConfigured ? await restoreOnlineSession() : await restoreSession(db);
      set({ user, status: user ? 'authenticated' : 'guest' });
    } catch {
      set({ user: null, status: 'guest' });
    }
  },
  login: async (input) => {
    const user = isSupabaseConfigured ? await loginOnlineUser(input) : await loginUser(db, input);
    set({ user, status: 'authenticated' });
  },
  register: async (input) => {
    const user = isSupabaseConfigured
      ? await registerOnlineUser(input)
      : await registerUser(db, input);
    set({ user, status: 'authenticated' });
  },
  logout: async () => {
    if (isSupabaseConfigured) await logoutOnlineUser();
    else await logoutUser(db);
    set({ user: null, status: 'guest' });
    useResearcherAccessStore.getState().clear();
  },
  replaceUser: (user) => set({ user }),
}));
