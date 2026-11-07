import { createContext, useContext, type ReactNode, useId, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { FormField, type FormFieldProps } from '@/components/ui/FormField';

export type ValidationPathPart = string | number;
export type LessonValidationIssue = {
  path: ValidationPathPart[];
  label: string;
  message: string;
};

type ValidationContextValue = {
  issues: LessonValidationIssue[];
  prefix: ValidationPathPart[];
};

const ValidationContext = createContext<ValidationContextValue>({ issues: [], prefix: [] });

export function LessonValidationProvider({
  issues,
  children,
}: {
  issues: LessonValidationIssue[];
  children: ReactNode;
}) {
  return <ValidationContext.Provider value={{ issues, prefix: [] }}>{children}</ValidationContext.Provider>;
}

export function ValidationScope({
  path,
  children,
}: {
  path: ValidationPathPart[];
  children: ReactNode;
}) {
  const parent = useContext(ValidationContext);
  return (
    <ValidationContext.Provider value={{ ...parent, prefix: [...parent.prefix, ...path] }}>
      {children}
    </ValidationContext.Provider>
  );
}

function pathKey(path: ValidationPathPart[]) {
  return JSON.stringify(path);
}

export function useLessonValidation(path: ValidationPathPart[] = []) {
  const { issues, prefix } = useContext(ValidationContext);
  const fullPath = [...prefix, ...path];
  const issue = issues.find((candidate) => pathKey(candidate.path) === pathKey(fullPath));
  return {
    error: issue?.message,
    validationPath: pathKey(fullPath),
    fieldAttributes: {
      'data-validation-path': pathKey(fullPath),
      'aria-invalid': issue ? true : undefined,
    },
  };
}

export function ValidationFieldError({ path }: { path: ValidationPathPart[] }) {
  const { error } = useLessonValidation(path);
  return error ? <span className="form-field__error">{error}</span> : null;
}

export function ValidatedSelectField({
  label,
  validationPath,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  validationPath: ValidationPathPart[];
  children: ReactNode;
}) {
  const id = useId();
  const validation = useLessonValidation(validationPath);
  const messageId = `${id}-error`;
  return (
    <label className="form-field">
      <span className="form-field__label">{label}</span>
      <select id={id} {...props} {...validation.fieldAttributes} className={`${props.className ?? ''} ${validation.error ? 'form-field__input--error' : ''}`.trim()} aria-describedby={validation.error ? messageId : undefined}>
        {children}
      </select>
      {validation.error && <span id={messageId} className="form-field__error">{validation.error}</span>}
    </label>
  );
}

export function ValidatedTextareaField({
  label,
  validationPath,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; validationPath: ValidationPathPart[] }) {
  const id = useId();
  const validation = useLessonValidation(validationPath);
  const messageId = `${id}-error`;
  return (
    <label className="form-field admin-textarea-field" htmlFor={id}>
      <span className="form-field__label">{label}</span>
      <textarea id={id} {...props} {...validation.fieldAttributes} className={`${props.className ?? ''} ${validation.error ? 'form-field__input--error' : ''}`.trim()} aria-describedby={validation.error ? messageId : undefined} />
      {validation.error && <span id={messageId} className="form-field__error">{validation.error}</span>}
    </label>
  );
}

export function ValidatedFormField({
  validationPath,
  ...props
}: Omit<FormFieldProps, 'validationPath'> & { validationPath: ValidationPathPart[] }) {
  const validation = useLessonValidation(validationPath);
  return <FormField {...props} error={validation.error} validationPath={validation.validationPath} />;
}

export function LessonValidationSummary({ issues }: { issues: LessonValidationIssue[] }) {
  if (issues.length === 0) return null;
  const focusField = (path: ValidationPathPart[]) => {
    const key = pathKey(path);
    const target = [...document.querySelectorAll<HTMLElement>('[data-validation-path]')]
      .find((element) => element.dataset.validationPath === key);
    if (!target) return;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView?.({ behavior: 'auto', block: 'center' });
      target.focus({ preventScroll: true });
    });
  };
  return (
    <section className="admin-validation-summary" role="alert" aria-labelledby="lesson-validation-title">
      <AlertCircle aria-hidden="true" size={22} />
      <div>
        <h2 id="lesson-validation-title">
          {issues.length} {issues.length === 1 ? 'field needs' : 'fields need'} attention
        </h2>
        <p>Review the highlighted fields below.</p>
        <ul>
          {issues.map((issue) => (
            <li key={pathKey(issue.path)}>
              <button type="button" onClick={() => focusField(issue.path)}>
                <strong>{issue.label}:</strong> {issue.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
