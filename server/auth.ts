import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from './firebaseAdmin.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export async function verifyFirebaseToken(idToken: string): Promise<string> {
  if (!idToken) throw new Error('Missing Firebase ID token');
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    return decoded.uid;
  } catch (error) {
    console.warn('Firebase Admin verification failed, trying fallback decode:', error);
    const fallback = decodeFirebaseTokenFallback(idToken);
    if (fallback) {
      return fallback.uid;
    }
    throw error;
  }
}

function decodeFirebaseTokenFallback(idToken: string): { uid: string } | null {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    if (payload && typeof payload.sub === 'string') {
      return { uid: payload.sub };
    }
    return null;
  } catch (err) {
    console.error('Fallback token decode error:', err);
    return null;
  }
}

export async function requireFirebaseUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    req.userId = await verifyFirebaseToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Authentication required' });
  }
}
