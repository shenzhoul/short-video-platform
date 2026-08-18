/**
 * DateRangePicker Component
 *
 * A date range picker component using rc-picker (the same library Ant Design uses).
 * Provides Ant Design-inspired styling with preset ranges, full TypeScript support.
 *
 * @example
 * // Basic date range picker
 * const [startDate, setStartDate] = useState<Date | null>(null);
 * const [endDate, setEndDate] = useState<Date | null>(null);
 * <DateRangePicker
 *   startDate={startDate}
 *   endDate={endDate}
 *   onChange={([start, end]) => {
 *     setStartDate(start);
 *     setEndDate(end);
 *   }}
 * />
 *
 * @example
 * // Date range picker with preset ranges
 * <DateRangePicker
 *   startDate={startDate}
 *   endDate={endDate}
 *   onChange={([start, end]) => {
 *     setStartDate(start);
 *     setEndDate(end);
 *   }}
 *   showPresets
 * />
 * // Built-in presets: Today, Yesterday, Last 7 days, This month, Last month, This week
 *
 * @example
 * // With custom presets
 * const customPresets = [
 *   { label: 'Last 30 days', value: [subDays(new Date(), 29), new Date()] },
 *   { label: 'Last 90 days', value: [subDays(new Date(), 89), new Date()] }
 * ];
 * <DateRangePicker
 *   startDate={startDate}
 *   endDate={endDate}
 *   onChange={([start, end]) => {
 *     setStartDate(start);
 *     setEndDate(end);
 *   }}
 *   showPresets
 *   presets={customPresets}
 * />
 *
 * @example
 * // Size variants
 * <DateRangePicker startDate={s} endDate={e} onChange={onChange} size="small" />
 * <DateRangePicker startDate={s} endDate={e} onChange={onChange} size="default" />
 * <DateRangePicker startDate={s} endDate={e} onChange={onChange} size="large" />
 *
 * @example
 * // Status variants (for form validation)
 * <DateRangePicker startDate={s} endDate={e} onChange={onChange} status="success" />
 * <DateRangePicker startDate={s} endDate={e} onChange={onChange} status="warning" />
 * <DateRangePicker startDate={s} endDate={e} onChange={onChange} status="error" />
 *
 * @example
 * // Disabled state
 * <DateRangePicker disabled placeholder="Disabled" />
 *
 * @example
 * // With date constraints
 * <DateRangePicker
 *   startDate={startDate}
 *   endDate={endDate}
 *   onChange={([start, end]) => {
 *     setStartDate(start);
 *     setEndDate(end);
 *   }}
 *   minDate={new Date('2025-01-01')}
 *   maxDate={new Date('2025-12-31')}
 * />
 */

'use client';

import 'rc-picker/assets/index.css';
import './date-picker.css';

import { endOfMonth, endOfWeek, startOfMonth, startOfWeek, subDays } from 'date-fns';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import RangePicker from 'rc-picker/es/PickerInput/RangePicker';
import dayjsGenerateConfig from 'rc-picker/lib/generate/dayjs';
import enUS from 'rc-picker/lib/locale/en_US';
import { forwardRef, useMemo } from 'react';

dayjs.extend(customParseFormat);

type DateRangePickerSize = 'small' | 'default' | 'large';
type DateRangePickerStatus = 'default' | 'error' | 'warning' | 'success';

interface DateRangePreset {
  label: string;
  value: [Date, Date];
}

interface DateRangePickerProps {
  startDate?: Date | null;
  endDate?: Date | null;
  onChange?: (dates: [Date | null, Date | null]) => void;
  placeholder?: string | [string, string];
  size?: DateRangePickerSize;
  status?: DateRangePickerStatus;
  disabled?: boolean;
  showPresets?: boolean;
  presets?: DateRangePreset[];
  maxDate?: Date;
  minDate?: Date;
  className?: string;
  onBlur?: () => void;
  onFocus?: () => void;
}

const sizeClasses: Record<DateRangePickerSize, string> = {
  small: 'rc-picker-small',
  default: '',
  large: 'rc-picker-large'
};

const statusClasses: Record<DateRangePickerStatus, string> = {
  default: '',
  error: 'rc-picker-status-error',
  warning: 'rc-picker-status-warning',
  success: 'rc-picker-status-success'
};

const DEFAULT_PRESETS: DateRangePreset[] = [
  { label: 'Today', value: [new Date(), new Date()] },
  {
    label: 'Yesterday',
    value: [subDays(new Date(), 1), subDays(new Date(), 1)]
  },
  {
    label: 'Last 7 days',
    value: [subDays(new Date(), 6), new Date()]
  },
  {
    label: 'This month',
    value: [startOfMonth(new Date()), endOfMonth(new Date())]
  },
  {
    label: 'Last month',
    value: [
      startOfMonth(subDays(new Date(), 30)),
      endOfMonth(subDays(new Date(), 30))
    ]
  },
  {
    label: 'This week',
    value: [startOfWeek(new Date()), endOfWeek(new Date())]
  }
];

export const DateRangePicker = forwardRef<HTMLDivElement, DateRangePickerProps>(
  (
    {
      startDate,
      endDate,
      onChange,
      placeholder = 'Select date',
      size = 'default',
      status = 'default',
      disabled = false,
      showPresets = false,
      presets = DEFAULT_PRESETS,
      maxDate,
      minDate,
      className = '',
      onBlur,
      onFocus
    },
    ref
  ) => {
    const dayjsStartDate = useMemo(() => (startDate ? dayjs(startDate) : null), [startDate]);
    const dayjsEndDate = useMemo(() => (endDate ? dayjs(endDate) : null), [endDate]);
    const dayjsMinDate = useMemo(() => (minDate ? dayjs(minDate) : undefined), [minDate]);
    const dayjsMaxDate = useMemo(() => (maxDate ? dayjs(maxDate) : undefined), [maxDate]);

    const handleChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
      if (Array.isArray(dates)) {
        const [start, end] = dates;
        onChange?.([start ? start.toDate() : null, end ? end.toDate() : null]);
      } else if (dates === null) {
        // Handle clear action
        onChange?.([null, null]);
      }
    };

    const presetsOptions = useMemo(
      () => (showPresets
        ? presets.map((preset) => ({
          label: preset.label,
          value: () => [dayjs(preset.value[0]), dayjs(preset.value[1])] as [Dayjs, Dayjs]
        }))
        : undefined),
      [showPresets, presets]
    );

    const pickerClassName = [
      sizeClasses[size],
      statusClasses[status],
      className
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        ref={ref}
        className="w-full"
      >
        <RangePicker
          locale={enUS}
          generateConfig={dayjsGenerateConfig}
          // Allow showing partial ranges (only start or only end selected)
          value={
            dayjsStartDate || dayjsEndDate
              ? [dayjsStartDate as Dayjs | null, dayjsEndDate as Dayjs | null]
              : null
          }
          onChange={handleChange}
          placeholder={
            Array.isArray(placeholder)
              ? placeholder
              : [placeholder, placeholder]
          }
          disabled={disabled}
          maxDate={dayjsMaxDate}
          minDate={dayjsMinDate}
          format="YYYY-MM-DD"
          onBlur={onBlur}
          onFocus={onFocus}
          className={pickerClassName}
          presets={presetsOptions}
          inputReadOnly={false}
          allowClear
          allowEmpty={[true, true]}
          changeOnBlur
        />
      </div>
    );
  }
);

DateRangePicker.displayName = 'DateRangePicker';
