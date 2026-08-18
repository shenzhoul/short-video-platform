/**
 * SearchInput Component
 *
 * A search input component with integrated search icon and keyboard support.
 * Triggers search on Enter key press or search button click.
 * Provides real-time onChange updates and customizable placeholder text.
 * Supports both controlled and uncontrolled modes with optional clear button.
 *
 * @example
 * // Basic search input (uncontrolled)
 * <SearchInput
 *   placeholder="Search products..."
 *   onEnter={(value) => handleSearch(value)}
 * />
 *
 * // Controlled input with clear button (finance style)
 * <SearchInput
 *   value={searchQuery}
 *   onChange={(value) => setSearchQuery(value)}
 *   placeholder="Search transactions..."
 *   onClear={() => setSearchQuery('')}
 * />
 *
 * // With real-time search
 * <SearchInput
 *   placeholder="Search users..."
 *   onChange={(value) => setSearchQuery(value)}
 *   onEnter={(value) => performSearch(value)}
 * />
 *
 * // With default search feature (auto-redirects to search page)
 * <SearchInput
 *   placeholder="Search anything..."
 *   useDefaultSearch={true}
 * />
 *
 * // With default value
 * <SearchInput
 *   defaultValue="initial search"
 *   placeholder="Search anything..."
 *   onEnter={(value) => router.push(`/search?q=${value}`)}
 * />
 */

'use client';

import SearchSuggestionPanel from '@components/search/search-suggestion-panel';
import HoverRevealPanel from '@components/ui/hover-reveal-panel';
import { useRouter } from 'next/navigation';
import { ChangeEvent, FC, KeyboardEvent, useEffect, useState } from 'react';
import { SearchIcon } from 'src/icons';

interface SearchInputProps {
  // Controlled mode
  value?: string;
  onChange?: (value: string) => void;

  // Uncontrolled mode
  defaultValue?: string;

  // Common props
  placeholder?: string;
  onEnter?: (value: string) => void;
  onClear?: () => void;
  className?: string;

  // Style variants
  variant?: 'default' | 'douyin' | 'share-popover';

  // Default search feature
  useDefaultSearch?: boolean;
}

const SearchInput: FC<SearchInputProps> = ({
  value: controlledValue,
  onChange,
  defaultValue = '',
  placeholder = 'Search...',
  onEnter,
  className = '',
  variant = 'default',
  useDefaultSearch = false
}) => {
  const router = useRouter();
  // Support both controlled and uncontrolled modes
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const currentValue = isControlled ? controlledValue : internalValue;

  // Update internal value when controlled value changes
  useEffect(() => {
    if (isControlled) {
      setInternalValue(controlledValue);
    }
  }, [controlledValue, isControlled]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;

    if (!isControlled) {
      setInternalValue(newValue);
    }

    onChange?.(newValue);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;

    if (e.key === 'Escape') {
      e.currentTarget.blur();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const effectiveOnEnter = useDefaultSearch && !onEnter
        ? (value: string) => router.push(`/search?q=${encodeURIComponent(value)}`)
        : onEnter;
      effectiveOnEnter?.(currentValue);
    }
  };

  const handleSearchClick = () => {
    const effectiveOnEnter = useDefaultSearch && !onEnter
      ? (value: string) => router.push(`/search?q=${encodeURIComponent(value)}`)
      : onEnter;
    effectiveOnEnter?.(currentValue);
  };

  // Style variants
  const getContainerClasses = () => {
    const baseClasses = 'relative';

    if (variant === 'douyin') {
      return `${baseClasses} z-50 rounded-[14px] border border-solid border-(--border-soft) bg-(--control-bg) transition-colors group-hover/hover-reveal:bg-transparent group-focus-within/hover-reveal:bg-transparent`;
    }

    if (variant === 'share-popover') {
      return `${baseClasses} flex h-8 w-full items-center rounded-lg bg-(--surface-muted) px-3 text-(--text-muted) ${className}`;
    }

    // Default variant
    return `${baseClasses} flex items-center border border-border rounded-full px-2 bg-surface-soft w-full ${className}`;
  };

  const getInputClasses = () => {
    if (variant === 'douyin') {
      return 'z-100 m-0 h-full w-0 grow rounded-l-[12px] border-none bg-transparent px-3 text-[16px] font-medium leading-[22px] text-(--text-soft) caret-[#fe2c55] outline-none placeholder:text-(--text-faint)';
    }

    if (variant === 'share-popover') {
      return 'h-full min-w-0 flex-1 bg-transparent text-[13px] text-(--text-strong) outline-none placeholder:text-(--text-muted)';
    }

    // Default variant
    return 'flex-1 outline-hidden bg-transparent px-2 py-1 focus:outline-hidden';
  };

  if (variant === 'douyin') {
    return (
      <HoverRevealPanel
        className={`w-full ${className}`}
        panel={<SearchSuggestionPanel term={currentValue} />}
        panelPositionClassName="left-0 top-full pt-1.5"
        revealOnFocus
      >
        <div className={getContainerClasses()}>
          <div className='flex h-10 w-full flex-row items-center rounded-xl border border-solid border-transparent bg-transparent transition-colors group-hover/hover-reveal:border-2 group-hover/hover-reveal:border-solid group-hover/hover-reveal:border-(--text-strong) group-focus-within/hover-reveal:border-2 group-focus-within/hover-reveal:border-solid group-focus-within/hover-reveal:border-(--text-strong)'>
            <div className='[-webkit-app-region:no-drag] h-full z-50 flex-1 flex items-center relative overflow-hidden'>
              <input
                placeholder={placeholder}
                className={getInputClasses()}
                value={currentValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                aria-label={placeholder}
              />
            </div>
            <div className='relative -right-1 h-4 w-px border-l border-l-(--divider-strong)' />
            <button
              type="button"
              className='relative -right-0.5 z-50 flex h-full w-20 cursor-pointer items-center justify-center rounded-r-xl border-none bg-transparent text-(--text-soft) transition-colors duration-300 group-hover/hover-reveal:bg-(--bg-inverse) group-hover/hover-reveal:text-(--text-inverse) group-focus-within/hover-reveal:bg-(--bg-inverse) group-focus-within/hover-reveal:text-(--text-inverse)'
              onClick={handleSearchClick}
              aria-label="Search"
            >
              <SearchIcon className="text-2xl" />
              <span className='text-[16px] leading-6'>Search</span>
            </button>
          </div>
        </div>
      </HoverRevealPanel>
    );
  }

  if (variant === 'share-popover') {
    return (
      <div className={getContainerClasses()}>
        <SearchIcon className="shrink-0 text-xl" />
        <input
          type="text"
          className={getInputClasses()}
          placeholder={placeholder}
          value={currentValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          aria-label={placeholder}
        />
      </div>
    );
  }

  // Default variant
  return (
    <div className={getContainerClasses()}>
      <input
        type="text"
        className={getInputClasses()}
        placeholder={placeholder}
        value={currentValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="p-2 pr-3 text-body-text hover:text-primary focus:outline-hidden shrink-0"
        onClick={handleSearchClick}
        aria-label="Search"
      >
        <SearchIcon className='text-[20px]' />
      </button>
    </div>
  );
};

export default SearchInput;
