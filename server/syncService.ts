import { GoogleGenAI } from '@google/genai';
import { db } from '../src/db/index.ts';
import { products, contraindications, maxDoses, redFlags } from '../src/db/schema.ts';
import { eq, inArray } from 'drizzle-orm';
import type { Product, Contraindication, MaxDose, RedFlag } from './domain.js';

// Lazy initialize Gemini client
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing.');
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// Helper for sleeping
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to generate embedding with quota fallback and exponential backoff retry
export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;
  
  const maxRetries = 5;
  let baseDelayMs = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Add a small sequential gap to prevent hitting burst rate limits
      await delay(150);

      const ai = getAI();
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text.trim(),
      }) as any;
      
      const emb = response.embedding || response.embeddings;
      if (emb) {
        if (Array.isArray(emb)) {
          if (emb[0] && 'values' in emb[0] && Array.isArray(emb[0].values)) {
            return emb[0].values;
          }
        } else if (typeof emb === 'object' && 'values' in emb && Array.isArray((emb as any).values)) {
          return (emb as any).values;
        }
      }
      return null;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isRateLimit = errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('RESOURCE_EXHAUSTED');

      if (isRateLimit && attempt < maxRetries) {
        const sleepTime = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.warn(`[Embedding Sync] Quota hit on attempt ${attempt}. Retrying in ${Math.round(sleepTime)}ms...`);
        await delay(sleepTime);
      } else {
        console.warn(`[Embedding Sync] Failed to generate embedding on attempt ${attempt} for text: "${text.slice(0, 30)}...". Error: ${errMsg}`);
        return null;
      }
    }
  }
  return null;
}

