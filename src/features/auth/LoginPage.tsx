import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { loginSchema } from './auth.schemas';
import { AuthFrame } from './AuthFrame';
import { resolvePostLoginDestination } from './post-login-route';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setErrors({});
    const result = loginSchema.safeParse({ username, password });
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      setErrors({
        username: fieldErrors.username?.[0] ?? '',
        password: fieldErrors.password?.[0] ?? '',
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await login({ username, password });
      const state = location.state as { from?: string } | null;
      const authenticatedUser = useAuthStore.getState().user;
      if (authenticatedUser) {
        await useResearcherAccessStore.getState().checkAccess(authenticatedUser.id);
      }
      navigate(
        resolvePostLoginDestination(useResearcherAccessStore.getState().status, state?.from),
        { replace: true },
      );
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Unable to log in.' });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame>
      <div className="auth-card__heading">
        <h1>Sign in to ALTRAS</h1>
        <p>Continue your lessons and progress from any supported device.</p>
      </div>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {errors.form && <div className="form-alert">{errors.form}</div>}
        <FormField
          label="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={errors.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <FormField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          autoComplete="current-password"
          required
        />
        <Button
          type="submit"
          fullWidth
          disabled={submitting}
          aria-busy={submitting}
          className="auth-sign-in__submit"
        >
          <span className="auth-sign-in__submit-content" aria-live="polite">
            {submitting && <LoadingSpinner />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </span>
        </Button>
      </form>
      <p className="auth-switch">
        New to ALTRAS? <Link to="/register">Create an account</Link>
      </p>
    </AuthFrame>
  );
}
