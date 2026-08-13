import Papa from 'papaparse';
import type { Contraindication, MaxDose, Product, RedFlag, SafetyData } from './domain.js';
import { syncSheetsToPostgres } from './syncService.js';
import { db } from '../src/db/index.js';
import { products, contraindications, maxDoses, redFlags } from '../src/db/schema.js';

const SPREADSHEET_ID = process.env.PHARMACY_SPREADSHEET_ID || '1qDdFaMA-4KB7bqiGR-WqjfRN6xmHQtb_BQx3DZXtgak';
const FETCH_TIMEOUT_MS = Number(process.env.SHEETS_FETCH_TIMEOUT_MS || 30_000);

type Row = Record<string, unknown>;
export type SheetName = 'Products' | 'Contraindications' | 'Max_Dose' | 'Red_Flags';
export type SheetFetcher = (sheetName: SheetName) => Promise<string>;

const requiredHeaders: Record<SheetName, string[]> = {
  Products: ['sku', 'ten_san_pham', 'hoat_chat', 'ham_luong_mg', 'dang_bao_che', 'nhom', 'rx_status', 'gia', 'ton_kho', 'chi_dinh_ngan', 'cach_dung_co_ban'],
  Contraindications: ['hoat_chat', 'dieu_kien', 'loai', 'muc_do', 'ly_do_ngan_gon'],
  Max_Dose: ['hoat_chat', 'nhom_tuoi', 'max_mg_ngay'],
  Red_Flags: ['tu_khoa_trieu_chung', 'muc_do', 'hanh_dong', 'thong_diep'],
};

const legacyAliases: Partial<Record<SheetName, Record<string, string[]>>> = {
  Products: { sku: ['sku_id'], ten_san_pham: ['product_name'], hoat_chat: ['active_ingredient'], ham_luong_mg: ['dosage'], dang_bao_che: ['unit'], gia: ['price'], chi_dinh_ngan: ['indication'], cach_dung_co_ban: ['basic_usage'] },
  Contraindications: { hoat_chat: ['active_ingredient'], dieu_kien: ['condition_or_drug'], muc_do: ['risk_level'], ly_do_ngan_gon: ['warning_message'], loai: ['type'] },
  Max_Dose: { hoat_chat: ['active_ingredient'], nhom_tuoi: ['age_group'], max_mg_ngay: ['max_daily_dose'] },
  Red_Flags: { tu_khoa_trieu_chung: ['symptom'], muc_do: ['risk_level'], hanh_dong: ['action_required'], thong_diep: ['emergency_note'] },
};

const emptyState = (): SafetyData & { filteredRxCount: number; isLoading: boolean } => ({
  products: [], contraindications: [], maxDoses: [], redFlags: [], filteredRxCount: 0,
  isHealthy: false, isLoading: false, lastSuccessfulRefresh: null, lastRefreshAttempt: null, lastError: null,
});

