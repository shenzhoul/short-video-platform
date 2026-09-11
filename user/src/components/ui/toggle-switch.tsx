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
      // 36x20 from `lg` up; 28x16 below, sized to the compact rows it sits in
      // (the account menu footer and the profile's Save login row).
      className={`relative h-5 w-9 max-lg:h-4 max-lg:w-7 shrink-0 cursor-pointer rounded-full transition ${active ? 'bg-[#fe2c55]' : 'bg-[rgba(127,127,127,.45)]'} ${className}`}
      onClick={handleClick}
      {...props}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 max-lg:h-3 max-lg:w-3 rounded-full bg-white shadow-sm transition-transform ${active ? 'translate-x-4 max-lg:translate-x-3' : 'translate-x-0'}`}
      />
    </button>
  );
}
