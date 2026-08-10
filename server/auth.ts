import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from './firebaseAdmin.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export async function verifyFirebaseToken(idToken: string): Promise<string> {
  if (!idToken) throw new Error('Missing Firebase ID token');
  const decoded = await adminAuth.verifyIdToken(idToken);
  return decoded.uid;
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