export async function syncSheetsToPostgres(data: {
  products: Product[];
  contraindications: Contraindication[];
  maxDoses: MaxDose[];
  redFlags: RedFlag[];
}) {
  console.log('[Sync] Starting synchronization of Google Sheets data to PostgreSQL...');

  // 1. Sync PRODUCTS
  try {
    // Load existing products from DB to avoid unnecessary embedding calls
    const existingProductsList = await db.select({
      sku: products.sku,
      chi_dinh_ngan: products.chi_dinh_ngan,
      embedding: products.embedding,
    }).from(products);

    const existingProductsMap = new Map(existingProductsList.map(p => [p.sku, p]));

    console.log(`[Sync] Syncing ${data.products.length} products...`);
    for (const prod of data.products) {
      const existing = existingProductsMap.get(prod.sku);
      let embedding: number[] | null = null;

      if (existing && existing.chi_dinh_ngan === prod.chi_dinh_ngan && existing.embedding && existing.embedding.length > 0) {
        // Reuse existing embedding
        embedding = existing.embedding;
      } else {
        // Generate new embedding: include name and indications for rich semantic search
        const embedText = `${prod.ten_san_pham}. Chỉ định: ${prod.chi_dinh_ngan}`;
        embedding = await getEmbedding(embedText);
      }

      await db.insert(products)
        .values({
          sku: prod.sku,
          ten_san_pham: prod.ten_san_pham,
          hoat_chat: prod.hoat_chat,
          ham_luong_mg: prod.ham_luong_mg,
          dang_bao_che: prod.dang_bao_che,
          nhom: prod.nhom,
          rx_status: prod.rx_status,
          gia: prod.gia,
          ton_kho: prod.ton_kho,
          chi_dinh_ngan: prod.chi_dinh_ngan,
          cach_dung_co_ban: prod.cach_dung_co_ban,
          embedding: embedding,
        })
        .onConflictDoUpdate({
          target: products.sku,
          set: {
            ten_san_pham: prod.ten_san_pham,
            hoat_chat: prod.hoat_chat,
            ham_luong_mg: prod.ham_luong_mg,
            dang_bao_che: prod.dang_bao_che,
            nhom: prod.nhom,
            rx_status: prod.rx_status,
            gia: prod.gia,
            ton_kho: prod.ton_kho,
            chi_dinh_ngan: prod.chi_dinh_ngan,
            cach_dung_co_ban: prod.cach_dung_co_ban,
            embedding: embedding,
            updatedAt: new Date(),
          }
        });
    }

    // Optional: Clean up deleted products (not present in current sheet)
    const currentSkus = data.products.map(p => p.sku);
    if (currentSkus.length > 0) {
      // Drizzle delete not in array
      // await db.delete(products).where(notInArray(products.sku, currentSkus));
    }
    console.log('[Sync] Products synced successfully.');
  } catch (err) {
    console.error('[Sync] Error syncing products:', err);
  }

  // 2. Sync CONTRAINDICATIONS
  try {
    // For contraindications, let's load current DB rows
    const existingContra = await db.select().from(contraindications);
    console.log(`[Sync] Syncing ${data.contraindications.length} contraindications...`);

    // Clean current table and rebuild (to handle modifications cleanly), or match duplicates
    // Since it's reference data, truncating or deleting and re-inserting is very clean
    // But we want to reuse embeddings! So we'll map existing conditions
    const existingEmbedMap = new Map<string, number[]>();
    for (const c of existingContra) {
      if (c.embedding && c.embedding.length > 0) {
        existingEmbedMap.set(`${c.hoat_chat.toLowerCase()}|||${c.dieu_kien.toLowerCase()}`, c.embedding);
      }
    }

    // Delete existing
    await db.delete(contraindications);

    // Insert new with embedding lookup
    for (const c of data.contraindications) {
      const key = `${c.hoat_chat.toLowerCase()}|||${c.dieu_kien.toLowerCase()}`;
      let embedding = existingEmbedMap.get(key) || null;

      if (!embedding) {
        embedding = await getEmbedding(c.dieu_kien);
      }

      await db.insert(contraindications).values({
        hoat_chat: c.hoat_chat,
        dieu_kien: c.dieu_kien,
        loai: c.loai,
        muc_do: c.muc_do,
        ly_do_ngan_gon: c.ly_do_ngan_gon,
        embedding: embedding,
      });
    }
    console.log('[Sync] Contraindications synced successfully.');
  } catch (err) {
    console.error('[Sync] Error syncing contraindications:', err);
  }

  // 3. Sync MAX DOSES (Plain table, no embedding needed)
  try {
    await db.delete(maxDoses);
    console.log(`[Sync] Syncing ${data.maxDoses.length} max doses...`);
    for (const md of data.maxDoses) {
      await db.insert(maxDoses).values({
        hoat_chat: md.hoat_chat,
        nhom_tuoi: md.nhom_tuoi,
        max_mg_ngay: md.max_mg_ngay,
      });
    }
    console.log('[Sync] Max doses synced successfully.');
  } catch (err) {
    console.error('[Sync] Error syncing max doses:', err);
  }

  // 4. Sync RED FLAGS
  try {
    const existingFlags = await db.select().from(redFlags);
    console.log(`[Sync] Syncing ${data.redFlags.length} red flags...`);

    const existingEmbedMap = new Map<string, number[]>();
    for (const r of existingFlags) {
      if (r.embedding && r.embedding.length > 0) {
        existingEmbedMap.set(r.tu_khoa_trieu_chung.toLowerCase(), r.embedding);
      }
    }

    await db.delete(redFlags);

    for (const rf of data.redFlags) {
      const key = rf.tu_khoa_trieu_chung.toLowerCase();
      let embedding = existingEmbedMap.get(key) || null;

      if (!embedding) {
        embedding = await getEmbedding(rf.tu_khoa_trieu_chung);
      }

      await db.insert(redFlags).values({
        tu_khoa_trieu_chung: rf.tu_khoa_trieu_chung,
        muc_do: rf.muc_do,
        hanh_dong: rf.hanh_dong,
        thong_diep: rf.thong_diep,
        embedding: embedding,
      });
    }
    console.log('[Sync] Red flags synced successfully.');
  } catch (err) {
    console.error('[Sync] Error syncing red flags:', err);
  }

  console.log('[Sync] All Google Sheets data synchronized to PostgreSQL database!');
}
