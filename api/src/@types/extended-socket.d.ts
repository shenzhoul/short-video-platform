import { Socket } from 'socket.io';

interface ExtendedSocket extends Socket {
  authUser: {
    userId: string | any;
    isCreator?: boolean;
  }
}
