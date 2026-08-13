import { db } from '../src/db/index.js';
import { products } from '../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { reloadSafetyDataFromPostgres } from './sheetsService.js';

export async function deductProductStock(items: any[]): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return;

  for (const item of items) {
    const qty = Number(item.quantity || item.so_luong || item.qty || 1);
    if (qty <= 0) continue;

    const sku = item.sku || item.id;
    const name = item.name || item.ten_san_pham || item.title;

    try {
      let updated = false;

      // 1. Try matching by SKU first
      if (sku && typeof sku === 'string') {
        const result = await db.update(products)
          .set({
            ton_kho: sql`GREATEST(0, ${products.ton_kho} - ${qty})`,
            updatedAt: new Date()
          })
          .where(eq(products.sku, sku))
          .returning();

        if (result.length > 0) {
          console.log(`[StockService] Decremented SKU "${sku}" by ${qty}. New stock in Postgres: ${result[0].ton_kho}`);
          updated = true;
        }
      }

      // 2. Fallback: Match by product name
      if (!updated && name && typeof name === 'string') {
        const result = await db.update(products)
          .set({
            ton_kho: sql`GREATEST(0, ${products.ton_kho} - ${qty})`,
            updatedAt: new Date()
          })
          .where(eq(products.ten_san_pham, name))
          .returning();

        if (result.length > 0) {
          console.log(`[StockService] Decremented product name "${name}" by ${qty}. New stock in Postgres: ${result[0].ton_kho}`);
          updated = true;
        }
      }

      if (!updated) {
        console.warn(`[StockService] Could not find product in Postgres by SKU "${sku}" or name "${name}"`);
      }
    } catch (dbErr) {
      console.error(`[StockService] Error updating stock for item (sku=${sku}, name=${name}):`, dbErr);
    }
  }

  // Reload the in-memory cache so all API endpoints & Gemini Live immediately see updated stock
  try {
    await reloadSafetyDataFromPostgres();
    console.log('[StockService] Successfully reloaded in-memory product cache after stock deduction.');
  } catch (err) {
    console.error('[StockService] Error reloading safety data cache:', err);
  }
}
