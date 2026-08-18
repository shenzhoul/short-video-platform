/**
 * DatePicker Component
 *
 * A single date picker component using rc-picker (the same library Ant Design uses).
 * Provides Ant Design-inspired styling with full TypeScript support.
 *
 * Features:
 * - Automatic date format parsing: Users can type dates in various formats (DD/MM/YYYY, MM/DD/YYYY, etc.)
 *   and the component will automatically parse and display them in the specified format.
 * - Smart number padding: Handles single-digit days/months (e.g., 1/1/2000 → 01/01/2000).
 * - Flexible input: Accepts dates typed manually or selected from the calendar popup.
 * - Format validation: Validates dates against min/max date constraints.
 *
 * @example
 * // Basic date picker with DD/MM/YYYY format (default)
 * // Accepts: 1/1/2000, 01/01/2000, 1-1-2000, etc.
 * const [selectedDate, setSelectedDate] = useState<Date | null>(null);
 * <DatePicker
 *   value={selectedDate}
 *   onChange={setSelectedDate}
 *   placeholder="Select a date"
 * />
 *
 * @example
 * // With custom format (MM/DD/YYYY for US dates)
 * <DatePicker
 *   value={date}
 *   onChange={setDate}
 *   format="MM/DD/YYYY"
 *   placeholder="MM/DD/YYYY"
 * />
 *
 * @example
 * // With age restriction (18+ only)
 * const maxAge18 = subYears(new Date(), 18);
 * <DatePicker
 *   value={birthDate}
 *   onChange={setBirthDate}
 *   maxDate={maxAge18}
 *   placeholder="Select your birth date"
 * />
 *
 * @example
 * // Size variants
 * <DatePicker value={date} onChange={setDate} size="small" />
 * <DatePicker value={date} onChange={setDate} size="default" />
 * <DatePicker value={date} onChange={setDate} size="large" />
 *
 * @example
 * // Status variants (for form validation)
 * <DatePicker value={date} onChange={setDate} status="success" />
 * <DatePicker value={date} onChange={setDate} status="warning" />
 * <DatePicker value={date} onChange={setDate} status="error" />
 *
 * @example
 * // Disabled state
 * <DatePicker disabled placeholder="Disabled" />
 *
 * @example
 * // With date constraints
 * <DatePicker
 *   value={date}
 *   onChange={setDate}
 *   minDate={new Date('2025-01-01')}
 *   maxDate={new Date('2025-12-31')}
 * />
 */

'use client';

import 'rc-picker/assets/index.css';
import './date-picker.css';

import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import Picker from 'rc-picker';
import dayjsGenerateConfig from 'rc-picker/lib/generate/dayjs';
import enUS from 'rc-picker/lib/locale/en_US';
import { forwardRef, useEffect, useMemo, useRef } from 'react';

dayjs.extend(customParseFormat);

// Helper function to normalize and pad date strings
const normalizeDateInput = (input: string): string[] => {
  if (!input) return [input];

  const variants: string[] = [input];

  // Handle date strings with separators (/, -, .)
  const separatorMatch = input.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (separatorMatch) {
    const [, part1, part2, year] = separatorMatch;
    const separator = input.match(/[\/\-\.]/)?.[0] || '/';

    // Pad day and month to 2 digits
    const paddedPart1 = part1.padStart(2, '0');
    const paddedPart2 = part2.padStart(2, '0');

    // Pad year to 4 digits if it's 2 digits
    const fullYear = year.length === 2 ? `20${year}` : year;

    // Add padded variant
    variants.push(`${paddedPart1}${separator}${paddedPart2}${separator}${fullYear}`);

    // Also add variant with original separator but padded numbers
    if (year.length === 4) {
      variants.push(`${paddedPart1}${separator}${paddedPart2}${separator}${year}`);
    }
  }

  return variants;
};

// Helper function to parse date from various formats
const parseDate = (input: string, preferredFormat: string): Dayjs | null => {
  if (!input) return null;

  // Get normalized variants of the input
  const inputVariants = normalizeDateInput(input.trim());

  // Common date formats to try
  const formats = [
    preferredFormat,
    'DD/MM/YYYY',
    'MM/DD/YYYY',
    'DD-MM-YYYY',
    'MM-DD-YYYY',
    'DD.MM.YYYY',
    'MM.DD.YYYY',
    'YYYY-MM-DD',
    'YYYY/MM/DD',
    'D/M/YYYY',
    'M/D/YYYY',
    'D-M-YYYY',
    'M-D-YYYY',
    'D/M/YY',
    'M/D/YY',
    'DD/MM/YY',
    'MM/DD/YY',
    'D-M-YY',
    'M-D-YY',
    'D.M.YYYY',
    'M.D.YYYY',
    'D.M.YY',
    'M.D.YY',
    'DDMMYYYY',
    'MMDDYYYY'
  ];

  // Try each input variant with each format
  for (const variant of inputVariants) {
    for (const format of formats) {
      const parsed = dayjs(variant, format, true);
      if (parsed.isValid()) {
        return parsed;
      }
    }
  }

  // Fallback to dayjs default parsing
  const fallback = dayjs(input);
  return fallback.isValid() ? fallback : null;
};

type DatePickerSize = 'small' | 'default' | 'large';
type DatePickerStatus = 'default' | 'error' | 'warning' | 'success';

interface DatePickerProps {
  value?: Date | null;
  onChange?: (date: Date | null) => void;
  placeholder?: string;
  size?: DatePickerSize;
  status?: DatePickerStatus;
  disabled?: boolean;
  maxDate?: Date;
  minDate?: Date;
  className?: string;
  onBlur?: () => void;
  onFocus?: () => void;
  format?: string; // Display format (e.g., 'DD/MM/YYYY', 'MM/DD/YYYY')
}

