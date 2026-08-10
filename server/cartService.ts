import type { CartLine, HealthProfile, SafetyResult } from './domain.js';
import { adminDb, FieldValue, SERVER_SECRET } from './firebaseAdmin.js';
import { evaluateSafety } from './safetyService.js';
import { getSafetyData } from './sheetsService.js';

export type CartOperation =
  | { type: 'add'; sku: string; quantity: number; source?: string }
  | { type: 'remove'; sku: string }
  | { type: 'set_quantity'; sku: string; quantity: number }
  | { type: 'clear' };

export interface StoredCartItem {
  id: string;
  name: string;
  source: string;
  quantity: number;
  unit: string;
  price: number;
  activeIngredient: string;
  isWarning?: boolean;
  warningMessage?: string;
}

export interface CartMutationResult {
  success: boolean;
  verdict: SafetyResult['verdict'];
  reason?: string;
  items?: StoredCartItem[];
}

export function cartDocumentId(userId: string): string {
  return `user_${userId}`;
}

function linesFromItems(items: StoredCartItem[]): CartLine[] {
  return items.map((item) => ({ sku: item.id, quantity: item.quantity, source: item.source }));
}

function itemsFromLines(lines: CartLine[], productList: ReturnType<typeof getSafetyData>['products'], verdict?: SafetyResult): StoredCartItem[] {
  const products = new Map(productList.map((product) => [product.sku.toLowerCase(), product]));
  return lines.map((line) => {
    const product = products.get(line.sku.toLowerCase());
    if (!product) throw new Error(`Unknown SKU ${line.sku}`);
    return {
      id: product.sku, name: product.ten_san_pham, source: line.source || 'Gợi ý từ Dược sĩ AI',
      quantity: line.quantity, unit: product.dang_bao_che, price: product.gia,
      activeIngredient: product.hoat_chat,
      ...(verdict?.verdict === 'WARN' ? { isWarning: true, warningMessage: verdict.reason } : {}),
    };
  });
}

export async function readCart(userId: string): Promise<StoredCartItem[]> {
  const snapshot = await adminDb.collection('carts').doc(cartDocumentId(userId)).get();
  if (!snapshot.exists) return [];
  const items = snapshot.data()?.items;
  return Array.isArray(items) ? items as StoredCartItem[] : [];
}

export async function readHealthProfile(userId: string): Promise<{ status: 'found' | 'missing'; profile: HealthProfile | null }> {
  const snapshot = await adminDb.collection('health_profiles').doc(userId).get();
  return healthProfileFromDocument(snapshot.exists, snapshot.data());
}

export function healthProfileFromDocument(exists: boolean, data?: Record<string, unknown>): { status: 'found' | 'missing'; profile: HealthProfile | null } {
  return exists ? { status: 'found', profile: (data || {}) as HealthProfile } : { status: 'missing', profile: null };
}

