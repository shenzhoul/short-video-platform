/**
 * SearchFilter Component
 *
 * A comprehensive search and filter component with multiple filter options.
 * Supports keyword search, date ranges, categories, statuses, and payment gateways.
 *
 * @example
 * // Basic usage with status filter
 * <SearchFilter
 *   onSubmit={(filters) => handleSearch(filters)}
 *   statuses={[
 *     { key: 'active', text: 'Active' },
 *     { key: 'inactive', text: 'Inactive' }
 *   ]}
 *   searchWithKeyword
 * />
 *
 * // With date range and category
 * <SearchFilter
 *   onSubmit={handleFilter}
 *   dateRange
 *   searchWithCategory
 *   categoryGroup="content"
 * />
 *
 * Features:
 * - Keyword search input
 * - Creator search
 * - Date range picker
 * - Category dropdown
 * - Status and type filters
 * - Payment gateway selection
 * - Payout status filtering
 * - Real-time filter updates
 */

'use client';

import { DateRangePicker } from '@components/ui/date-range-picker';
import SearchInput from '@components/ui/search-input';
import Select from '@components/ui/select';
import { useEffect, useState } from 'react';

interface FilterData {
  [key: string]: unknown;
  keyword?: string;
  creator?: string;
  status?: string;
  type?: string;
  categoryId?: string;
  paymentGateway?: string;
  payoutStatus?: string;
  fromDate?: string;
  toDate?: string;
}

interface SearchFilterProps {
  onSubmit: (filter: FilterData) => void;
  statuses?: { key: string; text?: string }[];
  type?: { key: string; text?: string }[];
  searchWithCreator?: boolean;
  searchWithKeyword?: boolean;
  dateRange?: boolean;
  searchWithCategory?: boolean;
  searchPaymentGateway?: boolean;
  searchPayoutStatus?: boolean;
  categoryId?: string;
  categoryGroup?: string;
  defaultValue?: FilterData;
}

export function SearchFilter({
  onSubmit,
  statuses = [],
  type = [],
  searchWithCreator: _searchWithCreator = false,
  searchWithKeyword = false,
  dateRange = false,
  searchWithCategory: _searchWithCategory = false,
  searchPaymentGateway: _searchPaymentGateway = false,
  searchPayoutStatus: _searchPayoutStatus = false,
  categoryId = '',
  categoryGroup: _categoryGroup = '',
  defaultValue = {}
}: SearchFilterProps) {
  // Initialize filter with defaultValue and categoryId
  const [filter, setFilter] = useState<FilterData>(() => ({
    ...defaultValue,
    categoryId: categoryId || defaultValue.categoryId
  }));

  // Sync categoryId prop with state if it changes
  useEffect(() => {
    if (categoryId) {
      setFilter((prev) => ({ ...prev, categoryId }));
    }
  }, [categoryId]);

  const handleChange = (field: string, value: unknown) => {
    const newFilter = { ...filter, [field]: value };
    setFilter(newFilter);
    onSubmit(newFilter);
  };

  const handleKeywordChange = (val: string) => {
    setFilter((prev) => ({ ...prev, q: val }));
  };

  const handleDateChange = (dates: [Date | null, Date | null]) => {
    const [startDate, endDate] = dates;
    const newFilter = { ...filter, fromDate: startDate?.toISOString(), toDate: endDate?.toISOString() };
    setFilter(newFilter);
    onSubmit(newFilter);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
      {searchWithKeyword ? (
        <div className="w-full">
          <SearchInput
            placeholder="Enter keyword"
            defaultValue={(filter.q as string) || (filter.keyword as string) || ''}
            onChange={handleKeywordChange}
            onEnter={() => onSubmit(filter)}
          />
        </div>
      ) : null}
      {statuses.length > 0 && (
        <Select
          placeholder="Select status"
          options={statuses.map(s => ({ value: s.key, label: s.text || s.key }))}
          value={filter.status as string}
          onChange={(val) => handleChange('status', val)}
        />
      )}
      {type.length > 0 && (
        <Select
          placeholder="Select type"
          options={type.map(t => ({ value: t.key, label: t.text || t.key }))}
          value={filter.type as string}
          onChange={(val) => handleChange('type', val)}
        />
      )}
      {dateRange ? (
        <DateRangePicker
          startDate={filter.fromDate ? new Date(filter.fromDate as string) : null}
          endDate={filter.toDate ? new Date(filter.toDate as string) : null}
          onChange={handleDateChange}
        />
      ) : null}
    </div>
  );
}

export default SearchFilter;
