import type { CartLine, HealthProfile, SafetyResult } from './domain.js';
import { adminDb, FieldValue, SERVER_SECRET } from './firebaseAdmin.js';
import { evaluateSafety } from './safetyService.js';
import { getSafetyData } from './sheetsService.js';
import { computeOrderTriageScore } from '../src/utils/triageCalculator.js';
import { db } from '../src/db/index.js';
import { products } from '../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

export type CartOperation =
  | { type: 'add'; sku: string; quantity: number; source?: string }
  | { type: 'remove'; sku: string }
  | { type: 'set_quantity'; sku: string; quantity: number; source?: string }
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

const previewCarts = new Map<string, { items: StoredCartItem[]; confirmedTranscript?: string }>();
const previewHealthProfiles = new Map<string, HealthProfile>();

function isPermissionDenied(error: unknown): boolean {
  const msg = String(error || '');
  return msg.includes('PERMISSION_DENIED') || msg.includes('Missing or insufficient permissions');
}

export async function readCart(userId: string): Promise<StoredCartItem[]> {
  try {
    const snapshot = await adminDb.collection('carts').doc(cartDocumentId(userId)).get();
    if (!snapshot.exists) return [];
    const items = snapshot.data()?.items;
    return Array.isArray(items) ? items as StoredCartItem[] : [];
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.warn('[CartService] Firestore PERMISSION_DENIED in preview mode, falling back to in-memory cart.');
      return previewCarts.get(userId)?.items || [];
    }
    throw error;
  }
}

export async function readHealthProfile(userId: string): Promise<{ status: 'found' | 'missing'; profile: HealthProfile | null }> {
  try {
    const snapshot = await adminDb.collection('health_profiles').doc(userId).get();
    return healthProfileFromDocument(snapshot.exists, snapshot.data());
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.warn('[CartService] Firestore PERMISSION_DENIED in preview mode, falling back to in-memory health profile.');
      const memProfile = previewHealthProfiles.get(userId);
      return memProfile ? { status: 'found', profile: memProfile } : { status: 'missing', profile: null };
    }
    throw error;
  }
}

export function healthProfileFromDocument(exists: boolean, data?: Record<string, unknown>): { status: 'found' | 'missing'; profile: HealthProfile | null } {
  return exists ? { status: 'found', profile: (data || {}) as HealthProfile } : { status: 'missing', profile: null };
}

