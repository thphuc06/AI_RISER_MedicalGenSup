import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, customType } from 'drizzle-orm/pg-core';

// Custom type for pgvector
export const pgVector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(3072)';
  },
  toDriver(value: number[] | null | undefined): string | null {
    if (!value || !Array.isArray(value)) {
      return null;
    }
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value !== 'string') {
      return [];
    }
    return value.replace(/[\[\]]/g, '').split(',').map(Number);
  }
});

// Users table (Firebase Auth linked)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Products table with vector embedding
export const products = pgTable('products', {
  sku: text('sku').primaryKey(),
  ten_san_pham: text('ten_san_pham').notNull(),
  hoat_chat: text('hoat_chat').notNull(),
  ham_luong_mg: text('ham_luong_mg'),
  dang_bao_che: text('dang_bao_che'),
  nhom: text('nhom'),
  rx_status: text('rx_status').notNull(),
  gia: integer('gia').notNull(),
  ton_kho: integer('ton_kho').notNull(),
  chi_dinh_ngan: text('chi_dinh_ngan').notNull(),
  cach_dung_co_ban: text('cach_dung_co_ban').notNull(),
  embedding: pgVector('embedding'), // semantic search over indication + product name
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Contraindications table with vector embedding
export const contraindications = pgTable('contraindications', {
  id: serial('id').primaryKey(),
  hoat_chat: text('hoat_chat').notNull(),
  dieu_kien: text('dieu_kien').notNull(),
  loai: text('loai'),
  muc_do: text('muc_do'),
  ly_do_ngan_gon: text('ly_do_ngan_gon'),
  embedding: pgVector('embedding'), // semantic search over condition/symptom matching
});

// Max doses table
export const maxDoses = pgTable('max_doses', {
  id: serial('id').primaryKey(),
  hoat_chat: text('hoat_chat').notNull(),
  nhom_tuoi: text('nhom_tuoi').notNull(),
  max_mg_ngay: integer('max_mg_ngay').notNull(),
});

// Red flags table with vector embedding
export const redFlags = pgTable('red_flags', {
  id: serial('id').primaryKey(),
  tu_khoa_trieu_chung: text('tu_khoa_trieu_chung').notNull(),
  muc_do: text('muc_do'),
  hanh_dong: text('hanh_dong'),
  thong_diep: text('thong_diep'),
  embedding: pgVector('embedding'), // semantic search over symptom descriptions
});
