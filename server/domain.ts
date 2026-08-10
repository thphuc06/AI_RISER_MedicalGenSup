export interface Product {
  sku: string;
  ten_san_pham: string;
  hoat_chat: string;
  ham_luong_mg: string;
  dang_bao_che: string;
  nhom: string;
  rx_status: string;
  gia: number;
  ton_kho: number;
  chi_dinh_ngan: string;
  cach_dung_co_ban: string;
}

export interface Contraindication {
  hoat_chat: string;
  dieu_kien: string;
  loai: string;
  muc_do: string;
  ly_do_ngan_gon: string;
}

export interface MaxDose {
  hoat_chat: string;
  nhom_tuoi: string;
  max_mg_ngay: number;
}

export interface RedFlag {
  tu_khoa_trieu_chung: string;
  muc_do: string;
  hanh_dong: string;
  thong_diep: string;
}

export interface SafetyData {
  products: Product[];
  contraindications: Contraindication[];
  maxDoses: MaxDose[];
  redFlags: RedFlag[];
  isHealthy: boolean;
  lastSuccessfulRefresh: Date | null;
  lastRefreshAttempt: Date | null;
  lastError: string | null;
}

export interface HealthProfile {
  benh_nen?: string | string[];
  conditions?: string | string[];
  doi_tuong?: string | string[];
  di_ung?: string | string[];
  nhom_tuoi?: string;
  do_tuoi?: string;
  [key: string]: unknown;
}

export interface CartLine {
  sku: string;
  quantity: number;
  source?: string;
}

export type SafetyVerdict = 'ALLOW' | 'WARN' | 'BLOCK' | 'STOP_SELL' | 'ESCALATE';

export interface SafetyResult {
  verdict: SafetyVerdict;
  reason?: string;
}
