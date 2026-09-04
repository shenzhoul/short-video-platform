import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import Redis from 'ioredis';
import { Connection } from 'mongoose';

/**
 * Liveness and readiness for the API process.
 *
 * The two answer different questions and a load balancer uses them for
 * different things, so they must not be the same endpoint:
 *
 *  - **Liveness** — is this process still running its event loop? A failing
 *    liveness check means *restart me*. It deliberately touches no dependency:
 *    if Mongo goes down and liveness reports it, every API container is killed
 *    and restarted in a loop while the database is already struggling, which
 *    turns a recoverable outage into an outage plus a restart storm.
 *
 *  - **Readiness** — can this process serve a request right now? A failing
 *    readiness check means *stop sending me traffic, but leave me alone*. This
 *    one must check the dependencies a request actually needs, because a
 *    container that is up but cannot reach Redis will answer every feed request
 *    with an error, and nothing upstream would know to route around it.
 *
 * Neither reports version, build, hostname, or dependency error text. These are
 * unauthenticated endpoints reachable from the proxy, and an error string from
 * a driver names hosts and ports.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    @InjectRedis() private readonly redisClient: Redis
  ) {}

  /**
   * Liveness. Answers 200 as long as the process can run a handler.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  liveness() {
    return { status: 'ok' };
  }

  /**
   * Readiness. 200 when every dependency answers, 503 when one does not.
   */
  @Get('ready')
  async readiness() {
    const [mongo, redis] = await Promise.all([
      this.checkMongo(),
      this.checkRedis()
    ]);

    const dependencies = { mongo, redis };
    const ready = Object.values(dependencies).every(Boolean);

    if (!ready) {
      // A 503 body is still a body: it names *which* dependency is down, which
      // is what an operator needs, without the driver's message, which would
      // leak the connection string's host.
      throw new ServiceUnavailableException({ status: 'unavailable', dependencies });
    }

    return { status: 'ready', dependencies };
  }

  /**
   * `readyState === 1` is "connected", but it is a cached flag — it stays 1
   * while a connection is silently half-open. `ping` is an actual round trip,
   * which is the question readiness is asking.
   */
  private async checkMongo(): Promise<boolean> {
    try {
      if (this.mongoConnection.readyState !== 1) return false;
      await this.mongoConnection.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const reply = await this.redisClient.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }
}