const sizeClasses: Record<DatePickerSize, string> = {
  small: 'rc-picker-small',
  default: '',
  large: 'rc-picker-large'
};

const statusClasses: Record<DatePickerStatus, string> = {
  default: '',
  error: 'rc-picker-status-error',
  warning: 'rc-picker-status-warning',
  success: 'rc-picker-status-success'
};

export const DatePicker = forwardRef<HTMLDivElement, DatePickerProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Select date',
      size = 'default',
      status = 'default',
      disabled = false,
      maxDate,
      minDate,
      className = '',
      onBlur,
      onFocus,
      format = 'DD/MM/YYYY' // Default to DD/MM/YYYY format
    },
    ref
  ) => {
    const pickerRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dayjsValue = useMemo(() => (value ? dayjs(value) : null), [value]);
    const dayjsMinDate = useMemo(() => (minDate ? dayjs(minDate) : undefined), [minDate]);
    const dayjsMaxDate = useMemo(() => (maxDate ? dayjs(maxDate) : undefined), [maxDate]);

    useEffect(() => {
      if (containerRef.current) {
        const input = containerRef.current.querySelector('input') as HTMLInputElement;
        if (input) {
          // Add event listener for Enter and Tab keys to format immediately
          const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              const inputValue = input.value;
              if (inputValue) {
                const parsed = parseDate(inputValue, format);
                if (parsed && parsed.isValid()) {
                  // Check if date is within min/max bounds
                  if (!dayjsMinDate || !parsed.isBefore(dayjsMinDate, 'day')) {
                    if (!dayjsMaxDate || !parsed.isAfter(dayjsMaxDate, 'day')) {
                      // Update value which will trigger re-render with formatted date
                      onChange?.(parsed.toDate());
                    }
                  }
                }
              }
            }
          };

          // Also handle input event to format as user types
          const handleInput = (e: Event) => {
            const target = e.target as HTMLInputElement;
            const inputValue = target.value;
            // Only format if input looks complete
            if (inputValue && inputValue.length >= 8 && /[\d\/\-\.]/.test(inputValue)) {
              const parsed = parseDate(inputValue, format);
              if (parsed && parsed.isValid()) {
                // Check if date is within min/max bounds
                if (!dayjsMinDate || !parsed.isBefore(dayjsMinDate, 'day')) {
                  if (!dayjsMaxDate || !parsed.isAfter(dayjsMaxDate, 'day')) {
                    // Format immediately after a short delay to allow user to finish typing
                    setTimeout(() => {
                      if (target.value === inputValue) {
                        // Only format if value hasn't changed
                        const formattedDate = parsed.format(format);
                        if (target.value !== formattedDate) {
                          onChange?.(parsed.toDate());
                        }
                      }
                    }, 500);
                  }
                }
              }
            }
          };

          input.addEventListener('keydown', handleKeyDown);
          input.addEventListener('input', handleInput);
          return () => {
            input.removeEventListener('keydown', handleKeyDown);
            input.removeEventListener('input', handleInput);
          };
        }
      }
    }, [format, dayjsMinDate, dayjsMaxDate, onChange]);

    // Format input value when value changes
    useEffect(() => {
      if (dayjsValue && dayjsValue.isValid() && containerRef.current) {
        const formattedDate = dayjsValue.format(format);
        // Find input element within the picker
        const input = containerRef.current.querySelector('input') as HTMLInputElement;
        if (input) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            if (input && input.value !== formattedDate) {
              input.value = formattedDate;
            }
          });
        }
      }
    }, [dayjsValue, format]);

    const handleChange = (date: Dayjs | null, dateString?: string) => {
      if (date && date.isValid()) {
        onChange?.(date.toDate());
      } else if (dateString && typeof dateString === 'string') {
        // Try to parse the manually entered date string
        const parsed = parseDate(dateString, format);
        if (parsed && parsed.isValid()) {
          // Check if date is within min/max bounds
          if (dayjsMinDate && parsed.isBefore(dayjsMinDate, 'day')) {
            onChange?.(null);
          } else if (dayjsMaxDate && parsed.isAfter(dayjsMaxDate, 'day')) {
            onChange?.(null);
          } else {
            onChange?.(parsed.toDate());
          }
        } else {
          onChange?.(null);
        }
      } else {
        onChange?.(null);
      }
    };

    const handleBlur = (e: any) => {
      // Try to parse and format any input on blur
      const inputValue = e?.target?.value || '';
      if (inputValue && containerRef.current) {
        const parsed = parseDate(inputValue, format);
        if (parsed && parsed.isValid()) {
          // Check if date is within min/max bounds
          if (!dayjsMinDate || !parsed.isBefore(dayjsMinDate, 'day')) {
            if (!dayjsMaxDate || !parsed.isAfter(dayjsMaxDate, 'day')) {
              // Update the value which will trigger useEffect to format the input
              onChange?.(parsed.toDate());
            }
          }
        }
      }
      onBlur?.();
    };

    const pickerClassName = [
      sizeClasses[size],
      statusClasses[status],
      className
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        ref={(node) => {
          containerRef.current = node;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className="w-full"
      >
        <Picker
          ref={pickerRef}
          locale={enUS}
          generateConfig={dayjsGenerateConfig}
          value={dayjsValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          maxDate={dayjsMaxDate}
          minDate={dayjsMinDate}
          format={format} // Use the specified display format
          onBlur={handleBlur}
          onFocus={onFocus}
          className={pickerClassName}
          inputReadOnly={false} // Allow manual input
          allowClear
        />
      </div>
    );
  }
);

DatePicker.displayName = 'DatePicker';
