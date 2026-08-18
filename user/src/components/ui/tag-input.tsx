/**
 * TagInput Component
 *
 * A tag selection input component with autocomplete functionality.
 * Allows users to select multiple tags from a predefined list with search/filter capability.
 * Supports keyboard navigation, custom styling, and disabled states.
 *
 * @example
 * // Basic tag input
 * const tagOptions = [
 *   { label: 'React', value: 'react' },
 *   { label: 'TypeScript', value: 'typescript' },
 *   { label: 'Next.js', value: 'nextjs' }
 * ];
 *
 * <TagInput
 *   options={tagOptions}
 *   value={selectedTags}
 *   onChange={setSelectedTags}
 *   placeholder="Select your skills..."
 * />
 *
 * // In a form with categories
 * <TagInput
 *   options={categoryOptions}
 *   value={formData.categories}
 *   onChange={(tags) => setFormData({...formData, categories: tags})}
 *   placeholder="Choose categories..."
 *   disabled={isSubmitting}
 * />
 *
 * // With custom className
 * <TagInput
 *   options={interestOptions}
 *   value={interests}
 *   onChange={setInterests}
 *   className="max-w-md"
 *   placeholder="What are your interests?"
 * />
 */

import { ChangeEvent, FC, KeyboardEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';

export interface TagOption {
  label: string;
  value: string;
}

interface TagInputProps {
  options?: TagOption[];
  value?: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const TagInput: FC<TagInputProps> = ({
  options = [],
  value = [],
  onChange,
  placeholder = 'Select or type to search tags',
  disabled = false,
  className = ''
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState<TagOption[]>(options || []);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const safeOptions = Array.isArray(options) ? options : [];
    const safeValue = Array.isArray(value) ? value : [];

    if (inputValue) {
      setFilteredOptions(
        safeOptions.filter(
          (opt) =>
            opt.label.toLowerCase().includes(inputValue.toLowerCase()) &&
            !safeValue.includes(opt.value)
        )
      );
    } else {
      setFilteredOptions(safeOptions.filter((opt) => !safeValue.includes(opt.value)));
    }
  }, [inputValue, options, value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside as any);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside as any);
    };
  }, []);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setIsOpen(true);
  };

  const handleSelect = (option: TagOption) => {
    if (!value.includes(option.value)) {
      onChange([...value, option.value]);
      setInputValue('');
      // Do NOT close dropdown on select
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const handleRemove = (val: string) => {
    onChange(value.filter((v) => v !== val));
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag
      onChange(value.slice(0, -1));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmedInput = inputValue.trim();
      if (trimmedInput) {
        if (!value.includes(trimmedInput)) {
          onChange([...value, trimmedInput]);
        }
        setInputValue('');
      } else if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0]);
      }
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleDropdownClose = (e?: MouseEvent) => {
    setIsOpen(false);
    if (inputRef.current) inputRef.current.blur();
    if (e) e.stopPropagation();
  };

  return (
    <div
      className={`relative w-full min-h-[44px] border border-border rounded-md bg-surface flex flex-wrap items-center gap-1 px-2 py-1 focus-within:ring-2 focus-within:ring-primary ${disabled ? 'opacity-60 pointer-events-none' : ''
        } ${className}`}
      ref={containerRef}
      tabIndex={-1}
    >
      {/* Selected tags */}
      {value.map((val) => {
        const tag = (options || []).find((opt) => opt.value === val);
        return (
          <span
            key={val}
            className="flex items-center bg-primary/10 text-primary rounded px-2 py-1 text-sm mr-1 mb-1"
          >
            {tag?.label || val}
            <button
              type="button"
              className="ml-1 hover:text-red-500 focus:outline-hidden"
              onClick={() => handleRemove(val)}
              tabIndex={-1}
              aria-label={`Remove ${tag?.label || val}`}
            >
              <FiX className="w-4 h-4" />
            </button>
          </span>
        );
      })}
      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        className="flex-1 min-w-[120px] border-none outline-hidden bg-transparent text-[15px] py-1 px-2"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onKeyDown={handleKeyDown}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        aria-label="Tag input"
      />
      {/* Dropdown */}
      {isOpen && filteredOptions.length > 0 ? (
        <div className="absolute left-0 top-full mt-1 w-full z-10 bg-surface border border-border rounded shadow-lg max-h-48 overflow-auto">
          <div className="flex justify-end p-1">
            <button
              type="button"
              className="text-gray-400 hover:text-red-500 p-1"
              onClick={handleDropdownClose}
              aria-label="Close dropdown"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
          {filteredOptions.map((opt) => (
            <div
              key={opt.value}
              className="px-3 py-2 cursor-pointer hover:bg-primary/10 text-[15px]"
              onMouseDown={() => handleSelect(opt)}
              tabIndex={0}
              role="option"
              aria-selected={false}
            >
              {opt.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default TagInput;
