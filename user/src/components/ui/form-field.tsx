/**
 * FormField Component
 *
 * A versatile form field component that supports multiple input types including
 * text, password, textarea, select, date picker, tags, boolean, number, and email.
 * Integrates with react-hook-form and provides consistent styling and validation.
 *
 * Date Field Enhancement:
 * - The date field now supports automatic format parsing and conversion
 * - Users can type dates in various formats (DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, etc.)
 * - The component automatically parses and displays the date in the specified format
 * - Use the `dateFormat` prop to specify the display format (default: 'DD/MM/YYYY')
 *
 * For better tree shaking and smaller bundles, import specific components like FormFieldPassword instead of the generic FormField.
 *
 * @example
 * // Generic usage (includes all types, larger bundle)
 * <FormField type="password" ... />
 *
 * // Optimized usage (tree-shakable)
 * <FormFieldPassword ... />
 *
 * @example
 * // Date field with custom format
 * <FormFieldDate
 *   name="birthDate"
 *   label="Birth Date"
 *   control={control}
 *   dateFormat="MM/DD/YYYY"
 *   placeholder="MM/DD/YYYY"
 * />
 */

import clsx from 'clsx';
import { FC, useState } from 'react';
import { FieldError, UseFormRegisterReturn } from 'react-hook-form';
import { FiEye, FiEyeOff } from 'react-icons/fi';

interface FormFieldProps {
  noBorder?: boolean;
  type?: 'text' | 'password' | 'textarea';
  name: string;
  label?: string;
  placeholder?: string;
  register?: UseFormRegisterReturn;
  error?: FieldError;
  rightIcon?: React.ReactNode;
  rightButton?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  required?: boolean;
  helperText?: string;
  disabled?: boolean;
  onChange?: (e: any) => void;
  value?: string | Date;
  maxLength?: number;
}

