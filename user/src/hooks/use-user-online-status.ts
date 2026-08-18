'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSocketListener } from 'src/socket';

interface OnlineStatusPayload {
  userId: string;
  id: string;
  online: boolean;
}

interface UseUserOnlineStatusOptions {
  userId: string;
  initialOnlineStatus?: boolean;
}

interface UseUserOnlineStatusReturn {
  isOnline: boolean;
  setIsOnline: (status: boolean) => void;
}

/**
 * Custom hook for managing user online status via socket events
 *
 * This hook listens to the 'online' socket event emitted by the backend
 * when users connect/disconnect, and updates the online status accordingly
 * if the userId matches the provided userId.
 *
 * @param options Configuration options
 * @param options.userId - The user ID to track online status for
 * @param options.initialOnlineStatus - Initial online status (default: false)
 * @returns Object containing isOnline state and setIsOnline function
 *
 * @example
 * ```tsx
 * const { isOnline } = useUserOnlineStatus({
 *   userId: '123',
 *   initialOnlineStatus: true
 * });
 *
 * return <div>{isOnline ? 'Online' : 'Offline'}</div>;
 * ```
 */
export function useUserOnlineStatus({
  userId,
  initialOnlineStatus = false
}: UseUserOnlineStatusOptions): UseUserOnlineStatusReturn {
  const [isOnline, setIsOnline] = useState(initialOnlineStatus);

  useEffect(() => {
    setIsOnline(initialOnlineStatus);
  }, [initialOnlineStatus, userId]);

  // Handle online status updates from socket
  const handleOnlineStatusUpdate = useCallback(
    (data: OnlineStatusPayload) => {
      // Only update if the event is for this specific user
      if (data.userId === userId || data.id === userId) {
        setIsOnline(data.online);
      }
    },
    [userId]
  );

  // Listen to 'online' socket events
  useSocketListener<OnlineStatusPayload>('online', handleOnlineStatusUpdate);

  return {
    isOnline,
    setIsOnline
  };
}
