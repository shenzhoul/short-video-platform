'use client';

import { useSocket } from './socket-context';

interface SocketStatusIndicatorProps {
  /**
   * Whether to show the status text
   * @default false
   */
  showText?: boolean;

  /**
   * Custom className for styling
   */
  className?: string;

  /**
   * Position of the indicator
   * @default "bottom-right"
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Visual indicator showing the current socket connection status
 */
export function SocketStatusIndicator({
  showText = false,
  className = '',
  position = 'bottom-right'
}: SocketStatusIndicatorProps) {
  const { connectionStatus } = useSocket();

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
      case 'reconnecting':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      case 'disconnected':
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'error':
        return 'Connection Error';
      case 'disconnected':
      default:
        return 'Disconnected';
    }
  };

  const getPositionClasses = () => {
    switch (position) {
      case 'top-left':
        return 'top-4 left-4';
      case 'top-right':
        return 'top-4 right-4';
      case 'bottom-left':
        return 'bottom-4 left-4';
      case 'bottom-right':
      default:
        return 'bottom-4 right-4';
    }
  };

  return (
    <div className={`fixed ${getPositionClasses()} z-50 ${className}`}>
      <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-lg">
        <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        {showText ? (
          <span className="text-xs opacity-60 font-medium">
            {getStatusText()}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Simple dot indicator for inline use
 */
export function SocketStatusDot({ className = '' }: { className?: string }) {
  const { connectionStatus } = useSocket();

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
      case 'reconnecting':
        return 'bg-yellow-500 animate-pulse';
      case 'error':
        return 'bg-red-500';
      case 'disconnected':
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div
      className={`w-2 h-2 rounded-full ${getStatusColor()} ${className}`}
      title={connectionStatus}
    />
  );
}
