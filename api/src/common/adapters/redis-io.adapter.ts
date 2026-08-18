/* eslint-disable no-await-in-loop */
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { Cluster, RedisOptions } from 'ioredis';

/**
 * Redis configuration interface for Socket.IO adapter
 * Extends ioredis RedisOptions with additional Socket.IO specific settings
 */
export interface RedisIoConfig extends RedisOptions {
  /** Redis server type - 'single' for standalone, 'cluster' for Redis cluster */
  type?: 'single' | 'cluster';
  /** Cluster nodes configuration for Redis cluster mode */
  nodes?: Array<{ host: string; port: number }>;
  /** Connection retry configuration */
  retry?: {
    /** Maximum number of connection retry attempts */
    maxAttempts?: number;
    /** Initial delay between retry attempts in milliseconds */
    initialDelay?: number;
    /** Maximum delay between retry attempts in milliseconds */
    maxDelay?: number;
    /** Exponential backoff multiplier */
    backoffMultiplier?: number;
  };
  /** Health check configuration */
  healthCheck?: {
    /** Enable periodic health checks */
    enabled?: boolean;
    /** Health check interval in milliseconds */
    interval?: number;
    /** Health check timeout in milliseconds */
    timeout?: number;
  };
  /** Monitoring and logging configuration */
  monitoring?: {
    /** Enable connection event logging */
    logEvents?: boolean;
    /** Enable performance metrics */
    enableMetrics?: boolean;
  };
}

/**
 * Connection health status interface
 */
export interface ConnectionHealth {
  /** Overall health status */
  healthy: boolean;
  /** Publisher client status */
  pubClient: {
    connected: boolean;
    lastPing?: number;
    error?: string;
  };
  /** Subscriber client status */
  subClient: {
    connected: boolean;
    lastPing?: number;
    error?: string;
  };
  /** Last health check timestamp */
  lastCheck: Date;
}

