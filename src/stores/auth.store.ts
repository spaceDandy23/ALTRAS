import { create } from 'zustand';
import { db } from '@/db/database';
import { loginUser, logoutUser, registerUser, restoreSession } from '@/features/auth/auth.service';
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
      const user = await restoreSession(db);
      set({ user, status: user ? 'authenticated' : 'guest' });
    } catch {
      set({ user: null, status: 'guest' });
    }
  },
  login: async (input) => {
    const user = await loginUser(db, input);
    set({ user, status: 'authenticated' });
  },
  register: async (input) => {
    const user = await registerUser(db, input);
    set({ user, status: 'authenticated' });
  },
  logout: async () => {
    await logoutUser(db);
    set({ user: null, status: 'guest' });
  },
  replaceUser: (user) => set({ user }),
}));