export async function saveHealthProfile(userId: string, profile: HealthProfile): Promise<void> {
  await adminDb.collection('health_profiles').doc(userId).set({ ...profile, userId, serverSecret: SERVER_SECRET, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function saveConfirmedTranscript(userId: string, transcript: string): Promise<void> {
  const confirmedTranscript = transcript.trim();
  if (!confirmedTranscript) throw new Error('Confirmed transcript cannot be empty');
  await adminDb.collection('carts').doc(cartDocumentId(userId)).set({ userId, confirmedTranscript, serverSecret: SERVER_SECRET, transcriptConfirmedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export function applyCartOperation(current: CartLine[], operation: CartOperation): CartLine[] {
  if (operation.type === 'clear') return [];
  const next = current.map((line) => ({ ...line }));
  const index = next.findIndex((line) => line.sku.toLowerCase() === operation.sku.toLowerCase());
  if (operation.type === 'remove') return index < 0 ? next : next.filter((_, itemIndex) => itemIndex !== index);
  if (!Number.isInteger(operation.quantity) || operation.quantity <= 0 || operation.quantity > 100) throw new Error('Quantity must be an integer from 1 to 100');
  if (operation.type === 'set_quantity') {
    if (index < 0) throw new Error('SKU is not in the cart');
    next[index].quantity = operation.quantity;
    return next;
  }
  if (index >= 0) next[index] = { ...next[index], quantity: next[index].quantity + operation.quantity, source: operation.source || next[index].source };
  else next.push({ sku: operation.sku, quantity: operation.quantity, source: operation.source });
  return next;
}

export async function mutateCart(userId: string, operation: CartOperation): Promise<CartMutationResult> {
  try {
    const safetyData = getSafetyData();
    const cartRef = adminDb.collection('carts').doc(cartDocumentId(userId));
    const profileRef = adminDb.collection('health_profiles').doc(userId);
    return await adminDb.runTransaction(async (transaction) => {
      const [cartSnapshot, profileSnapshot] = await Promise.all([transaction.get(cartRef), transaction.get(profileRef)]);
      const currentItems = cartSnapshot.exists && Array.isArray(cartSnapshot.data()?.items) ? cartSnapshot.data()?.items as StoredCartItem[] : [];
      const confirmedTranscript = cartSnapshot.exists ? String(cartSnapshot.data()?.confirmedTranscript || '') : '';
      if (!confirmedTranscript) return { success: false, verdict: 'BLOCK' as const, reason: 'Chưa có transcript được server xác nhận.' };
      const candidate = applyCartOperation(linesFromItems(currentItems), operation);
      const profile = profileSnapshot.exists ? profileSnapshot.data() as HealthProfile : null;
      const safety = evaluateSafety({ cart: candidate, healthProfile: profile, confirmedTranscript, safetyData });
      if (safety.verdict === 'BLOCK' || safety.verdict === 'STOP_SELL') return { success: false, ...safety };
      const items = itemsFromLines(candidate, safetyData.products, safety);
      transaction.set(cartRef, { userId, items, serverSecret: SERVER_SECRET, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { success: true, ...safety, items };
    });
  } catch (error) {
    return { success: false, verdict: 'BLOCK', reason: `Không thể xác minh hoặc lưu giỏ hàng: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function checkoutCart(userId: string, customer: Record<string, string>) {
  try {
    const safetyData = getSafetyData();
    const cartRef = adminDb.collection('carts').doc(cartDocumentId(userId));
    const profileRef = adminDb.collection('health_profiles').doc(userId);
    const orderRef = adminDb.collection('orders').doc();
    return await adminDb.runTransaction(async (transaction) => {
      const [cartSnapshot, profileSnapshot] = await Promise.all([transaction.get(cartRef), transaction.get(profileRef)]);
      const items = cartSnapshot.exists && Array.isArray(cartSnapshot.data()?.items) ? cartSnapshot.data()?.items as StoredCartItem[] : [];
      const confirmedTranscript = cartSnapshot.exists ? String(cartSnapshot.data()?.confirmedTranscript || '') : '';
      if (!confirmedTranscript) return { success: false, verdict: 'BLOCK' as const, reason: 'Chưa có transcript được server xác nhận.' };
      const profile = profileSnapshot.exists ? profileSnapshot.data() as HealthProfile : null;
      const safety = evaluateSafety({ cart: linesFromItems(items), healthProfile: profile, confirmedTranscript, safetyData });
      if (safety.verdict === 'BLOCK' || safety.verdict === 'STOP_SELL') return { success: false, ...safety };
      transaction.set(orderRef, { userId, items, confirmedTranscript, customer, safetyVerdict: safety.verdict, safetyReason: safety.reason || null, status: 'pending', serverSecret: SERVER_SECRET, createdAt: FieldValue.serverTimestamp() });
      return { success: true, orderId: orderRef.id, ...safety };
    });
  } catch (error) {
    return { success: false, verdict: 'BLOCK' as const, reason: `Không thể xác minh hoặc tạo đơn: ${error instanceof Error ? error.message : String(error)}` };
  }
}
