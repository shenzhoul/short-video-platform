# Socket System Documentation

This directory contains the refactored Socket.IO implementation with improved architecture, TypeScript support, and React hooks.

## Architecture Overview

The socket system is built around a React Context that provides:
- Automatic connection/disconnection based on authentication state
- Real-time connection status tracking
- Easy-to-use hooks for listening to events
- Automatic cleanup of event listeners

## Core Components

### 1. SocketProvider (`socket-context.tsx`)
The main context provider that manages the socket connection.

**Features:**
- Auto-connects when user is authenticated
- Auto-disconnects when user logs out
- Handles reconnection logic
- Provides connection status
- Handles authentication errors

### 2. Socket Listener Hooks (`use-socket-listener.tsx`)

#### `useSocketListener(event, handler, options)`
Listen to a single socket event with automatic cleanup.

```tsx
import { useSocketListener } from 'src/socket';

function MyComponent() {
  useSocketListener('message:new', (data) => {
    console.log('New message:', data);
  });

  return <div>Component content</div>;
}
```

#### `useSocketListeners(eventHandlers, options)`
Listen to multiple socket events at once.

```tsx
import { useSocketListeners } from 'src/socket';

function MyComponent() {
  useSocketListeners({
    'message:new': handleNewMessage,
    'user:online': handleUserOnline,
    'notification': handleNotification,
  });

  return <div>Component content</div>;
}
```

#### `useSocketEmit()`
Get the emit function for sending events.

```tsx
import { useSocketEmit } from 'src/socket';

function MyComponent() {
  const emit = useSocketEmit();

  const sendMessage = () => {
    emit('message:send', { text: 'Hello!', conversationId: '123' });
  };

  return <button onClick={sendMessage}>Send</button>;
}
```

### 3. Socket Status Components (`socket-status-indicator.tsx`)

#### `SocketStatusIndicator`
Visual indicator showing connection status.

```tsx
import { SocketStatusIndicator } from 'src/socket';

function App() {
  return (
    <div>
      <SocketStatusIndicator showText position="bottom-right" />
    </div>
  );
}
```

#### `SocketStatusDot`
Simple dot indicator for inline use.

```tsx
import { SocketStatusDot } from 'src/socket';

function Header() {
  return (
    <div className="flex items-center gap-2">
      <span>Connection</span>
      <SocketStatusDot />
    </div>
  );
}
```

## Usage Examples

### Basic Socket Connection
The socket automatically connects when the user is authenticated:

```tsx
import { useSocket } from 'src/socket';

function MyComponent() {
  const { isConnected, connectionStatus } = useSocket();

  return (
    <div>
      Status: {connectionStatus}
      {isConnected ? 'Connected' : 'Disconnected'}
    </div>
  );
}
```

### Real-time Messages
```tsx
import { useSocketListener } from 'src/socket';
import { useQueryClient } from '@tanstack/react-query';

function MessagesComponent() {
  const queryClient = useQueryClient();

  useSocketListener('message:new', (data) => {
    // Invalidate queries to refetch latest messages
    queryClient.invalidateQueries(['messages', data.conversationId]);
  });

  return <div>Messages will update in real-time</div>;
}
```

### Conditional Listeners
```tsx
import { useSocketListener } from 'src/socket';

function NotificationComponent({ userId }) {
  useSocketListener(
    'notification',
    (data) => {
      if (data.userId === userId) {
        showNotification(data.message);
      }
    },
    {
      enabled: !!userId, // Only listen when userId is available
    }
  );

  return <div>Notifications</div>;
}
```

## Migration from Legacy Socket

### Before (Legacy)
```tsx
import { Event } from 'src/socket';

function MyComponent() {
  return (
    <>
      <Event event="message:new" handler={handleNewMessage} />
      <div>Component content</div>
    </>
  );
}
```

### After (New)
```tsx
import { useSocketListener } from 'src/socket';

function MyComponent() {
  useSocketListener('message:new', handleNewMessage);

  return <div>Component content</div>;
}
```

## Connection States

- `disconnected`: Not connected to server
- `connecting`: Attempting to connect
- `connected`: Successfully connected and authenticated
- `reconnecting`: Attempting to reconnect after disconnection
- `error`: Connection failed

## Best Practices

1. **Use hooks instead of components**: The new hook-based approach is more performant and easier to use.

2. **Leverage automatic cleanup**: Event listeners are automatically removed when components unmount.

3. **Handle connection states**: Always check connection status before emitting events.

4. **Use conditional listeners**: Disable listeners when they're not needed using the `enabled` option.

5. **Batch related listeners**: Use `useSocketListeners` for multiple related events.

## Legacy Support

The old `Socket`, `Event`, and `SocketContext` components are still available for backward compatibility but are deprecated. Please migrate to the new hook-based approach.
