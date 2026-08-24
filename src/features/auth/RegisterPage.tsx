import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { useAuthStore } from '@/stores/auth.store';
import { registrationSchema } from './auth.schemas';
import { AuthFrame } from './AuthFrame';

export function RegisterPage() {
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const register = useAuthStore((state) => state.register);
  const navigate = useNavigate();

  const setField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    const result = registrationSchema.safeParse(form);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = String(issue.path[0] ?? 'form');
        nextErrors[field] ??= issue.message;
      });
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    try {
      await register(form);
      navigate('/', { replace: true });
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Unable to create the account.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame>
      <div className="auth-card__heading auth-card__heading--compact">
        <h1>Create an account</h1>
        <p>Each student gets separate progress and settings on this computer.</p>
      </div>
      <form
        className="auth-form auth-form--grid"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        {errors.form && <div className="form-alert form-alert--wide">{errors.form}</div>}
        <FormField
          label="Display name"
          value={form.displayName}
          onChange={(event) => setField('displayName', event.target.value)}
          error={errors.displayName}
          autoComplete="name"
          required
        />
        <FormField
          label="Username"
          value={form.username}
          onChange={(event) => setField('username', event.target.value)}
          error={errors.username}
          hint="3–24 letters, numbers, _ or -"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <FormField
          label="Password"
          type="password"
          value={form.password}
          onChange={(event) => setField('password', event.target.value)}
          error={errors.password}
          hint="At least 8 characters with a letter and number"
          autoComplete="new-password"
          required
        />
        <FormField
          label="Confirm password"
          type="password"
          value={form.confirmPassword}
          onChange={(event) => setField('confirmPassword', event.target.value)}
          error={errors.confirmPassword}
          autoComplete="new-password"
          required
        />
        <Button type="submit" fullWidth disabled={submitting} className="auth-form__submit">
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="auth-switch">
        Already have a local account? <Link to="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
