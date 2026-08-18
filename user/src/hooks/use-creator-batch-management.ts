'use client';

import { IPost } from '@interfaces/post';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface UseCreatorBatchManagementOptions {
  posts: IPost[];
  execute: (ids: string[]) => Promise<string[]>;
}

export function useCreatorBatchManagement({
  posts,
  execute
}: UseCreatorBatchManagementOptions) {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const postIds = useMemo(() => posts.map((post) => post._id), [posts]);
  const allSelected = postIds.length > 0 && postIds.every((id) => selectedIds.has(id));

  useEffect(() => {
    const availableIds = new Set(postIds);
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [postIds]);

  const toggleActive = useCallback(() => {
    setActive((current) => !current);
    setSelectedIds(new Set());
  }, []);

  const reset = useCallback(() => {
    setActive(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((postId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((current) => (
      postIds.length > 0 && postIds.every((id) => current.has(id))
        ? new Set()
        : new Set(postIds)
    ));
  }, [postIds]);

  const executeSelected = useCallback(async () => {
    const completedIds = await execute([...selectedIds]);
    if (!completedIds.length) return;
    const completedIdSet = new Set(completedIds);
    setSelectedIds((current) => new Set([...current].filter((id) => !completedIdSet.has(id))));
  }, [execute, selectedIds]);

  return {
    active,
    selectedCount: selectedIds.size,
    allSelected,
    isSelected: (postId: string) => selectedIds.has(postId),
    toggleActive,
    toggleSelection,
    toggleSelectAll,
    executeSelected,
    reset
  };
}
