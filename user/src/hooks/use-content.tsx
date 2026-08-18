import { useMutation } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useState } from 'react';
import { toast } from 'react-toastify';
import { IPost } from 'src/interfaces';
import { findOne } from 'src/services/post.service';

interface UsePostDetailsOptions {
  loadDetails?: boolean;
}

interface UsePostDetailsReturn {
  post: IPost;
  refresh: () => void;
  isLoading: boolean;
  isError: boolean;
}

export function usePostDetails(
  initialPost: IPost,
  options: UsePostDetailsOptions = {}
): UsePostDetailsReturn {
  const { loadDetails = false } = options;

  const [post, setPost] = useState<IPost>(initialPost);

  // Mutation to refetch post data
  const refetchPostMutation = useMutation({
    mutationFn: () => findOne(post._id),
    onSuccess: (data: any) => {
      setPost(data.data);
    },
    onError: () => {
      toast.error('Failed to update post data');
    }
  });

  // Sync post with prop changes
  useEffect(() => {
    setPost(initialPost);
  }, [initialPost]);

  // Event function for loading details (stable reference)
  const loadDetailsEvent = useEffectEvent(() => {
    if (loadDetails) {
      refetchPostMutation.mutate();
    }
  });

  // Optionally load details on mount
  useEffect(() => {
    loadDetailsEvent();
    // loadDetailsEvent is stable from useEffectEvent, no need to include in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDetails]);

  const refresh = () => {
    refetchPostMutation.mutate();
  };

  return {
    post,
    refresh,
    isLoading: refetchPostMutation.isPending,
    isError: refetchPostMutation.isError
  };
}
