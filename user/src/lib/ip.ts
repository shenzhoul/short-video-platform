import { headers } from 'next/headers';
import * as requestIp from 'request-ip';

export async function getClientIpHeadersFromNextHeaders(): Promise<Record<string, string>> {
  const headersList = await headers();

  // Create a mock request object for request-ip to parse headers
  const headersObj: Record<string, string> = {};
  headersList.forEach((value, key) => {
    headersObj[key] = value;
  });

  const mockRequest = {
    headers: headersObj,
    connection: {},
    socket: {}
  };

  // Use request-ip to get the real client IP address
  const clientIp = requestIp.getClientIp(mockRequest) || '127.0.0.1';
  const forwardedFor = headersList.get('x-forwarded-for');

  return {
    'x-real-ip': clientIp,
    'x-forwarded-for': forwardedFor || clientIp
  };
}
