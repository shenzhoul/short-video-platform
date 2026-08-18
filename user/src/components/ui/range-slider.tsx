/**
 * RangeSlider Component
 *
 * A simple range slider input component for selecting numeric values within a specified range.
 * Displays the current value above the slider and supports custom min, max, and step values.
 *
 * @example
 * // Basic range slider (0-100)
 * <RangeSlider
 *   min={0}
 *   max={100}
 *   value={sliderValue}
 *   onChange={setSliderValue}
 * />
 *
 * // Price range slider
 * <RangeSlider
 *   min={0}
 *   max={1000}
 *   step={10}
 *   value={priceFilter}
 *   onChange={setPriceFilter}
 * />
 *
 * // Volume control
 * <RangeSlider
 *   min={0}
 *   max={100}
 *   step={5}
 *   value={volume}
 *   onChange={setVolume}
 * />
 */

import { FC } from 'react';

interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}

const RangeSlider: FC<RangeSliderProps> = ({ min, max, step = 1, value, onChange }) => {
  return (
    <div className="w-full flex flex-col items-center">
      <span className="mb-1 text-xs opacity-60">{value}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 bg-surface-muted rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
      />
    </div>
  );
};

export default RangeSlider;
