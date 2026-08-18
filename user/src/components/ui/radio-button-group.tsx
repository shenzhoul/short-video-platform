'use client';

import clsx from 'clsx';
import { useState } from 'react';

export interface RadioButtonOption {
  label: string;
  value: string;
}

interface RadioButtonGroupProps {
  options: RadioButtonOption[];
  defaultValue?: string;
  value?: string;
  name?: string;
  onChange?: (value: string) => void;
  className?: string;
  optionClassName?: string;
}

export function RadioButtonGroup({
  options,
  defaultValue,
  value,
  name,
  onChange,
  className,
  optionClassName
}: RadioButtonGroupProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? '');
  const selectedValue = value ?? internalValue;

  const handleChange = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
  };

  return (
    <div className={clsx('flex gap-2', className)} role="radiogroup" aria-label={name}>
      {options.map((option) => {
        const isActive = option.value === selectedValue;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => handleChange(option.value)}
            className={clsx(
              'flex h-8 min-w-[132px] items-center rounded-sm px-3 text-sm transition-colors',
              isActive
                ? 'bg-[#fff1f4] text-[#fe2c55]'
                : 'bg-(--action-card-bg) text-(--text-strong)',
              optionClassName
            )}
          >
            <span
              className={clsx(
                'mr-2 flex h-[18px] w-[18px] items-center justify-center rounded-full border',
                isActive ? 'border-[#fe2c55] bg-[#fe2c55]' : 'border-(--border-soft) bg-transparent'
              )}
            >
              {isActive ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
            </span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
