import { useId, useState, type InputHTMLAttributes } from 'react';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function FormField({
  label,
  error,
  hint,
  id,
  className = '',
  type,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const isPassword = type === 'password';
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div
        className={
          isPassword
            ? 'form-field__input-wrap form-field__input-wrap--password'
            : 'form-field__input-wrap'
        }
      >
        <input
          id={inputId}
          type={isPassword && passwordVisible ? 'text' : type}
          className={`form-field__input ${error ? 'form-field__input--error' : ''} ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? messageId : undefined}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            className="form-field__password-toggle"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            aria-pressed={passwordVisible}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {(error || hint) && (
        <span id={messageId} className={error ? 'form-field__error' : 'form-field__hint'}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
