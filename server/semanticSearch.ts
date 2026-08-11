import { GoogleGenAI } from '@google/genai';
import { db } from '../src/db/index.ts';
import { products, contraindications, redFlags } from '../src/db/schema.ts';
import { sql, like, or } from 'drizzle-orm';

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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Generate embedding helper with retry
async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;
  
  const maxRetries = 3;
  let baseDelayMs = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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
        const sleepTime = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 300;
        console.warn(`[Semantic Search] Quota hit on query embedding. Attempt ${attempt}. Retrying in ${Math.round(sleepTime)}ms...`);
        await delay(sleepTime);
      } else {
        console.error(`[Semantic Search] Failed to generate embedding on attempt ${attempt}: ${errMsg}`);
        return null;
      }
    }
  }
  return null;
}

// 1. Semantic Product Search
export async function searchProductsSemantic(query: string, limit = 5) {
  console.log(`[Semantic Search] Searching products for: "${query}" (limit: ${limit})`);
  const embedding = await generateQueryEmbedding(query);

  if (!embedding) {
    console.warn('[Semantic Search] Falling back to text-based search for products.');
    // Fallback: simple text search on ten_san_pham or chi_dinh_ngan
    const pattern = `%${query}%`;
    return await db.select()
      .from(products)
      .where(or(
        like(products.ten_san_pham, pattern),
        like(products.chi_dinh_ngan, pattern),
        like(products.hoat_chat, pattern)
      ))
      .limit(limit);
  }

  const vectorStr = `[${embedding.join(',')}]`;
  const results = await db.select({
    sku: products.sku,
    ten_san_pham: products.ten_san_pham,
    hoat_chat: products.hoat_chat,
    ham_luong_mg: products.ham_luong_mg,
    dang_bao_che: products.dang_bao_che,
    nhom: products.nhom,
    rx_status: products.rx_status,
    gia: products.gia,
    ton_kho: products.ton_kho,
    chi_dinh_ngan: products.chi_dinh_ngan,
    cach_dung_co_ban: products.cach_dung_co_ban,
    distance: sql<number>`(${products.embedding} <=> ${vectorStr}::vector)`
  })
  .from(products)
  .orderBy(sql`(${products.embedding} <=> ${vectorStr}::vector) ASC`)
  .limit(limit);

  return results;
}

// 2. Semantic Contraindications Search
export async function searchContraindicationsSemantic(condition: string, limit = 10) {
  console.log(`[Semantic Search] Searching contraindications for condition: "${condition}"`);
  const embedding = await generateQueryEmbedding(condition);

  if (!embedding) {
    console.warn('[Semantic Search] Falling back to text-based search for contraindications.');
    const pattern = `%${condition}%`;
    return await db.select()
      .from(contraindications)
      .where(or(
        like(contraindications.dieu_kien, pattern),
        like(contraindications.hoat_chat, pattern)
      ))
      .limit(limit);
  }

  const vectorStr = `[${embedding.join(',')}]`;
  const results = await db.select({
    id: contraindications.id,
    hoat_chat: contraindications.hoat_chat,
    dieu_kien: contraindications.dieu_kien,
    loai: contraindications.loai,
    muc_do: contraindications.muc_do,
    ly_do_ngan_gon: contraindications.ly_do_ngan_gon,
    distance: sql<number>`(${contraindications.embedding} <=> ${vectorStr}::vector)`
  })
  .from(contraindications)
  .orderBy(sql`(${contraindications.embedding} <=> ${vectorStr}::vector) ASC`)
  .limit(limit);

  return results;
}

// 3. Semantic Red Flags Search
export async function searchRedFlagsSemantic(symptom: string, limit = 5) {
  console.log(`[Semantic Search] Searching red flags for symptom: "${symptom}"`);
  const embedding = await generateQueryEmbedding(symptom);

  if (!embedding) {
    console.warn('[Semantic Search] Falling back to text-based search for red flags.');
    const pattern = `%${symptom}%`;
    return await db.select()
      .from(redFlags)
      .where(like(redFlags.tu_khoa_trieu_chung, pattern))
      .limit(limit);
  }

  const vectorStr = `[${embedding.join(',')}]`;
  const results = await db.select({
    id: redFlags.id,
    tu_khoa_trieu_chung: redFlags.tu_khoa_trieu_chung,
    muc_do: redFlags.muc_do,
    hanh_dong: redFlags.hanh_dong,
    thong_diep: redFlags.thong_diep,
    distance: sql<number>`(${redFlags.embedding} <=> ${vectorStr}::vector)`
  })
  .from(redFlags)
  .orderBy(sql`(${redFlags.embedding} <=> ${vectorStr}::vector) ASC`)
  .limit(limit);

  return results;
}
