import type { CartLine, HealthProfile, Product, SafetyData, SafetyResult } from './domain.js';

export function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCode(value: string): string {
  return normalizeText(value).replace(/\s+/g, '_');
}

export function parseActiveIngredients(value: string): string[] {
  return String(value || '')
    .split(';')
    .map(normalizeText)
    .filter(Boolean);
}

function parseMg(value: string | number): number | null {
  const text = String(value ?? '').trim().toLowerCase().replace(',', '.');
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(mg|g)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] === 'g' ? amount * 1000 : amount;
}

function ingredientDoses(product: Product): Map<string, number | null> {
  const ingredients = parseActiveIngredients(product.hoat_chat);
  const rawDoses = String(product.ham_luong_mg || '').split(';').map((value) => value.trim());
  const result = new Map<string, number | null>();

  if (ingredients.length !== rawDoses.length) {
    for (const ingredient of ingredients) result.set(ingredient, null);
    return result;
  }

  ingredients.forEach((ingredient, index) => result.set(ingredient, parseMg(rawDoses[index])));
  return result;
}

export function mapToConditionCode(inputStr: string): string {
  const norm = normalizeText(inputStr);
  if (!norm) return '';
  if (norm.includes('tieu duong') || norm.includes('dai thao duong') || norm.includes('duong huyet') || norm.includes('diabetes')) {
    return 'dai_thao_duong';
  }
  if (norm.includes('cao huyet ap') || norm.includes('tang huyet ap') || norm.includes('huyet ap') || norm.includes('hypertension')) {
    return 'tang_huyet_ap_nang';
  }
  if (norm.includes('da day') || norm.includes('ta trang') || norm.includes('loet') || norm.includes('ulcer')) {
    return 'loet_da_day_ta_trang';
  }
  return normalizeCode(inputStr);
}

export function mapToAgeGroup(inputVal: unknown): { nhom_tuoi: string | null; do_tuoi: string | null } {
  if (inputVal === null || inputVal === undefined || inputVal === '') {
    return { nhom_tuoi: null, do_tuoi: null };
  }
  const str = String(inputVal).trim();
  const norm = normalizeText(str);

  if (norm === 'nguoi_lon' || norm === 'nguoi lon' || norm === 'truong thanh' || norm === 'adult') {
    return { nhom_tuoi: 'nguoi_lon', do_tuoi: str.includes('tuổi') ? str : `${str} tuổi` };
  }
  if (norm === 'tre_em' || norm === 'tre em' || norm === 'em be' || norm === 'be' || norm === 'child') {
    return { nhom_tuoi: 'tre_em', do_tuoi: str.includes('tuổi') ? str : `${str} tuổi` };
  }
  if (norm === 'nguoi_cao_tuoi' || norm === 'nguoi cao tuoi' || norm === 'nguoi gia' || norm === 'elderly' || norm === 'senior') {
    return { nhom_tuoi: 'nguoi_cao_tuoi', do_tuoi: str.includes('tuổi') ? str : `${str} tuổi` };
  }

  const match = str.match(/\d+/);
  if (match) {
    const age = parseInt(match[0], 10);
    if (!isNaN(age)) {
      const display = str.includes('tuổi') ? str : `${age} tuổi`;
      if (age < 12) return { nhom_tuoi: 'tre_em', do_tuoi: display };
      if (age >= 60) return { nhom_tuoi: 'nguoi_cao_tuoi', do_tuoi: display };
      return { nhom_tuoi: 'nguoi_lon', do_tuoi: display };
    }
  }

  return { nhom_tuoi: normalizeCode(str) || null, do_tuoi: str };
}

function profileValues(profile: HealthProfile | null): string[] {
  if (!profile) return [];
  const values: string[] = [];
  for (const field of ['benh_nen', 'conditions', 'doi_tuong', 'di_ung'] as const) {
    const value = profile[field];
    if (Array.isArray(value)) values.push(...value.map(String));
    else if (typeof value === 'string') values.push(...value.split(/[;,]/));
  }
  const result: string[] = [];
  for (const raw of values) {
    const item = raw.trim();
    if (!item) continue;
    const mapped = mapToConditionCode(item);
    if (mapped) result.push(mapped);
    const code = normalizeCode(item);
    if (code && code !== mapped) result.push(code);
  }
  return result;
}

function ageGroup(profile: HealthProfile | null): string | null {
  if (!profile) return null;
  const value = profile.nhom_tuoi || profile.do_tuoi;
  const mapped = mapToAgeGroup(value);
  return mapped.nhom_tuoi;
}

export interface EvaluateSafetyInput {
  cart: CartLine[];
  healthProfile: HealthProfile | null;
  confirmedTranscript: string;
  safetyData: SafetyData;
}

