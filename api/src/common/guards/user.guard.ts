import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from 'src/services/identity/auth/auth.service';

@Injectable()
export class LoadUser implements CanActivate {
  constructor(private readonly authService: AuthService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // SECURITY FIX: Only accept tokens from Authorization header (Bearer prefix optional)
    const authHeader = request.headers.authorization;
    if (!authHeader || authHeader === 'null') return true;

    // Extract token - Bearer prefix is optional
    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    if (!token) return true; // No valid token, but this guard allows anonymous access

    const user = request.user || (await this.authService.getUserFromToken(token));
    if (!request.user) request.user = user;
    return true;
  }
}
