import { Children, FC, ReactNode, useEffect, useRef, useState } from 'react';
import { CSSProperties } from 'react';
import { FiChevronDown, FiLoader } from 'react-icons/fi';

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  options?: Option[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  showSearch?: boolean;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}

const Select: FC<SelectProps> = ({
  options = [],
  value,
  defaultValue,
  placeholder = 'Select an option',
  onChange,
  onSearch,
  loading = false,
  disabled = false,
  showSearch = false,
  style,
  className = '',
  children
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState(value || defaultValue || '');
  const [searchValue, setSearchValue] = useState('');
  const selectRef = useRef<HTMLDivElement>(null);

  // Sync selectedValue with value prop when it changes (for controlled component)
  useEffect(() => {
    if (value !== undefined) {
      setSelectedValue(value);
    }
  }, [value]);

  // Handle outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    setSelectedValue(optionValue);
    setIsOpen(false);
    setSearchValue('');
    onChange?.(optionValue);
  };

  const handleSearch = (searchTerm: string) => {
    setSearchValue(searchTerm);
    onSearch?.(searchTerm);
  };

  const getDisplayValue = () => {
    if (showSearch && isOpen) return searchValue;
    if (children) {
      const option = Children.toArray(children).find((child: any) =>
        child.props?.value === selectedValue
      ) as any;
      return option?.props?.children || placeholder;
    }
    const selected = options.find(opt => opt.value === selectedValue);
    return selected?.label || placeholder;
  };

  const getOptionsFromChildren = () => {
    if (!children) return options;
    return Children.map(children, (child: any) => ({
      value: child.props.value,
      label: child.props.children,
      disabled: child.props.disabled
    })) || [];
  };

  const allOptions = children ? getOptionsFromChildren() : options;
  const filteredOptions = showSearch && searchValue
    ? allOptions.filter(opt =>
      opt.label.toLowerCase().includes(searchValue.toLowerCase())
    )
    : allOptions;

  return (
    <div
      ref={selectRef}
      className={`relative inline-block w-full ${className}`}
      style={style}
    >
      <div
        className={`
          w-full px-3 py-2 border  border-border rounded-md bg-input cursor-pointer
          flex items-center justify-between
          ${disabled ? 'bg-surface-muted cursor-not-allowed' : 'hover:border-gray-400'}
          ${isOpen ? 'border-blue-500 ring-1 ring-blue-500' : ''}
        `}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        {showSearch && isOpen ? (
          <input
            type="text"
            value={searchValue}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 outline-hidden bg-transparent"
            placeholder={placeholder}
            autoFocus
          />
        ) : (
          <span className={`flex-1 ${selectedValue ? 'bg-surface' : 'opacity-70'}`}>
            {getDisplayValue()}
          </span>
        )}

        <div className="flex items-center">
          {loading ? <FiLoader className="animate-spin mr-2" /> : null}
          <FiChevronDown
            className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {isOpen ? (
        <div className="absolute z-50 w-full mt-1 bg-input border  border-border rounded-md shadow-lg max-h-60 overflow-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 opacity-70">No options</div>
          ) : (
            filteredOptions.map((option) => (
              <div
                key={option.value}
                className={`
                  px-3 py-2 cursor-pointer transition-colors
                  ${option.disabled ? ' opacity-40 cursor-not-allowed' : 'hover:bg-surface-muted'}
                  ${selectedValue === option.value ? 'bg-primary-50 text-primary' : ''}
                `}
                onClick={() => !option.disabled && handleSelect(option.value)}
              >
                {option.label}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
};

// Option component for compatibility
const Option: FC<{ value: string; children: ReactNode; disabled?: boolean }> = ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  value,
  children,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  disabled
}) => {
  return children;
};

// Attach Option to Select
(Select as any).Option = Option;

export default Select;
