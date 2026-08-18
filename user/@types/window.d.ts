import type { PublicSettings } from '../src/lib/utils';

declare global {
  interface Window {
    PUBLIC_SETTINGS?: Partial<PublicSettings> & Record<string, any>;
    ReactSocketIO: any;
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any;
  }
}

export {};
