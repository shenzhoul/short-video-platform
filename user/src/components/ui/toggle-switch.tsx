'use client';

import { ButtonHTMLAttributes, useState } from 'react';

interface ToggleSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}

export default function ToggleSwitch({
  checked,
  defaultChecked = false,
  onChange,
  className = '',
  ...props
}: ToggleSwitchProps) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const active = isControlled ? checked : internalChecked;

  const handleClick = () => {
    const next = !active;
    if (!isControlled) setInternalChecked(next);
    onChange?.(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      className={`relative h-5 w-9 cursor-pointer rounded-full transition ${active ? 'bg-[#fe2c55]' : 'bg-[rgba(127,127,127,.45)]'} ${className}`}
      onClick={handleClick}
      {...props}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${active ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}