function key(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function value(row: Row, sheet: SheetName, canonical: string): unknown {
  if (canonical in row) return row[canonical];
  for (const alias of legacyAliases[sheet]?.[canonical] || []) if (alias in row) return row[alias];
  return undefined;
}

function stringValue(row: Row, sheet: SheetName, field: string): string {
  return String(value(row, sheet, field) ?? '').trim();
}

function numberValue(row: Row, sheet: SheetName, field: string): number {
  const parsed = Number(String(value(row, sheet, field) ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`${sheet}: invalid numeric value in ${field}`);
  return parsed;
}

export function parseSheetCsv(sheet: SheetName, csv: string): Row[] {
  const result = Papa.parse<Row>(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: key });
  if (result.errors.length) throw new Error(`${sheet}: CSV parse error: ${result.errors[0].message}`);
  const fields = new Set(result.meta.fields || []);
  const missing = requiredHeaders[sheet].filter((canonical) => {
    if (fields.has(canonical)) return false;
    return !(legacyAliases[sheet]?.[canonical] || []).some((alias) => fields.has(alias));
  });
  if (missing.length) throw new Error(`${sheet}: missing required columns: ${missing.join(', ')}`);
  return result.data.map((raw) => Object.fromEntries(Object.entries(raw).map(([name, item]) => [key(name), item])));
}

function mapProducts(rows: Row[]): { products: Product[]; filteredRxCount: number } {
  let filteredRxCount = 0;
  const products: Product[] = [];
  for (const row of rows) {
    const rxStatus = stringValue(row, 'Products', 'rx_status').toUpperCase();
    if (rxStatus === 'RX') { filteredRxCount++; continue; }
    const product: Product = {
      sku: stringValue(row, 'Products', 'sku'), ten_san_pham: stringValue(row, 'Products', 'ten_san_pham'),
      hoat_chat: stringValue(row, 'Products', 'hoat_chat'), ham_luong_mg: stringValue(row, 'Products', 'ham_luong_mg'),
      dang_bao_che: stringValue(row, 'Products', 'dang_bao_che'), nhom: stringValue(row, 'Products', 'nhom'),
      rx_status: rxStatus, gia: numberValue(row, 'Products', 'gia'), ton_kho: numberValue(row, 'Products', 'ton_kho'),
      chi_dinh_ngan: stringValue(row, 'Products', 'chi_dinh_ngan'),
      cach_dung_co_ban: stringValue(row, 'Products', 'cach_dung_co_ban'),
    };
    if (!product.sku || !product.hoat_chat || !product.ham_luong_mg || !product.rx_status) throw new Error('Products: empty mandatory safety value');
    products.push(product);
  }
  return { products, filteredRxCount };
}

function mapContraindications(rows: Row[]): Contraindication[] {
  return rows.map((row) => ({ hoat_chat: stringValue(row, 'Contraindications', 'hoat_chat'), dieu_kien: stringValue(row, 'Contraindications', 'dieu_kien'), loai: stringValue(row, 'Contraindications', 'loai'), muc_do: stringValue(row, 'Contraindications', 'muc_do'), ly_do_ngan_gon: stringValue(row, 'Contraindications', 'ly_do_ngan_gon') }));
}

function mapMaxDoses(rows: Row[]): MaxDose[] {
  return rows.map((row) => ({ hoat_chat: stringValue(row, 'Max_Dose', 'hoat_chat'), nhom_tuoi: stringValue(row, 'Max_Dose', 'nhom_tuoi'), max_mg_ngay: numberValue(row, 'Max_Dose', 'max_mg_ngay') }));
}

function mapRedFlags(rows: Row[]): RedFlag[] {
  return rows.map((row) => ({ tu_khoa_trieu_chung: stringValue(row, 'Red_Flags', 'tu_khoa_trieu_chung'), muc_do: stringValue(row, 'Red_Flags', 'muc_do'), hanh_dong: stringValue(row, 'Red_Flags', 'hanh_dong'), thong_diep: stringValue(row, 'Red_Flags', 'thong_diep') }));
}

async function fetchSheetCsv(sheetName: SheetName): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${sheetName}: HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timeout); }
}

export class SheetsService {
  private state = emptyState();
  constructor(private readonly fetcher: SheetFetcher = fetchSheetCsv) {}

  async refresh(): Promise<ReturnType<SheetsService['getStatus']>> {
    this.state.isLoading = true;
    this.state.lastRefreshAttempt = new Date();
    try {
      const names: SheetName[] = ['Products', 'Contraindications', 'Max_Dose', 'Red_Flags'];
      const [productsCsv, contraindicationsCsv, maxDoseCsv, redFlagsCsv] = await Promise.all(names.map(this.fetcher));
      const productResult = mapProducts(parseSheetCsv('Products', productsCsv));
      this.state = {
        ...this.state, ...productResult,
        contraindications: mapContraindications(parseSheetCsv('Contraindications', contraindicationsCsv)),
        maxDoses: mapMaxDoses(parseSheetCsv('Max_Dose', maxDoseCsv)),
        redFlags: mapRedFlags(parseSheetCsv('Red_Flags', redFlagsCsv)),
        isHealthy: true, isLoading: false, lastSuccessfulRefresh: new Date(), lastError: null,
      };

      // Synchronize fetched data to PostgreSQL database asynchronously
      try {
        await syncSheetsToPostgres({
          products: this.state.products,
          contraindications: this.state.contraindications,
          maxDoses: this.state.maxDoses,
          redFlags: this.state.redFlags,
        });
      } catch (syncErr) {
        console.error('[SheetsService] Failed to sync data to PostgreSQL, but in-memory cache is active:', syncErr);
      }
    } catch (error) {
      this.state.isLoading = false;
      this.state.lastError = error instanceof Error ? error.message : String(error);
      const hasCompleteCache = this.state.lastSuccessfulRefresh !== null && this.state.products.length > 0;
      this.state.isHealthy = hasCompleteCache;
      console.error('[SheetsService] Refresh failed:', this.state.lastError, hasCompleteCache ? '(retaining last-known-good cache)' : '(fail-closed)');
    }
    return this.getStatus();
  }

