'use client';

import { useEffect, useEffectEvent, useMemo, useRef } from 'react';

import { useSocket } from './socket-context';

interface UseSocketListenerOptions {
  /**
   * Whether to automatically remove the listener when the component unmounts
   * @default true
   */
  autoCleanup?: boolean;

  /**
   * Whether the listener should be active
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook to listen to socket events with automatic cleanup
 *
 * @param event - The socket event name to listen to
 * @param handler - The event handler function
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * useSocketListener('message:new', (data) => {
 *
 * });
 *
 * // With options
 * useSocketListener('notification', handleNotification, {
 *   enabled: isLoggedIn,
 *   autoCleanup: true
 * });
 * ```
 */
export function useSocketListener<T = any>(
  event: string,
  handler: (data: T) => void,
  options: UseSocketListenerOptions = {}
) {
  const { socket, isConnected } = useSocket();
  const { autoCleanup = true, enabled = true } = options;

  const eventHandler = useEffectEvent((data: T) => {
    handler(data);
  });

  // Store stable reference for cleanup
  const handlerRef = useRef(eventHandler);
  handlerRef.current = eventHandler;

  useEffect(() => {
    if (!socket) return;

    const stableHandler = handlerRef.current;

    // Always remove existing listener first to prevent accumulation
    socket.off(event, stableHandler);

    if (isConnected && enabled) {
      socket.on(event, stableHandler);

      // Return cleanup function if autoCleanup is enabled
      return autoCleanup ? () => void socket.off(event, stableHandler) : undefined;
    }
  }, [socket, isConnected, event, enabled, autoCleanup]);

  // Manual cleanup function
  const removeListener = () => {
    if (socket) {
      socket.off(event, handlerRef.current);
    }
  };

  return { removeListener };
}

/**
 * Hook to listen to multiple socket events
 *
 * @param eventHandlers - Object mapping event names to handlers
 * @param options - Configuration options
 *
 * @example
 * ```tsx
 * useSocketListeners({
 *   'message:new': handleNewMessage,
 *   'user:online': handleUserOnline,
 *   'notification': handleNotification,
 * });
 * ```
 */
// eslint-disable-next-line space-before-function-paren
export function useSocketListeners<T extends Record<string, (data: any) => void>>(eventHandlers: T, options: UseSocketListenerOptions = {}) {
  const { socket, isConnected } = useSocket();
  const { autoCleanup = true, enabled = true } = options;

  // Store handlers in refs to avoid stale closures
  const handlersRef = useRef(eventHandlers);
  handlersRef.current = eventHandlers;

  // Track which events are registered
  const eventsKey = useMemo(() => Object.keys(eventHandlers).sort().join(','), [eventHandlers]);

  // Create stable event handler using useEffectEvent
  const handleEvent = useEffectEvent((event: string, data: any) => {
    const currentHandler = handlersRef.current[event];
    if (currentHandler) {
      currentHandler(data);
    }
  });

  // Store stable wrapper functions for each event
  type SocketHandler = (...args: any[]) => void;

  const wrappersRef = useRef<Map<string, SocketHandler>>(new Map());

  useEffect(() => {
    if (!socket) return;

    const events = Object.keys(handlersRef.current);

    // Remove all existing listeners first
    events.forEach(event => {
      const wrapper = wrappersRef.current.get(event);
      if (wrapper) {
        socket.off(event, wrapper);
      }
    });

    if (isConnected && enabled) {
      // Create and store stable wrapper functions for each event
      events.forEach(event => {
        const wrapper = (data: any) => handleEvent(event, data);
        wrappersRef.current.set(event, wrapper);
        socket.on(event, wrapper);
      });

      // Cleanup function
      return autoCleanup ? () => {
        events.forEach(event => {
          const wrapper = wrappersRef.current.get(event);
          if (wrapper) {
            socket.off(event, wrapper);
            wrappersRef.current.delete(event);
          }
        });
      } : undefined;
    }
    // Using eslint-disable comment since it's from useEffectEvent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, enabled, autoCleanup, eventsKey]);
}

/**
 * Hook for emitting socket events
 *
 * @example
 * ```tsx
 * const emit = useSocketEmit();
 *
 * const sendMessage = () => {
 *   emit('message:send', { text: 'Hello!', conversationId: '123' });
 * };
 * ```
 */
export function useSocketEmit() {
  const { emit } = useSocket();
  return emit;
}
