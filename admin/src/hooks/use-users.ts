/**
 * Users Hook with Infinite Scroll Support
 *
 * Manages users for admin panel with CRUD operations and cursor-based pagination.
 * Provides loading states, error handling, optimistic updates, and infinite scroll functionality.
 * Uses cursor-based pagination for better performance with large user datasets.
 * Includes admin permissions for managing users and accessing detailed information.
 *
 * @example
 * ```tsx
 * const {
 *   users,
 *   loading,
 *   updateUser,
 *   deleteUser,
 *   loadMore,
 *   hasMore
 * } = useUsers({
 *   status: 'active',
 *   isAdmin: false,
 *   keyword: 'search term',
 *   limit: 20
 * });
 *
 * // Update a user
 * await updateUser(user, { status: 'inactive' });
 *
 * // Delete a user
 * await deleteUser(user);
 *
 * // Load more users with infinite scroll
 * if (hasMore) await loadMore();
 * ```
 */

import { useCursorPaginatedResource } from '@hooks/use-cursor-paginated-resource';
import { CursorInfo, normalizeCursor, PaginationInfo } from '@lib/cursor';
import { appMessage as message } from '@lib/antd-message';
import { useCallback, useMemo, useState } from 'react';
import { userService } from 'src/services/user.service';

import { IUser } from '../interfaces/user';

interface UseUsersProps {
  keyword?: string;
  status?: string;
  isAdmin?: boolean;
  limit?: number;
  page?: number;
  initialCursor?: CursorInfo | null;
}

interface UseUsersReturn {
  users: IUser[];
  loading: boolean;
  submitting: boolean;
  total: number;
  hasMore: boolean;
  nextCursor: CursorInfo | null;
  paginationInfo?: PaginationInfo;
  updateUser: (user: IUser, data: any) => Promise<void>;
  deleteUser: (user: IUser) => Promise<void>;
  loadMore: () => Promise<void>;
  onCursorNext: (cursor: CursorInfo) => void;
  refetch: () => Promise<void>;
}

export const useUsers = ({
  keyword,
  status,
  isAdmin,
  limit = 12,
  page = 1,
  initialCursor = null
}: UseUsersProps): UseUsersReturn => {
  const [submitting, setSubmitting] = useState(false);
  const filters = useMemo(() => ({
    ...(keyword ? { q: keyword } : {}),
    ...(status ? { status } : {}),
    ...(typeof isAdmin === 'boolean' ? { isAdmin } : {})
  }), [keyword, status, isAdmin]);

  const fetchUsers = useCallback(async (query: Record<string, any>) => {
    const response = await userService.search(query);
    const data = response.data ?? {};
    return {
      data: data.data ?? [],
      total: data.total,
      hasMore: data.hasMore,
      nextCursor: data.nextCursor,
      paginationInfo: data.paginationInfo
    };
  }, []);

  const getUserCursor = useCallback((user: IUser | undefined): CursorInfo | null => {
    if (!user?._id) return null;
    return normalizeCursor({ id: user._id });
  }, []);

  const {
    items: users,
    setItems: setUsers,
    setTotal,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext,
    loadMore,
    refetch
  } = useCursorPaginatedResource<IUser>({
    page,
    limit,
    filters,
    initialCursor,
    fetcher: fetchUsers,
    getCursorFromItem: getUserCursor,
    resourceName: 'users'
  });

  // Update user (admin)
  const updateUser = useCallback(async (user: IUser, data: any) => {
    try {
      setSubmitting(true);

      const response = await userService.update(user._id, data);

      // Update user in list
      setUsers(prev => prev.map(u =>
        u._id === user._id ? { ...u, ...response.data } : u
      ));
      message.success('User updated successfully');
    } catch (error: any) {
      message.error(error?.message || 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Delete user (admin)
  const deleteUser = useCallback(async (user: IUser) => {
    try {
      await userService.delete(user._id);

      // Remove user from list
      setUsers(prev => prev.filter(u => u._id !== user._id));
      setTotal(prev => Math.max(prev - 1, 0));
      message.success('User deleted successfully');
    } catch (error: any) {
      message.error(error?.message || 'Failed to delete user');
    }
  }, []);

  return {
    users,
    loading,
    submitting,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    updateUser,
    deleteUser,
    loadMore,
    onCursorNext,
    refetch
  };
};
