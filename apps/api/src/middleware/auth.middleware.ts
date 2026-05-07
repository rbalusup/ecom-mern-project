import jwt from 'jsonwebtoken';

import type { AuthenticatedUser } from '../graphql/context.js';

interface CognitoJWTPayload {
  sub: string;
  email: string;
  'cognito:groups'?: string[];
  'custom:role'?: string;
}

function extractRole(payload: CognitoJWTPayload): 'customer' | 'vendor' | 'admin' {
  const customRole = payload['custom:role'];
  if (customRole === 'admin' || customRole === 'vendor') return customRole;

  const groups = payload['cognito:groups'] ?? [];
  if (groups.includes('admins')) return 'admin';
  if (groups.includes('vendors')) return 'vendor';
  return 'customer';
}

export function verifyJWT(token: string): AuthenticatedUser | null {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    // In production Cognito mode, we would validate against the JWKS endpoint.
    // For local dev / tests, JWT_SECRET must be set.
    return null;
  }

  try {
    const payload = jwt.verify(token, secret) as CognitoJWTPayload;
    return {
      id: payload.sub,
      email: payload.email,
      role: extractRole(payload),
      cognitoId: payload.sub,
    };
  } catch {
    return null;
  }
}

export function signJWT(payload: Omit<AuthenticatedUser, 'cognitoId'> & { cognitoId?: string }, expiresIn = '7d'): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET env var not set');
  return jwt.sign(
    {
      sub: payload.id,
      email: payload.email,
      'custom:role': payload.role,
      cognitoId: payload.cognitoId ?? payload.id,
    },
    secret,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { expiresIn: expiresIn as any },
  );
}
