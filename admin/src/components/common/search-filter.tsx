/* eslint-disable react/require-default-props */
'use client'

import {
  Col, DatePicker,
  Input, Row, Select
} from 'antd';
import { debounce } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';

const { RangePicker } = DatePicker;

interface FilterOption {
  key: string;
  text?: string;
}

interface FilterState {
  q?: string;
  creatorId?: string;
  categoryId?: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
  category?: string;
  role?: string;
  type?: string;
  sourceType?: string;
}

interface SearchFilterProps {
  keyword?: boolean;
  onSubmit?: (filters: FilterState) => void;
  statuses?: FilterOption[];
  categories?: FilterOption[];
  roles?: FilterOption[];
  sourceType?: FilterOption[];
  types?: FilterOption[];
  dateRange?: boolean;
  initialValues?: FilterState;
}

export function SearchFilter({
  keyword = false,
  onSubmit,
  statuses = [],
  categories = [],
  roles = [],
  sourceType = [],
  types = [],
  dateRange = false,
  initialValues = {}
}: SearchFilterProps) {
  const [filterState, setFilterState] = useState<FilterState>(initialValues);
  const onSubmitRef = useRef(onSubmit);

  // Keep ref updated
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const debouncedInputChangeRef = useRef<((q: string) => void) | null>(null);

  // Initialize debounced function once
  if (!debouncedInputChangeRef.current) {
    debouncedInputChangeRef.current = debounce((q: string) => {
      setFilterState((prev) => ({ ...prev, q }));
    }, 500);
  }

  // Trigger onSubmit when filterState changes
  useEffect(() => {
    if (Object.keys(filterState).length > 0) {
      onSubmitRef.current?.(filterState);
    }
  }, [filterState]);

  // Handle state change without calling onSubmit (it's handled by useEffect above)
  const handleFilterChange = useCallback((newState: Partial<FilterState>) => {
    setFilterState((prev) => ({ ...prev, ...newState }));
  }, []);

  return (
    <Row gutter={[10, 10]}>
      {keyword ? (
        <Col lg={6} md={8} xs={24}>
          <Input
            allowClear
            placeholder="Enter keyword"
            defaultValue={initialValues.q}
            onChange={(evt) => debouncedInputChangeRef.current?.(evt.target.value)}
            onPressEnter={() => onSubmit?.(filterState)}
          />
        </Col>
      ) : null}

      {dateRange ? (
        <Col lg={6} md={8} xs={24}>
          <RangePicker
            style={{ width: '100%' }}
            onChange={(_, dateStrings) => {
              handleFilterChange({
                fromDate: dateStrings && dateStrings[0] || '',
                toDate: dateStrings && dateStrings[1] || ''
              });
            }}
          />
        </Col>
      ) : null}

      {statuses.length > 0 && (
        <Col lg={6} md={8} xs={24}>
          <Select
            onChange={(val) => handleFilterChange({ status: val })}
            style={{ width: '100%' }}
            placeholder="Select status"
            value={filterState.status ?? undefined}
          >
            {statuses.map((s) => (
              <Select.Option key={s.key} value={s.key}>
                {s.text || s.key}
              </Select.Option>
            ))}
          </Select>
        </Col>
      )}

      {categories.length > 0 && (
        <Col lg={6} md={8} xs={24}>
          <Select
            onChange={(val) => handleFilterChange({ category: val })}
            style={{ width: '100%' }}
            placeholder="Select category"
            value={filterState.category || ''}
          >
            {categories.map((c) => (
              <Select.Option key={c.key} value={c.key}>
                {c.text || c.key}
              </Select.Option>
            ))}
          </Select>
        </Col>
      )}

      {roles.length > 0 && (
        <Col lg={6} md={8} xs={24}>
          <Select
            onChange={(val) => handleFilterChange({ role: val })}
            style={{ width: '100%' }}
            placeholder="Select role"
            value={filterState.role || ''}
          >
            {roles.map((r) => (
              <Select.Option key={r.key} value={r.key}>
                {r.text || r.key}
              </Select.Option>
            ))}
          </Select>
        </Col>
      )}

      {types.length > 0 && (
        <Col lg={6} md={8} xs={24}>
          <Select
            onChange={(val) => handleFilterChange({ type: val })}
            style={{ width: '100%' }}
            placeholder="Select type"
            value={filterState.type || ''}
          >
            <Select.Option key="" value="">All</Select.Option>
            {types.map((s) => (
              <Select.Option key={s.key} value={s.key}>
                {s.text || s.key}
              </Select.Option>
            ))}
          </Select>
        </Col>
      )}

      {sourceType.length > 0 && (
        <Col lg={6} md={8} xs={24}>
          <Select
            onChange={(val) => handleFilterChange({ sourceType: val })}
            style={{ width: '100%' }}
            placeholder="Select type"
            value={filterState.sourceType || ''}
          >
            <Select.Option key="" value="">All</Select.Option>
            {sourceType.map((s) => (
              <Select.Option key={s.key} value={s.key}>
                {s.text || s.key}
              </Select.Option>
            ))}
          </Select>
        </Col>
      )}
    </Row>
  );
}
