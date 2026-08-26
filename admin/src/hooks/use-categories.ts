/**
 * Post categories for the admin catalogue screen.
 *
 * The catalogue is a short, admin-curated list, so the API pages it by offset and reports a total —
 * there is no cursor path to fall back to and none is needed.
 */

'use client';

import { toast } from '@douyin-clone/shared-toast';
import { categoryService } from '@services/category.service';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ICategory } from 'src/interfaces';

interface UseCategoriesProps {
  q?: string;
  status?: string;
  sortBy?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  page?: number;
}

interface UseCategoriesReturn {
  categories: ICategory[];
  loading: boolean;
  total: number;
  refetch: () => Promise<void>;
  disableCategory: (category: ICategory) => Promise<void>;
}

export function useCategories({
  q = '',
  status = '',
  sortBy = 'ordering',
  sort = 'asc',
  limit = 25,
  page = 1
}: UseCategoriesProps = {}): UseCategoriesReturn {
  const [categories, setCategories] = useState<ICategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  // Filter changes arrive faster than responses come back; only the newest request may write state,
  // otherwise a slower earlier one lands last and shows the wrong filter's results.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const response = await categoryService.search({
        limit,
        offset: (page - 1) * limit,
        sortBy,
        sort,
        ...(q ? { q } : {}),
        ...(status ? { status } : {})
      });
      if (requestId !== requestIdRef.current) return;

      const payload = response?.data || {};
      setCategories(payload.data || []);
      setTotal(payload.total || 0);
    } catch (error: any) {
      if (requestId !== requestIdRef.current) return;
      toast.error(error?.message || 'Failed to load categories, please try again!');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [limit, page, q, sort, sortBy, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const disableCategory = useCallback(async (category: ICategory) => {
    try {
      await categoryService.disable(category._id);
      toast.success(`"${category.name}" is no longer offered to creators`);
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to disable this category, please try again!');
    }
  }, [load]);

  return {
    categories,
    loading,
    total,
    refetch: load,
    disableCategory
  };
}

export default useCategories;
