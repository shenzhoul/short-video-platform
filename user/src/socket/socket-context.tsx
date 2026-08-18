'use client';

import { getToken } from '@services/auth.service';
import { signOut, useSession } from 'next-auth/react';
import React, {
  createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState
} from 'react';
import { io, Socket as SocketIOClient } from 'socket.io-client';

interface SocketContextValue {
  socket: SocketIOClient | null;
  isConnected: boolean;
  connectionStatus: SocketConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  emit: (event: string, data?: any) => void;
}

export type SocketConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  connectionStatus: 'disconnected',
  connect: () => { },
  disconnect: () => { },
  emit: () => { }
});

interface SocketProviderProps {
  children: React.ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const { data: session, status: sessionStatus } = useSession();
  const socketRef = useRef<SocketIOClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<SocketConnectionStatus>('disconnected');
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>(null);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      // Remove all listeners before disconnecting to prevent memory leaks
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setConnectionStatus('disconnected');
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
  }, []);

  const authenticateSocket = useCallback(() => {
    const token = getToken();
    if (socketRef.current && token) {
      socketRef.current.emit('auth/login', { token });
    }
  }, []);

  const connect = useCallback(() => {
    // Prevent multiple connections - check if socket exists and is connected
    if (socketRef.current) {
      if (socketRef.current.connected) {

        return;
      }
      // If socket exists but not connected, try to reconnect
      if (!socketRef.current.connected) {

        socketRef.current.connect();
        return;
      }
    }

    const token = getToken();
    if (!token) {

      return;
    }

    setConnectionStatus('connecting');

    /**
     * Socket.io Connection Configuration
     *
     * The socket connection uses the proxy setup for seamless communication:
     * - By default: connects to the same domain (uses proxy setup)
     * - Requests to /socket.io/* are proxied to the API server via Next.js rewrites
     * - This avoids CORS issues and maintains consistent URLs across environments
     * - Only uses NEXT_PUBLIC_API_ENDPOINT if explicitly provided
     */
    const socketUrl = (process.env.NEXT_PUBLIC_API_ENDPOINT && process.env.NEXT_PUBLIC_API_ENDPOINT.trim() !== '')
      ? process.env.NEXT_PUBLIC_API_ENDPOINT
      : window.location.origin;

    const socketOptions = {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: true,
      transports: ['websocket', 'polling'],
      query: { token },
      // Use the proxy path for socket.io connections
      // This will be automatically proxied to the API server
      path: '/socket.io/'
    };

    socketRef.current = io(socketUrl, socketOptions);

    // Remove any existing listeners to prevent accumulation
    socketRef.current.removeAllListeners();

    // Connection event handlers
    socketRef.current.on('connect', () => {

      setIsConnected(true);
      setConnectionStatus('connected');
      authenticateSocket();
    });

    socketRef.current.on('disconnect', (reason) => {

      setIsConnected(false);
      setConnectionStatus('disconnected');

      // If disconnected due to auth issues, sign out user
      if (reason === 'io server disconnect') {

        signOut();
      }
    });

    socketRef.current.on('connect_error', (_error) => {
      setConnectionStatus('error');

    });

    socketRef.current.on('reconnect', () => {
      setIsConnected(true);
      setConnectionStatus('connected');
      authenticateSocket();
    });

    socketRef.current.on('reconnecting', () => {
      setConnectionStatus('reconnecting');
    });

    socketRef.current.on('reconnect_failed', () => {
      setConnectionStatus('error');
    });

    // Handle authentication errors
    socketRef.current.on('auth/error', () => {

      signOut();
    });
  }, [authenticateSocket]);

  const emit = useCallback((event: string, data?: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
    }
  }, []);

  // Use useEffectEvent to call connect/disconnect without adding them to deps
  const handleConnectionChange = useEffectEvent(() => {
    if (sessionStatus === 'authenticated' && session?.user) {
      connect();
    } else if (sessionStatus === 'unauthenticated') {
      disconnect();
    }
  });

  // Auto-connect when user is authenticated
  useEffect(() => {
    handleConnectionChange();
    // handleConnectionChange is from useEffectEvent and shouldn't be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?._id, sessionStatus]);

  // Handle page visibility to prevent unnecessary disconnections
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && sessionStatus === 'authenticated') {
        // Page became visible, ensure socket is connected
        if (socketRef.current && !socketRef.current.connected) {

          socketRef.current.connect();
        }
      }
      // Don't disconnect when page becomes hidden - let socket.io handle it
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionStatus]);

  // Cleanup on unmount only
  useEffect(() => () => {
    if (socketRef.current) {

      // Remove all listeners before disconnecting
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []); // No dependencies - only run on mount/unmount

  const contextValue: SocketContextValue = {
    socket: socketRef.current,
    isConnected,
    connectionStatus,
    connect,
    disconnect,
    emit
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};