const FormFieldText: React.FC<FormFieldProps> = ({
  name,
  label,
  placeholder,
  register,
  error,
  rightIcon,
  rightButton,
  className = '',
  size = 'md',
  required = false,
  helperText,
  disabled = false,
  onChange,
  value,
  maxLength
}) => {
  const baseClasses = 'w-full rounded-[10px] border-0 bg-[#363743] pl-2 text-sm text-white/75 outline-none caret-white/80 placeholder:text-white/38 focus:bg-[#3b3c49] disabled:cursor-not-allowed disabled:opacity-50';
  const borderClasses = error ? 'ring-1 ring-red-500' : '';
  const sizeClass = { sm: 'h-7 leading-7', md: 'h-8 leading-8', lg: 'h-10 leading-10' }[size];
  const wrapperClass = clsx('relative', className);
  const inputClass = clsx(baseClasses, borderClasses, sizeClass, { 'pr-12': rightIcon || rightButton || maxLength, 'aria-invalid': !!error });
  const inputId = `form-field-${name}`;
  const stringValue = typeof value === 'string' ? value : '';

  return (
    <div className={wrapperClass}>
      {label ? (
        <label htmlFor={inputId} className="block text-[14px] leading-5 text-white/90">
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
      ) : null}
      <div className="relative mt-1 w-full">
        <input
          {...register}
          id={inputId}
          type="text"
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          className={inputClass}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(e) => {
            register?.onChange(e);
            onChange?.(e);
          }}
          {...(typeof value === 'string' ? { value } : {})}
        />
        {maxLength ? (
          <span className="pointer-events-none absolute right-2 top-0 text-xs leading-8 text-white/35">
            {stringValue.length}/{maxLength}
          </span>
        ) : null}
      </div>
      {(rightIcon || rightButton) ? (
        <div className="absolute right-2 top-[31px] -translate-y-1/2">
          {rightIcon || rightButton}
        </div>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-red-500 text-sm mt-1">
          {error.message}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="opacity-70 text-xs mt-1">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};

const FormFieldPassword: React.FC<FormFieldProps> = ({
  name,
  label,
  placeholder,
  register,
  error,
  rightIcon,
  rightButton,
  className = '',
  size = 'md',
  required = false,
  helperText,
  disabled = false,
  onChange,
  value
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const baseClasses = 'w-full bg-surface px-2 border border-border rounded-md focus:outline-hidden focus:ring-2 text-[15px] disabled:bg-surface-muted disabled:text-gray-400 disabled:cursor-not-allowed';
  const borderClasses = error ? 'border-red-500 focus:ring-red-200' : 'border-border focus:ring-primary';
  const sizeClass = { sm: 'h-[30px]', md: 'h-[35px]', lg: 'h-[40px]' }[size];
  const wrapperClass = clsx('relative', className);
  const inputClass = clsx(baseClasses, borderClasses, sizeClass, { 'pr-12': rightIcon || rightButton || true, 'aria-invalid': !!error });
  const inputId = `form-field-${name}`;
  const inputType = showPassword ? 'text' : 'password';

  return (
    <div className={wrapperClass}>
      {label ? (
        <label htmlFor={inputId} className="block mb-1 font-medium opacity-70">
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
      ) : null}
      <div className="relative">
        <input
          {...register}
          id={inputId}
          type={inputType}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          className={inputClass}
          disabled={disabled}
          {...(onChange ? { onChange } : {})}
          {...(typeof value === 'string' ? { value } : {})}
        />
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          className="absolute right-1 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-70 cursor-pointer p-2"
          tabIndex={-1}
        >
          {showPassword ? <FiEye /> : <FiEyeOff />}
        </button>
      </div>
      {(rightIcon || rightButton) ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          {rightIcon || rightButton}
        </div>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-red-500 text-sm mt-1">
          {error.message}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="opacity-70 text-xs mt-1">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};

const FormFieldTextarea: FC<FormFieldProps> = ({
  noBorder = false,
  name,
  label,
  placeholder,
  register,
  error,
  rightIcon,
  rightButton,
  className = '',
  size = 'md',
  required = false,
  helperText,
  disabled = false,
  maxLength,
  value,
  onChange
}) => {
  const baseClasses = 'w-full resize-none rounded-[10px] border-0 bg-[#363743] px-2 py-2 text-sm leading-5 text-white/75 outline-none caret-white/80 placeholder:text-white/38 focus:bg-[#3b3c49] disabled:cursor-not-allowed disabled:opacity-50';
  const borderClasses = error ? 'ring-1 ring-red-500' : noBorder ? '' : '';
  const sizeClass = { sm: 'h-24', md: 'h-[128px]', lg: 'h-40' }[size];
  const wrapperClass = clsx('relative', className);
  const inputClass = clsx(baseClasses, borderClasses, sizeClass, { 'pr-12': rightIcon || rightButton, 'aria-invalid': !!error });
  const inputId = `form-field-${name}`;

  return (
    <div className={wrapperClass}>
      {label ? (
        <label htmlFor={inputId} className="block text-[14px] leading-5 text-white/90">
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
      ) : null}
      <div className="relative mt-1 w-full">
        <textarea
          {...register}
          id={inputId}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          className={inputClass}
          rows={4}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(e) => {
            register?.onChange(e);
            onChange?.(e);
          }}
          value={typeof value === 'string' ? value : value?.toString()}
        />
      </div>
      {(rightIcon || rightButton) ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          {rightIcon || rightButton}
        </div>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="text-red-500 text-sm mt-1">
          {error.message}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="opacity-70 text-xs mt-1">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};

const FormField: React.FC<FormFieldProps> = (props) => {
  const { type = 'text' } = props;
  switch (type) {
    case 'password':
      return <FormFieldPassword {...props} />;
    case 'textarea':
      return <FormFieldTextarea {...props} />;
    default:
      return <FormFieldText {...props} />;
  }
};

export default FormField;
export {
  FormFieldPassword,
  FormFieldText,
  FormFieldTextarea
};
