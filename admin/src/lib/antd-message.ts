import type { MessageInstance } from 'antd/es/message/interface';

let messageApi: MessageInstance | null = null;

export function bindAntdMessage(api: MessageInstance) {
  messageApi = api;
}

export const appMessage = {
  success: (...args: Parameters<MessageInstance['success']>) => messageApi?.success(...args),
  error: (...args: Parameters<MessageInstance['error']>) => messageApi?.error(...args),
  warning: (...args: Parameters<MessageInstance['warning']>) => messageApi?.warning(...args),
  info: (...args: Parameters<MessageInstance['info']>) => messageApi?.info(...args),
  loading: (...args: Parameters<MessageInstance['loading']>) => messageApi?.loading(...args),
  open: (...args: Parameters<MessageInstance['open']>) => messageApi?.open(...args),
  destroy: (...args: Parameters<MessageInstance['destroy']>) => messageApi?.destroy(...args)
};
