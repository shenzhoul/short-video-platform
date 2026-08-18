/**
 * Button Component
 *
 * A versatile button component that can render as either a button or link element.
 * Supports different variants, sizes, and states including loading and disabled.
 *
 * @example
 * // Basic button
 * <Button variant="primary" size="md">Click me</Button>
 *
 * // Button with loading state
 * <Button loading={true}>Loading...</Button>
 *
 * // Button as link
 * <Button href="/dashboard" variant="border">Go to Dashboard</Button>
 *
 * // Full width button
 * <Button fullWidth variant="grey">Submit Form</Button>
 */

import clsx from 'clsx';
import Link from 'next/link';

type ButtonVariant = 'primary' | 'black' | 'grey-light' | 'border' | 'link' | 'grey' | 'primary-200' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  className?: string;
  disabled?: boolean;
}

type ButtonProps = CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: undefined;
};

type LinkProps = CommonProps & React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

type ButtonOrLinkProps = ButtonProps | LinkProps;

const Button: React.FC<ButtonOrLinkProps> = (props) => {
  const {
    children,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    className,
    ...rest
  } = props;

  const sizeClass = {
    sm: 'px-3 py-1.5 text-[14px]',
    md: 'px-6 py-2.5 text-[16px]',
    lg: 'px-8 py-3 text-[16px]'
  };

  const baseClass = clsx(
    'inline-flex items-center justify-center rounded-4xl font-medium transition duration-200 text-center cursor-pointer gap-1 whitespace-nowrap',
    fullWidth && 'w-full',
    sizeClass[size],
    {
      'bg-gradient-to-r text-[#fff] hover:opacity-90': variant === 'primary',
      'bg-black text-[#fff] hover:opacity-90': variant === 'black',
      'bg-surface-soft text-body-text hover:opacity-90': variant === 'grey-light',
      'border border-border hover:opacity-90': variant === 'border',
      'text-main hover:bg-surface-soft': variant === 'link',
      'bg-primary-200 text-body-text hover:opacity-90': variant === 'primary-200',
      'bg-red-600 text-[#fff] hover:opacity-90': variant === 'danger'
    },
    'disabled:cursor-not-allowed  disabled:opacity-50',
    className
  );

  if ('href' in props) {
    return (
      <Link
        {...(rest as LinkProps)}
        className={baseClass}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      className={baseClass}
      disabled={props.disabled || loading}
      type="button"
      {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {loading ? 'Loading...' : children}
    </button>
  );
};

export default Button;
