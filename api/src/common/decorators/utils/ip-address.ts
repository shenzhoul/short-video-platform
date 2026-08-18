import { createParamDecorator } from '@nestjs/common';

import { getTrustedClientIp } from '../../utils/client-ip';

export const IpAddress = createParamDecorator((_data, ctx) => {
  const req = ctx.switchToHttp().getRequest();
  return getTrustedClientIp(req);
});
