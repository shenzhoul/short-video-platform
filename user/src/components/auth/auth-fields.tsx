'use client';

import clsx from 'clsx';
import { forwardRef, useId, useState } from 'react';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';
import { FiEye, FiEyeOff } from 'react-icons/fi';

/**
 * Inputs for the authentication dialog.
 *
 * Separate from `@components/ui/form-field` on purpose: those are painted with
 * fixed dark values (`bg-[#363743]`, `text-white/75`) because they live in the
 * creator publish flow, which is dark in both themes. This dialog follows the
 * page theme, so its fields are built from `--field-bg` / `--text-*` and read
 * correctly in light and dark.
 *
 * Everything else — the error wiring, `aria-invalid`, `aria-describedby` — is
 * the same contract those fields use, so the two behave alike for a screen
 * reader.
 */

const controlClass = (invalid: boolean) => clsx(
  'h-11 w-full rounded-lg border bg-(--field-bg) px-3 text-[14px] text-(--text-strong) outline-none',
  'placeholder:text-(--text-faint) transition',
  'focus:border-(--divider-strong) disabled:cursor-not-allowed disabled:opacity-60',
  invalid ? 'border-[#ff2f5f]' : 'border-transparent'
);

interface BaseProps {
  label: string;
  /** Visually hide the label but keep it for assistive technology. */
  hideLabel?: boolean;
  placeholder?: string;
  error?: FieldError;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
}

type TextProps = BaseProps & {
  register: UseFormRegisterReturn;
  type?: 'text' | 'email';
};

function FieldErrorText({ id, error }: { id: string; error?: FieldError }) {
  if (!error?.message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-[12px] leading-4 text-[#ff2f5f]">
      {error.message}
    </p>
  );
}

/**
 * Text/email input.
 *
 * Forwards its ref so the dialog can put the caret in the first field when it
 * opens without reaching into the DOM.
 */
export const AuthTextField = forwardRef<HTMLInputElement, TextProps>(function AuthTextField({
  label, hideLabel, placeholder, error, register, type = 'text', autoComplete, disabled, className
}, ref) {
  const id = useId();
  const errorId = `${id}-error`;
  const { ref: registerRef, ...registerRest } = register;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1 block text-[13px] text-(--text-soft)'}
      >
        {label}
      </label>
      <input
        {...registerRest}
        ref={(element) => {
          registerRef(element);
          if (typeof ref === 'function') ref(element);
          else if (ref) ref.current = element;
        }}
        id={id}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={controlClass(!!error)}
      />
      <FieldErrorText id={errorId} error={error} />
    </div>
  );
});

type PasswordProps = BaseProps & {
  register: UseFormRegisterReturn;
};

/** Password input with a show/hide toggle. */
export function AuthPasswordField({
  label, hideLabel, placeholder, error, register, autoComplete, disabled, className
}: PasswordProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1 block text-[13px] text-(--text-soft)'}
      >
        {label}
      </label>
      <div className="relative">
        <input
          {...register}
          id={id}
          type={revealed ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={clsx(controlClass(!!error), 'pr-11')}
        />
        <button
          type="button"
          // Never a submit button: it sits inside the form, and the default
          // button type would make Enter — or a click — post the form.
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
        >
          {revealed ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
        </button>
      </div>
      <FieldErrorText id={errorId} error={error} />
    </div>
  );
}

type SelectProps = BaseProps & {
  register: UseFormRegisterReturn;
  options: Array<{ value: string; label: string }>;
};

/** Native select, so the dialog stays keyboard- and mobile-friendly. */
export function AuthSelectField({
  label, hideLabel, error, register, disabled, className, options
}: SelectProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'mb-1 block text-[13px] text-(--text-soft)'}
      >
        {label}
      </label>
      <select
        {...register}
        id={id}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={clsx(controlClass(!!error), 'cursor-pointer')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <FieldErrorText id={errorId} error={error} />
    </div>
  );
}