export async function saveHealthProfile(userId: string, profile: HealthProfile): Promise<void> {
  try {
    await adminDb.collection('health_profiles').doc(userId).set({ ...profile, userId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.warn('[CartService] Firestore PERMISSION_DENIED in preview mode, saving health profile in-memory.');
      const existing = previewHealthProfiles.get(userId) || {};
      previewHealthProfiles.set(userId, { ...existing, ...profile });
      return;
    }
    throw error;
  }
}

export async function saveConfirmedTranscript(userId: string, transcript: string): Promise<void> {
  const confirmedTranscript = transcript.trim();
  if (!confirmedTranscript) throw new Error('Confirmed transcript cannot be empty');
  try {
    await adminDb.collection('carts').doc(cartDocumentId(userId)).set({ userId, confirmedTranscript, serverSecret: SERVER_SECRET, transcriptConfirmedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.warn('[CartService] Firestore PERMISSION_DENIED in preview mode, saving confirmed transcript in-memory.');
      const existing = previewCarts.get(userId) || { items: [] };
      previewCarts.set(userId, { ...existing, confirmedTranscript });
      return;
    }
    throw error;
  }
}

export function applyCartOperation(current: CartLine[], operation: CartOperation): CartLine[] {
  if (operation.type === 'clear') return [];
  const next = current.map((line) => ({ ...line }));
  const index = next.findIndex((line) => line.sku.toLowerCase() === operation.sku.toLowerCase());
  if (operation.type === 'remove') return index < 0 ? next : next.filter((_, itemIndex) => itemIndex !== index);
  if (!Number.isInteger(operation.quantity) || operation.quantity <= 0 || operation.quantity > 100) throw new Error('Quantity must be an integer from 1 to 100');
  if (operation.type === 'set_quantity') {
    if (index < 0) {
      next.push({ sku: operation.sku, quantity: operation.quantity, source: operation.source });
      return next;
    }
    next[index].quantity = operation.quantity;
    return next;
  }
  if (index >= 0) next[index] = { ...next[index], quantity: next[index].quantity + operation.quantity, source: operation.source || next[index].source };
  else next.push({ sku: operation.sku, quantity: operation.quantity, source: operation.source });
  return next;
}

export async function mutateCart(
  userId: string,
  operation: CartOperation,
  origin: 'manual_catalog' | 'voice_ai' = 'manual_catalog'
): Promise<CartMutationResult> {
  const safetyData = getSafetyData();

  try {
    const cartRef = adminDb.collection('carts').doc(cartDocumentId(userId));
    const profileRef = adminDb.collection('health_profiles').doc(userId);
    return await adminDb.runTransaction(async (transaction) => {
      const [cartSnapshot, profileSnapshot] = await Promise.all([transaction.get(cartRef), transaction.get(profileRef)]);
      const currentItems = cartSnapshot.exists && Array.isArray(cartSnapshot.data()?.items) ? cartSnapshot.data()?.items as StoredCartItem[] : [];
      const candidate = applyCartOperation(linesFromItems(currentItems), operation);
      const profile = profileSnapshot.exists ? profileSnapshot.data() as HealthProfile : null;
      const safety = evaluateSafety({ cart: candidate, healthProfile: profile, confirmedTranscript: '', safetyData });
      if (safety.verdict === 'BLOCK' || safety.verdict === 'STOP_SELL') return { success: false, ...safety };
      const items = itemsFromLines(candidate, safetyData.products, safety);
      transaction.set(cartRef, { userId, items, serverSecret: SERVER_SECRET, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { success: true, ...safety, items };
    });
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.warn('[CartService] Firestore PERMISSION_DENIED in preview mode, executing cart mutation in-memory.');
      const memCart = previewCarts.get(userId) || { items: [] };
      const currentItems = memCart.items;
      const candidate = applyCartOperation(linesFromItems(currentItems), operation);
      const profile = previewHealthProfiles.get(userId) || null;
      const safety = evaluateSafety({ cart: candidate, healthProfile: profile, confirmedTranscript: '', safetyData });
      if (safety.verdict === 'BLOCK' || safety.verdict === 'STOP_SELL') return { success: false, ...safety };
      const items = itemsFromLines(candidate, safetyData.products, safety);
      previewCarts.set(userId, { ...memCart, items });
      return { success: true, ...safety, items };
    }
    return { success: false, verdict: 'BLOCK', reason: `Không thể xác minh hoặc lưu giỏ hàng: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function checkoutCart(userId: string, customer: Record<string, string>) {
  const safetyData = getSafetyData();

  try {
    const cartRef = adminDb.collection('carts').doc(cartDocumentId(userId));
    const profileRef = adminDb.collection('health_profiles').doc(userId);
    const orderRef = adminDb.collection('orders').doc();
    return await adminDb.runTransaction(async (transaction) => {
      const [cartSnapshot, profileSnapshot] = await Promise.all([transaction.get(cartRef), transaction.get(profileRef)]);
      const items = cartSnapshot.exists && Array.isArray(cartSnapshot.data()?.items) ? cartSnapshot.data()?.items as StoredCartItem[] : [];
      const profile = profileSnapshot.exists ? profileSnapshot.data() as HealthProfile : null;
      const safety = evaluateSafety({ cart: linesFromItems(items), healthProfile: profile, confirmedTranscript: '', safetyData });
      if (safety.verdict === 'BLOCK' || safety.verdict === 'STOP_SELL') return { success: false, ...safety };

      const patientName = customer.name || profile?.ho_ten || 'Khách hàng';
      const patientAge = profile?.do_tuoi || profile?.nhom_tuoi || 0;
      const patientPhone = customer.phone || '';

      const medicalHistory = profile?.benh_nen ? (Array.isArray(profile.benh_nen) ? profile.benh_nen : [profile.benh_nen]) : [];
      const allergies = profile?.di_ung ? (Array.isArray(profile.di_ung) ? profile.di_ung : [profile.di_ung]) : [];
      const currentMeds = profile?.thuoc_dang_dung ? (Array.isArray(profile.thuoc_dang_dung) ? profile.thuoc_dang_dung : [profile.thuoc_dang_dung]) : [];
      const specialConditions = profile?.trang_thai_dac_biet ? (Array.isArray(profile.trang_thai_dac_biet) ? profile.trang_thai_dac_biet : [profile.trang_thai_dac_biet]) : [];

      const triage = computeOrderTriageScore({
        age: patientAge,
        medicalHistory,
        allergies,
        currentMeds,
        specialConditions,
        symptoms: '',
        safetyVerdict: safety.verdict,
        safetyReason: safety.reason,
        items,
      });

      const clinicalSummary = {
        gender: profile?.doi_tuong || 'Nam',
        age: patientAge,
        medicalHistory,
        allergies,
        currentMeds,
        specialConditions,
        healthNotes: profile?.ghi_chu || '',
        symptoms: '',
        aiTriage: {
          category: safety.verdict === 'ALLOW' ? 'An toàn (ALLOW)' : safety.verdict === 'WARN' ? 'Cảnh báo (WARN)' : 'Chờ duyệt',
          riskLevel: safety.verdict === 'WARN' ? 'Cảnh báo tương tác' : triage.riskScore >= 65 ? 'Cao' : triage.riskScore >= 30 ? 'Trung bình' : 'Thấp',
          note: safety.reason || '',
          riskScore: triage.riskScore,
          priorityTier: triage.priorityTier,
          riskFactors: triage.riskFactors,
        },
      };

      transaction.set(orderRef, {
        userId,
        patientName,
        patientAge,
        patientPhone,
        priority: triage.priority,
        priorityTier: triage.priorityTier,
        riskScore: triage.riskScore,
        riskFactors: triage.riskFactors,
        clinicalSummary,
        items,
        customer,
        safetyVerdict: safety.verdict,
        safetyReason: safety.reason || null,
        status: 'cho_duyet',
        serverSecret: SERVER_SECRET,
        createdAt: FieldValue.serverTimestamp()
      });
      transaction.set(cartRef, { items: [] }, { merge: true });

      // Decrement stock in PostgreSQL (Cloud SQL) for all items in the order
      for (const item of items) {
        try {
          await db.update(products)
            .set({
              ton_kho: sql`GREATEST(0, ${products.ton_kho} - ${item.quantity})`
            })
            .where(eq(products.sku, item.id));
          console.log(`[Postgres] Decremented SKU ${item.id} quantity by ${item.quantity}`);
        } catch (dbErr) {
          console.error(`[Postgres] Error updating stock for SKU ${item.id}:`, dbErr);
        }
      }

      return { success: true, orderId: orderRef.id, ...safety };
    });
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.warn('[CartService] Firestore PERMISSION_DENIED in preview mode, executing checkout in-memory.');
      const memCart = previewCarts.get(userId) || { items: [] };
      const items = memCart.items;
      const confirmedTranscript = memCart.confirmedTranscript || '';
      const finalTranscript = confirmedTranscript || 'Khách hàng đặt hàng trực tiếp từ danh mục.';
      const profile = previewHealthProfiles.get(userId) || null;
      const safety = evaluateSafety({ cart: linesFromItems(items), healthProfile: profile, confirmedTranscript: finalTranscript, safetyData });
      if (safety.verdict === 'BLOCK' || safety.verdict === 'STOP_SELL') return { success: false, ...safety };
      const orderId = `preview_order_${Date.now()}`;

      // Decrement stock in PostgreSQL (Cloud SQL) even in fallback mode
      for (const item of items) {
        try {
          await db.update(products)
            .set({
              ton_kho: sql`GREATEST(0, ${products.ton_kho} - ${item.quantity})`
            })
            .where(eq(products.sku, item.id));
          console.log(`[Postgres-Fallback] Decremented SKU ${item.id} quantity by ${item.quantity}`);
        } catch (dbErr) {
          console.error(`[Postgres-Fallback] Error updating stock for SKU ${item.id}:`, dbErr);
        }
      }

      previewCarts.set(userId, { items: [], confirmedTranscript: '' });
      return { success: true, orderId, ...safety };
    }
    return { success: false, verdict: 'BLOCK' as const, reason: `Không thể xác minh hoặc tạo đơn: ${error instanceof Error ? error.message : String(error)}` };
  }
}