export function evaluateSafety(input: EvaluateSafetyInput): SafetyResult {
  const { cart, healthProfile, confirmedTranscript, safetyData } = input;
  if (!safetyData.isHealthy) {
    return { verdict: 'BLOCK', reason: `Dữ liệu an toàn không khả dụng: ${safetyData.lastError || 'chưa tải thành công'}` };
  }

  const transcript = normalizeText(confirmedTranscript);
  let escalationReason = '';
  for (const rule of safetyData.redFlags) {
    const matched = rule.tu_khoa_trieu_chung
      .split(';')
      .map(normalizeText)
      .filter(Boolean)
      .some((keyword) => transcript.includes(keyword));
    if (!matched) continue;

    const action = rule.hanh_dong.trim().toUpperCase();
    const reason = rule.thong_diep || `Phát hiện dấu hiệu cảnh báo: ${rule.tu_khoa_trieu_chung}`;
    if (action === 'STOP_SELL') return { verdict: 'STOP_SELL', reason };
    if (action === 'REFUSE_RX') return { verdict: 'BLOCK', reason };
    if (action === 'ESCALATE') escalationReason = reason;
  }

  const productBySku = new Map(safetyData.products.map((product) => [product.sku.toLowerCase(), product]));
  const resolved: Array<{ line: CartLine; product: Product }> = [];
  for (const line of cart) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return { verdict: 'BLOCK', reason: `Số lượng không hợp lệ cho SKU ${line.sku}.` };
    }
    const product = productBySku.get(line.sku.toLowerCase());
    if (!product || product.rx_status.trim().toUpperCase() === 'RX') {
      return { verdict: 'BLOCK', reason: `SKU ${line.sku} không thuộc danh mục OTC khả dụng.` };
    }
    resolved.push({ line, product });
  }

  const ingredientSkus = new Map<string, Set<string>>();
  for (const { product } of resolved) {
    for (const ingredient of parseActiveIngredients(product.hoat_chat)) {
      const skus = ingredientSkus.get(ingredient) || new Set<string>();
      skus.add(product.sku.toLowerCase());
      ingredientSkus.set(ingredient, skus);
    }
  }
  for (const [ingredient, skus] of ingredientSkus) {
    if (skus.size > 1) {
      return { verdict: 'BLOCK', reason: `Hai sản phẩm này cùng chứa ${ingredient}, dùng chung có thể quá liều.` };
    }
  }

  // EXPLICIT ACTIVE INGREDIENT ALLERGY RULE:
  // Direct check for ingredient-level allergies in health profile (e.g. Di ung aspirin + San pham chua aspirin -> BLOCK)
  const rawAllergies: string[] = [];
  if (healthProfile) {
    const diUng = healthProfile.di_ung || (healthProfile as any).allergies;
    if (Array.isArray(diUng)) rawAllergies.push(...diUng.map(String));
    else if (typeof diUng === 'string') rawAllergies.push(...diUng.split(/[;,]/));
  }
  const userAllergies = rawAllergies.map((a) => normalizeText(a)).filter(Boolean);

  if (userAllergies.length > 0) {
    for (const { product } of resolved) {
      const ingredients = parseActiveIngredients(product.hoat_chat);
      for (const ingredient of ingredients) {
        for (const allergy of userAllergies) {
          const normAllergy = normalizeText(allergy);
          const normIng = normalizeText(ingredient);
          if (normIng && normAllergy && (normIng === normAllergy || normIng.includes(normAllergy) || normAllergy.includes(normIng))) {
            return {
              verdict: 'BLOCK',
              reason: `Chống chỉ định dị ứng: Hồ sơ sức khỏe cho biết người dùng dị ứng với '${allergy}', sản phẩm ${product.ten_san_pham} (SKU: ${product.sku}) có chứa hoạt chất '${ingredient}'.`,
            };
          }
        }
      }
    }
  }

  const conditions = new Set(profileValues(healthProfile));
  let warningReason = '';
  for (const { product } of resolved) {
    const ingredients = new Set(parseActiveIngredients(product.hoat_chat));
    for (const rule of safetyData.contraindications) {
      if (!ingredients.has(normalizeText(rule.hoat_chat)) || !conditions.has(normalizeCode(rule.dieu_kien))) continue;
      if (rule.muc_do.trim().toUpperCase() === 'BLOCK') {
        return { verdict: 'BLOCK', reason: rule.ly_do_ngan_gon };
      }
      if (rule.muc_do.trim().toUpperCase() === 'WARN') warningReason = rule.ly_do_ngan_gon;
    }
  }

  const group = ageGroup(healthProfile);
  const totals = new Map<string, number>();
  for (const { line, product } of resolved) {
    const doses = ingredientDoses(product);
    for (const [ingredient, dose] of doses) {
      const hasRules = safetyData.maxDoses.some((rule) => normalizeText(rule.hoat_chat) === ingredient);
      if (hasRules && dose === null) {
        return { verdict: 'BLOCK', reason: `Không thể diễn giải an toàn hàm lượng của ${product.sku}.` };
      }
      if (dose !== null) totals.set(ingredient, (totals.get(ingredient) || 0) + dose * line.quantity);
    }
  }

  for (const [ingredient, total] of totals) {
    const ingredientRules = safetyData.maxDoses.filter((rule) => normalizeText(rule.hoat_chat) === ingredient);
    if (ingredientRules.length === 0) continue;
    if (!group) return { verdict: 'BLOCK', reason: `Vui lòng chọn nhóm tuổi trước khi thêm sản phẩm này.` };
    const rule = ingredientRules.find((candidate) => normalizeCode(candidate.nhom_tuoi) === group);
    if (!rule) return { verdict: 'BLOCK', reason: `Không có quy tắc liều ${ingredient} cho nhóm tuổi ${group}.` };
    if (total > rule.max_mg_ngay) {
      return { verdict: 'BLOCK', reason: `${ingredient} ${total}mg/ngày vượt mức ${rule.max_mg_ngay}mg/ngày.` };
    }
  }

  if (warningReason) return { verdict: 'WARN', reason: warningReason };
  if (escalationReason) return { verdict: 'ESCALATE', reason: escalationReason };
  return { verdict: 'ALLOW' };
}
