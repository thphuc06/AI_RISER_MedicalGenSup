import { doc, onSnapshot } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import type { CartItem } from '../types';

export interface FirestoreCart { id: string; userId?: string; items: CartItem[]; updatedAt?: unknown }
export type CartOperation =
  | { type: 'add'; sku: string; quantity: number; source?: string }
  | { type: 'remove'; sku: string }
  | { type: 'set_quantity'; sku: string; quantity: number }
  | { type: 'clear' };

export const cartIdForUser = (userId: string) => `user_${userId}`;

export function subscribeToCart(userId: string, onUpdate: (cart: FirestoreCart) => void, onError?: (error: Error) => void) {
  const cartId = cartIdForUser(userId);
  return onSnapshot(doc(db, 'carts', cartId), (snapshot) => {
    const data = snapshot.data();
    onUpdate({ id: cartId, userId: data?.userId, items: Array.isArray(data?.items) ? data.items : [], updatedAt: data?.updatedAt });
  }, (error) => { console.error('[Firestore] Cart listener failed:', error); onError?.(error); });
}

export async function fetchCartFromServer(user: any): Promise<FirestoreCart> {
  const token = await user.getIdToken();
  const response = await fetch('/api/cart', {
    headers: { authorization: `Bearer ${token}` }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch cart');
  return {
    id: cartIdForUser(user.uid),
    userId: user.uid,
    items: result.items || []
  };
}

async function postAuthenticated(user: User, url: string, body: unknown) {
  const token = await user.getIdToken();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.reason || result.error || 'Server rejected the request');
  return result;
}

export const mutateServerCart = (user: User, operation: CartOperation) =>
  postAuthenticated(user, '/api/cart/mutate', { operation });

export const checkoutServerCart = (user: User, customer: { name: string; phone: string; address: string }) =>
  postAuthenticated(user, '/api/cart/checkout', { customer });