  getSafetyData(): SafetyData { return { ...this.state, products: [...this.state.products], contraindications: [...this.state.contraindications], maxDoses: [...this.state.maxDoses], redFlags: [...this.state.redFlags] }; }
  getStatus() { return { productsCount: this.state.products.length, contraindicationsCount: this.state.contraindications.length, maxDosesCount: this.state.maxDoses.length, redFlagsCount: this.state.redFlags.length, filteredRxCount: this.state.filteredRxCount, lastSuccessfulRefresh: this.state.lastSuccessfulRefresh, lastRefreshAttempt: this.state.lastRefreshAttempt, isHealthy: this.state.isHealthy, latestRefreshHealthy: this.state.lastError === null, isLoading: this.state.isLoading, lastError: this.state.lastError }; }
}

const service = new SheetsService();
let refreshTimer: NodeJS.Timeout | null = null;

export async function reloadSafetyDataFromPostgres(): Promise<boolean> {
  try {
    const dbProducts = await db.select().from(products);
    const dbContraindications = await db.select().from(contraindications);
    const dbMaxDoses = await db.select().from(maxDoses);
    const dbRedFlags = await db.select().from(redFlags);

    const safetyData = {
      products: dbProducts.map(p => ({
        sku: p.sku,
        ten_san_pham: p.ten_san_pham,
        hoat_chat: p.hoat_chat,
        ham_luong_mg: p.ham_luong_mg || '',
        dang_bao_che: p.dang_bao_che || '',
        nhom: p.nhom || '',
        rx_status: p.rx_status,
        gia: p.gia,
        ton_kho: p.ton_kho,
        chi_dinh_ngan: p.chi_dinh_ngan,
        cach_dung_co_ban: p.cach_dung_co_ban,
      })),
      contraindications: dbContraindications.map(c => ({
        hoat_chat: c.hoat_chat,
        dieu_kien: c.dieu_kien,
        loai: c.loai || '',
        muc_do: c.muc_do || '',
        ly_do_ngan_gon: c.ly_do_ngan_gon || '',
      })),
      maxDoses: dbMaxDoses.map(md => ({
        hoat_chat: md.hoat_chat,
        nhom_tuoi: md.nhom_tuoi,
        max_mg_ngay: md.max_mg_ngay,
      })),
      redFlags: dbRedFlags.map(rf => ({
        tu_khoa_trieu_chung: rf.tu_khoa_trieu_chung,
        muc_do: rf.muc_do || '',
        hanh_dong: rf.hanh_dong || '',
        thong_diep: rf.thong_diep || '',
      })),
      isHealthy: true,
      isLoading: false,
      lastSuccessfulRefresh: new Date(),
      lastRefreshAttempt: new Date(),
      lastError: null,
      filteredRxCount: 0,
    };

    overrideSafetyData(safetyData);
    console.log('[Postgres-Sync] In-memory safety data reloaded from Postgres successfully!');
    return true;
  } catch (error) {
    console.error('[Postgres-Sync] Failed to reload safety data from Postgres:', error);
    return false;
  }
}

export async function startPeriodicRefresh(intervalMinutes = 10): Promise<void> {
  const loaded = await reloadSafetyDataFromPostgres();
  if (loaded) {
    console.log('[PharmacyData] Successfully initialized safety data cache directly from Postgres database!');
  } else {
    console.error('[PharmacyData] Failed to load safety data from Postgres database.');
  }
}
export const loadAllSheets = async () => {
  await reloadSafetyDataFromPostgres();
  return service.getStatus();
};
export const getProducts = () => service.getSafetyData().products;
export const getContraindications = () => service.getSafetyData().contraindications;
export const getMaxDoses = () => service.getSafetyData().maxDoses;
export const getRedFlags = () => service.getSafetyData().redFlags;
export const getSafetyData = () => service.getSafetyData();
export const getValidConditions = () => Array.from(new Set(service.getSafetyData().contraindications.map((item) => item.dieu_kien.trim().toLowerCase()).filter(Boolean)));
export const getValidAgeGroups = () => Array.from(new Set(service.getSafetyData().maxDoses.map((item) => item.nhom_tuoi.trim().toLowerCase()).filter(Boolean)));
export const getCacheStatus = () => service.getStatus();
export function overrideSafetyData(data: any): void {
  (service as any).state = { ...data };
}