/**
 * Enhanced Redis-backed Socket.IO adapter for scaling WebSocket connections across multiple server instances
 *
 * Features:
 * - Comprehensive error handling and retry logic
 * - Connection health monitoring and automatic recovery
 * - Support for both single Redis instance and cluster configurations
 * - Graceful shutdown with proper cleanup
 * - Detailed logging and monitoring capabilities
 * - Production-ready configuration validation
 * - TLS/SSL support for secure connections
 * - Connection pooling optimization
 *
 * Enables real-time communication features like chat, notifications, and live streaming
 * with high availability and horizontal scaling support.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);

  private adapterConstructor: ReturnType<typeof createAdapter>;

  private pubClient: Redis | Cluster;

  private subClient: Redis | Cluster;

  private config: RedisIoConfig;

  private healthCheckInterval: ReturnType<typeof setInterval>;

  private isShuttingDown = false;

  private connectionHealth: ConnectionHealth;

  /**
   * Establishes Redis connection for Socket.IO adapter with comprehensive error handling
   *
   * @param redisConfig - Redis configuration object with connection details and options
   * @throws Error if configuration validation fails or connection cannot be established
   *
   * @example
   * ```typescript
   * const adapter = new RedisIoAdapter(app);
   * await adapter.connectToRedis({
   *   host: 'localhost',
   *   port: 6379,
   *   password: 'secure-password',
   *   retry: { maxAttempts: 5, initialDelay: 1000 },
   *   healthCheck: { enabled: true, interval: 30000 }
   * });
   * ```
   */
  async connectToRedis(redisConfig: RedisIoConfig): Promise<void> {
    try {
      // Validate and normalize configuration
      this.config = this.validateAndNormalizeConfig(redisConfig);

      // Initialize connection health object early to prevent warnings during startup
      this.connectionHealth = {
        healthy: false,
        pubClient: { connected: false },
        subClient: { connected: false },
        lastCheck: new Date()
      };

      // Create Redis clients based on configuration type
      if (this.config.type === 'cluster') {
        await this.createClusterClients();
      } else {
        await this.createSingleClients();
      }

      // Set up connection event handlers
      this.setupConnectionEventHandlers();

      // Wait for both clients to be ready
      await this.waitForClientsReady();

      // Update connection health after successful connection
      this.updateConnectionHealth('pubClient', { connected: true });
      this.updateConnectionHealth('subClient', { connected: true });

      // Create Socket.IO Redis adapter
      this.adapterConstructor = createAdapter(this.pubClient, this.subClient);

      // Initialize health monitoring if enabled
      if (this.config.healthCheck?.enabled) {
        this.initializeHealthMonitoring();
      }
    } catch (error) {
      this.logger.error('Failed to initialize Redis Socket.IO adapter', {
        error: error.message,
        stack: error.stack
      });

      // Clean up any partially created connections
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Gets current connection health status
   */
  public getConnectionHealth(): ConnectionHealth {
    return this.connectionHealth;
  }

  /**
   * Checks if the adapter is healthy and ready to handle connections
   */
  public isHealthy(): boolean {
    return this.connectionHealth?.healthy || false;
  }

  /**
   * Creates Socket.IO server instance with Redis adapter for multi-instance scaling
   *
   * @param port - Port number for the Socket.IO server
   * @param options - Additional Socket.IO server options
   * @returns Configured Socket.IO server instance with Redis adapter
   * @throws Error if adapter is not properly initialized
   */
  createIOServer(port: number, options?: any): any {
    if (!this.adapterConstructor) {
      throw new Error('Redis adapter not initialized. Call connectToRedis() first.');
    }

    if (!this.isHealthy()) {
      this.logger.warn('Creating Socket.IO server with unhealthy Redis connections', {
        connectionHealth: this.connectionHealth
      });
    }

    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);

    // Increase maxListeners for the Socket.IO server to prevent memory leak warnings
    server.setMaxListeners(50);

    // Set maxListeners for new socket connections
    server.on('connection', (socket) => {
      socket.setMaxListeners(50);

      // Log when we have high listener counts for debugging
      // const currentListenerCount = socket.listenerCount('disconnect');
      // if (currentListenerCount > 5) {
      //   this.logger.warn(`High disconnect listener count detected: ${currentListenerCount}`, {
      //     socketId: socket.id,
      //     listeners: socket.eventNames()
      //   });
      // }
    });

    return server;
  }

  /**
   * Gracefully shuts down the Redis adapter with proper cleanup
   *
   * This method should be called during application shutdown to ensure
   * all Redis connections are properly closed and resources are cleaned up.
   *
   * @param timeout - Maximum time to wait for graceful shutdown in milliseconds
   * @returns Promise that resolves when shutdown is complete
   */
  public async shutdown(timeout: number = 10000): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Graceful shutdown with timeout
      await Promise.race([
        this.cleanup(),
        // eslint-disable-next-line no-promise-executor-return
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Shutdown timeout after ${timeout}ms`)), timeout))
      ]);
    } catch (error) {
      this.logger.error('Error during Redis adapter shutdown', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Reconnects Redis clients in case of connection failure
   *
   * This method can be called manually to attempt reconnection
   * or automatically triggered by connection monitoring.
   */
  public async reconnect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Cannot reconnect during shutdown');
    }

    try {
      // Clean up existing connections
      await this.cleanup();

      // Re-establish connections
      await this.connectToRedis(this.config);
    } catch (error) {
      this.logger.error('Failed to reconnect Redis clients', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Gets Redis adapter statistics and connection information
   */
  public getStats(): {
    config: {
      type?: string;
      host?: string;
      port?: number;
      db?: number;
      tlsEnabled: boolean;
    };
    health: ConnectionHealth;
    clients: {
      publisher: { status: string; uptime?: number };
      subscriber: { status: string; uptime?: number };
    };
    adapter: { initialized: boolean };
  } {
    return {
      config: {
        type: this.config?.type,
        host: this.config?.host,
        port: this.config?.port,
        db: this.config?.db,
        tlsEnabled: !!this.config?.tls
      },
      health: this.connectionHealth,
      clients: {
        publisher: {
          status: this.pubClient?.status || 'not_initialized',
          uptime: this.connectionHealth?.pubClient?.lastPing
            ? Date.now() - this.connectionHealth.pubClient.lastPing : undefined
        },
        subscriber: {
          status: this.subClient?.status || 'not_initialized',
          uptime: this.connectionHealth?.subClient?.lastPing
            ? Date.now() - this.connectionHealth.subClient.lastPing : undefined
        }
      },
      adapter: {
        initialized: !!this.adapterConstructor
      }
    };
  }

  /**
   * Validates and normalizes Redis configuration with sensible defaults
   * Supports both flat config and nested config with 'options' property
   *
   * @param config - Raw Redis configuration (can be flat or nested with 'options')
   * @returns Normalized configuration with defaults applied
   * @throws Error if required configuration is missing or invalid
   */
  private validateAndNormalizeConfig(config: any): RedisIoConfig {
    if (!config) {
      throw new Error('Redis configuration is required');
    }

    // Handle nested configuration structure (config.type + config.options)
    let flatConfig: any;
    if (config.options && typeof config.options === 'object') {
      // Nested structure: { type: 'single', options: { host, port, ... } }
      flatConfig = {
        ...config.options,
        type: config.type || config.options.type || 'single'
      };
    } else {
      // Flat structure: { type: 'single', host, port, ... }
      flatConfig = { ...config };
    }

    // Determine Redis mode based on configuration
    const redisType = flatConfig.type || 'single';

    // For cluster mode, check if we have cluster-specific environment variables
    let isClusterMode = redisType === 'cluster';

    // Auto-detect cluster mode if nodes are provided or cluster env vars exist
    if (!isClusterMode && (flatConfig.nodes || process.env.REDIS_CLUSTER_NODES)) {
      isClusterMode = true;
    }

    // Parse cluster nodes if provided as environment variable
    let clusterNodes = flatConfig.nodes;
    if (isClusterMode && !clusterNodes && process.env.REDIS_CLUSTER_NODES) {
      try {
        // Parse comma-separated cluster nodes: "host1:port1,host2:port2,host3:port3"
        clusterNodes = process.env.REDIS_CLUSTER_NODES.split(',').map((node) => {
          const [host, port] = node.trim().split(':');
          return { host, port: parseInt(port, 10) || 6379 };
        });
      } catch {
        throw new Error(`Invalid REDIS_CLUSTER_NODES format: ${process.env.REDIS_CLUSTER_NODES}`);
      }
    }

    // Set defaults for missing configuration
    const normalizedConfig: RedisIoConfig = {
      ...flatConfig,
      type: isClusterMode ? 'cluster' : 'single',
      nodes: clusterNodes,
      maxRetriesPerRequest: flatConfig.maxRetriesPerRequest || 3,
      connectTimeout: flatConfig.connectTimeout || 10000,
      commandTimeout: flatConfig.commandTimeout || 5000,
      lazyConnect: flatConfig.lazyConnect === true, // Default to false for immediate connection
      keepAlive: flatConfig.keepAlive || 30000, // Default to 30 seconds
      retry: {
        maxAttempts: flatConfig.retry?.maxAttempts || 5,
        initialDelay: flatConfig.retry?.initialDelay || 1000,
        maxDelay: flatConfig.retry?.maxDelay || 10000,
        backoffMultiplier: flatConfig.retry?.backoffMultiplier || 2,
        ...flatConfig.retry
      },
      healthCheck: {
        enabled: flatConfig.healthCheck?.enabled !== false, // Default to true
        interval: flatConfig.healthCheck?.interval || 30000, // 30 seconds
        timeout: flatConfig.healthCheck?.timeout || 5000, // 5 seconds
        ...flatConfig.healthCheck
      },
      monitoring: {
        logEvents: flatConfig.monitoring?.logEvents !== false, // Default to true
        enableMetrics: flatConfig.monitoring?.enableMetrics !== false, // Default to true
        ...flatConfig.monitoring
      }
    };

    // Validate configuration based on mode
    if (normalizedConfig.type === 'cluster') {
      if (!normalizedConfig.nodes || normalizedConfig.nodes.length === 0) {
        throw new Error('Cluster nodes configuration is required for cluster mode. Set REDIS_CLUSTER_NODES or provide nodes array.');
      }
    } else {
      // Validate single instance configuration
      if (!normalizedConfig.host) {
        throw new Error('Redis host is required for single instance mode. Set REDIS_HOST environment variable.');
      }
      if (!normalizedConfig.port) {
        throw new Error('Redis port is required for single instance mode. Set REDIS_PORT environment variable.');
      }
    }

    return normalizedConfig;
  }

  /**
   * Creates Redis clients for single instance mode
   */
  private async createSingleClients(): Promise<void> {
    const clientConfig = this.buildClientConfig();
    // Create publisher client
    this.pubClient = new Redis(clientConfig);

    // Create subscriber client (duplicate with separate connection)
    this.subClient = this.pubClient.duplicate();

    // If lazyConnect is true, manually connect the clients
    if (clientConfig.lazyConnect) {
      await Promise.all([
        this.pubClient.connect(),
        this.subClient.connect()
      ]);
    }
  }

  /**
   * Creates Redis clients for cluster mode
   */
  private async createClusterClients(): Promise<void> {
    const clientConfig = this.buildClientConfig();

    // Create publisher cluster client
    this.pubClient = new Redis.Cluster(this.config.nodes, {
      redisOptions: clientConfig,
      enableReadyCheck: false,
      lazyConnect: clientConfig.lazyConnect
    });

    // Create subscriber cluster client
    this.subClient = new Redis.Cluster(this.config.nodes, {
      redisOptions: clientConfig,
      enableReadyCheck: false,
      lazyConnect: clientConfig.lazyConnect
    });

    // If lazyConnect is true, manually connect the cluster clients
    if (clientConfig.lazyConnect) {
      await Promise.all([
        this.pubClient.connect(),
        this.subClient.connect()
      ]);
    }
  }

  /**
   * Builds Redis client configuration with optimized settings
   */
  private buildClientConfig(): RedisOptions {
    const config: RedisOptions = {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      password: this.config.password,
      username: this.config.username,
      keyPrefix: this.config.keyPrefix,
      tls: this.config.tls,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest,
      connectTimeout: this.config.connectTimeout,
      commandTimeout: this.config.commandTimeout,
      lazyConnect: this.config.lazyConnect,
      keepAlive: this.config.keepAlive,
      // Optimized connection pool settings
      family: 4, // Use IPv4
      enableAutoPipelining: true
    };

    // Add retry configuration if available
    if (this.config.retry) {
      config.maxRetriesPerRequest = this.config.retry.maxAttempts;
    }

    return config;
  }

  /**
   * Sets up connection event handlers for monitoring and logging
   */
  private setupConnectionEventHandlers(): void {
    if (!this.config.monitoring?.logEvents) {
      return;
    }

    // Publisher client events
    this.pubClient.on('connect', () => {
      this.updateConnectionHealth('pubClient', { connected: true });
    });

    // this.pubClient.on('ready', () => {
    //   this.logger.log('Redis publisher client ready');
    // });

    this.pubClient.on('error', (error: Error) => {
      this.logger.error('Redis publisher client error', {
        error: error.message,
        stack: error.stack
      });
      this.updateConnectionHealth('pubClient', { connected: false, error: error.message });
    });

    this.pubClient.on('close', () => {
      this.updateConnectionHealth('pubClient', { connected: false });
    });

    // this.pubClient.on('reconnecting', () => {
    //   this.logger.log('Redis publisher client reconnecting...');
    // });

    // Subscriber client events
    this.subClient.on('connect', () => {
      this.updateConnectionHealth('subClient', { connected: true });
    });

    // this.subClient.on('ready', () => {
    //   this.logger.log('Redis subscriber client ready');
    // });

    this.subClient.on('error', (error: Error) => {
      this.logger.error('Redis subscriber client error', {
        error: error.message,
        stack: error.stack
      });
      this.updateConnectionHealth('subClient', { connected: false, error: error.message });
    });

    this.subClient.on('close', () => {
      this.updateConnectionHealth('subClient', { connected: false });
    });

    // this.subClient.on('reconnecting', () => {
    //   this.logger.log('Redis subscriber client reconnecting...');
    // });
  }

  /**
   * Waits for both Redis clients to be ready with timeout and retry logic
   */
  private async waitForClientsReady(): Promise<void> {
    const timeout = this.config.connectTimeout || 10000;
    const maxAttempts = this.config.retry?.maxAttempts || 5;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        await Promise.race([
          Promise.all([
            this.waitForClientReady(this.pubClient, 'Publisher'),
            this.waitForClientReady(this.subClient, 'Subscriber')
          ]),
          // eslint-disable-next-line no-promise-executor-return
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout))
        ]);

        // Test connections with ping
        await Promise.all([
          this.pubClient.ping(),
          this.subClient.ping()
        ]);
        return;
      } catch (error) {
        attempts += 1;
        this.logger.warn(`Connection attempt ${attempts}/${maxAttempts} failed`, {
          error: error.message,
          nextRetryIn: attempts < maxAttempts ? this.calculateRetryDelay(attempts) : 'N/A'
        });

        if (attempts >= maxAttempts) {
          throw new Error(`Failed to establish Redis connections after ${maxAttempts} attempts: ${error.message}`);
        }

        // Wait before retry with exponential backoff
        await this.delay(this.calculateRetryDelay(attempts));
      }
    }
  }

  /**
   * Waits for a single Redis client to be ready
   */
  private async waitForClientReady(client: Redis | Cluster, clientName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (client.status === 'ready') {
        resolve();
        return;
      }

      let onReady: () => void;
      let onError: (error: Error) => void;

      const cleanup = () => {
        client.off('ready', onReady);
        client.off('error', onError);
      };

      onReady = () => {
        cleanup();
        resolve();
      };

      onError = (error: Error) => {
        cleanup();
        reject(new Error(`${clientName} client connection failed: ${error.message}`));
      };

      client.once('ready', onReady);
      client.once('error', onError);
    });
  }

  /**
   * Calculates retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const { initialDelay = 1000, maxDelay = 10000, backoffMultiplier = 2 } = this.config.retry || {};
    const delay = Math.min(initialDelay * backoffMultiplier ** (attempt - 1), maxDelay);
    return delay + Math.random() * 1000; // Add jitter
  }

  /**
   * Utility method for creating delays
   */
  private delay(ms: number): Promise<void> {
    // eslint-disable-next-line no-promise-executor-return
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Updates connection health status for monitoring
   */
  private updateConnectionHealth(clientType: 'pubClient' | 'subClient', status: Partial<ConnectionHealth['pubClient']>): void {
    if (!this.connectionHealth) {
      this.connectionHealth = {
        healthy: false,
        pubClient: { connected: false },
        subClient: { connected: false },
        lastCheck: new Date()
      };
    }

    this.connectionHealth[clientType] = {
      ...this.connectionHealth[clientType],
      ...status,
      lastPing: status.connected ? Date.now() : this.connectionHealth[clientType].lastPing
    };

    this.connectionHealth.healthy = this.connectionHealth.pubClient.connected && this.connectionHealth.subClient.connected;
    this.connectionHealth.lastCheck = new Date();
  }

  /**
   * Initializes health monitoring with periodic checks
   */
  private initializeHealthMonitoring(): void {
    if (!this.config.healthCheck?.enabled) {
      return;
    }

    const interval = this.config.healthCheck.interval || 30000;

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }

      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Health check failed', {
          error: error.message,
          connectionHealth: this.connectionHealth
        });
      }
    }, interval);
  }

  /**
   * Performs comprehensive health check on Redis connections
   */
  private async performHealthCheck(): Promise<ConnectionHealth> {
    const timeout = this.config.healthCheck?.timeout || 5000;

    try {
      // Ping both clients with timeout
      const [pubPing, subPing] = await Promise.all([
        Promise.race([
          this.pubClient.ping(),
          // eslint-disable-next-line no-promise-executor-return
          new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), timeout))
        ]),
        Promise.race([
          this.subClient.ping(),
          // eslint-disable-next-line no-promise-executor-return
          new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), timeout))
        ])
      ]);

      // Update health status
      this.updateConnectionHealth('pubClient', {
        connected: pubPing === 'PONG',
        error: pubPing === 'PONG' ? undefined : 'Ping failed'
      });

      this.updateConnectionHealth('subClient', {
        connected: subPing === 'PONG',
        error: subPing === 'PONG' ? undefined : 'Ping failed'
      });

      // if (this.config.monitoring?.enableMetrics) {
      //   this.logger.log('Health check completed', {
      //     pubClientStatus: this.connectionHealth.pubClient,
      //     subClientStatus: this.connectionHealth.subClient,
      //     overallHealth: this.connectionHealth.healthy
      //   });
      // }
    } catch (error) {
      this.logger.warn('Health check ping failed', {
        error: error.message,
        pubClientStatus: this.pubClient.status,
        subClientStatus: this.subClient.status
      });

      this.updateConnectionHealth('pubClient', {
        connected: false,
        error: error.message
      });

      this.updateConnectionHealth('subClient', {
        connected: false,
        error: error.message
      });
    }

    return this.connectionHealth;
  }

  /**
   * Cleans up Redis connections and resources
   */
  private async cleanup(): Promise<void> {
    const cleanupPromises: Promise<void>[] = [];

    // Close publisher client
    if (this.pubClient) {
      cleanupPromises.push(
        this.closeClient(this.pubClient, 'Publisher')
      );
    }

    // Close subscriber client
    if (this.subClient) {
      cleanupPromises.push(
        this.closeClient(this.subClient, 'Subscriber')
      );
    }

    // Wait for all connections to close
    await Promise.allSettled(cleanupPromises);

    // Reset state
    this.pubClient = null;
    this.subClient = null;
    this.adapterConstructor = null;
    this.connectionHealth = null;
  }

  /**
   * Closes a Redis client connection safely
   */
  private async closeClient(client: Redis | Cluster, clientName: string): Promise<void> {
    try {
      if (client && client.status !== 'end') {
        // Add error handler to suppress EPIPE errors during shutdown
        const errorHandler = (error: Error) => {
          if (error.message.includes('EPIPE') || error.message.includes('Connection is closed')) {
            // Suppress expected errors during shutdown
            // this.logger.log(`Expected connection error during ${clientName} shutdown: ${error.message}`);
          } else {
            this.logger.warn(`Unexpected error during ${clientName} shutdown`, {
              error: error.message,
              stack: error.stack
            });
          }
        };

        // Add temporary error handler before closing
        client.on('error', errorHandler);

        // Remove all other event listeners to prevent memory leaks
        client.removeAllListeners();

        // Keep only our shutdown error handler
        client.on('error', errorHandler);

        // Gracefully close the connection
        try {
          await client.quit();
        } catch (quitError) {
          // If quit fails, force disconnect
          this.logger.log(`Quit failed for ${clientName}, forcing disconnect: ${quitError.message}`);
          client.disconnect();
        }

        // Remove our error handler after disconnect
        client.removeListener('error', errorHandler);
      }
    } catch (error) {
      this.logger.warn(`Error closing ${clientName} client`, {
        error: error.message,
        status: client?.status
      });

      // Force disconnect if graceful quit fails
      try {
        if (client && client.status !== 'end') {
          client.disconnect();
        }
      } catch (forceError) {
        this.logger.log(`Failed to force disconnect ${clientName} client: ${forceError.message}`);
      }
    }
  }
}
