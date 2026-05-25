import { AuthService, type TokenValidation } from '../services/auth-service.js';

export { TokenValidation };

/**
 * Validate an access token against the api_tokens table.
 * Returns project/role info if valid, throws on failure.
 *
 * Thin wrapper around AuthService for backward compatibility.
 */
export function validateToken(token: string): TokenValidation {
  return AuthService.validateToken(token);
}
