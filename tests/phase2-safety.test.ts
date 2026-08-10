import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthProfileConfirmationGate, TranscriptActionGate } from '../server/actionGate.js';
import { applyCartOperation, cartDocumentId, healthProfileFromDocument } from '../server/cartService.js';
import type { SafetyData } from '../server/domain.js';
import { evaluateSafety } from '../server/safetyService.js';
import { parseSheetCsv, SheetsService, type SheetName } from '../server/sheetsService.js';
import { resolveAppView } from '../src/routing.js';

const productsCsv = `sku,ten_san_pham,hoat_chat,ham_luong_mg,dang_bao_che,nhom,rx_status,gia,ton_kho,chi_dinh_ngan,cach_dung_co_ban
P1,Para A,paracetamol,500 mg,viên,giảm đau,OTC,1000,20,Sốt; đau đầu; đau nhức,Dùng theo nhãn
RX1,Kháng sinh mẫu,amoxicillin,500 mg,viên,kháng sinh,RX,2000,10,Nhiễm khuẩn,Theo toa`;
const contraCsv = `hoat_chat,dieu_kien,loai,muc_do,ly_do_ngan_gon
pseudoephedrine,tang_huyet_ap_nang,benh_nen,BLOCK,Không phù hợp với điều kiện trong hồ sơ`;
const maxCsv = `hoat_chat,nhom_tuoi,max_mg_ngay
paracetamol,nguoi_lon,4000
paracetamol,tre_em,1000`;
const redCsv = `tu_khoa_trieu_chung,muc_do,hanh_dong,thong_diep
đau ngực;khó thở,CAO,STOP_SELL,Hãy dừng mua và đi khám ngay`;

const baseData = (): SafetyData => ({
  products: [
    { sku: 'P1', ten_san_pham: 'Para A', hoat_chat: 'paracetamol', ham_luong_mg: '500', dang_bao_che: 'viên', nhom: 'giảm đau', rx_status: 'OTC', gia: 1000, ton_kho: 20, chi_dinh_ngan: 'Sốt; đau đầu; đau nhức', cach_dung_co_ban: 'Theo nhãn' },
    { sku: 'P2', ten_san_pham: 'Para B', hoat_chat: 'paracetamol', ham_luong_mg: '500', dang_bao_che: 'viên', nhom: 'giảm đau', rx_status: 'OTC', gia: 1000, ton_kho: 20, chi_dinh_ngan: 'Đau', cach_dung_co_ban: 'Theo nhãn' },
    { sku: 'P3', ten_san_pham: 'Decongestant', hoat_chat: 'pseudoephedrine', ham_luong_mg: '60', dang_bao_che: 'viên', nhom: 'cảm', rx_status: 'OTC', gia: 1000, ton_kho: 20, chi_dinh_ngan: 'Nghẹt mũi', cach_dung_co_ban: 'Theo nhãn' },
  ],
  contraindications: [{ hoat_chat: 'pseudoephedrine', dieu_kien: 'tang_huyet_ap_nang', loai: 'benh_nen', muc_do: 'BLOCK', ly_do_ngan_gon: 'Không phù hợp với điều kiện trong hồ sơ' }],
  maxDoses: [{ hoat_chat: 'paracetamol', nhom_tuoi: 'nguoi_lon', max_mg_ngay: 4000 }, { hoat_chat: 'paracetamol', nhom_tuoi: 'tre_em', max_mg_ngay: 1000 }],
  redFlags: [{ tu_khoa_trieu_chung: 'đau ngực;khó thở', muc_do: 'CAO', hanh_dong: 'STOP_SELL', thong_diep: 'Hãy dừng mua và đi khám ngay' }],
  isHealthy: true, lastSuccessfulRefresh: new Date(), lastRefreshAttempt: new Date(), lastError: null,
});

test('1. RX rows are removed during ingestion', async () => {
  const csv: Record<SheetName, string> = { Products: productsCsv, Contraindications: contraCsv, Max_Dose: maxCsv, Red_Flags: redCsv };
  const service = new SheetsService(async (name) => csv[name]);
  const status = await service.refresh();
  assert.equal(status.isHealthy, true);
  assert.equal(status.filteredRxCount, 1);
  assert.deepEqual(service.getSafetyData().products.map((p) => p.sku), ['P1']);
});

test('2. missing required safety column is rejected', () => {
  assert.throws(() => parseSheetCsv('Red_Flags', 'tu_khoa_trieu_chung,muc_do,hanh_dong\nđau ngực,CAO,STOP_SELL'), /thong_diep/);
});

test('3. two different paracetamol SKUs are blocked', () => {
  const result = evaluateSafety({ cart: [{ sku: 'P1', quantity: 1 }, { sku: 'P2', quantity: 1 }], healthProfile: { nhom_tuoi: 'nguoi_lon' }, confirmedTranscript: 'sốt', safetyData: baseData() });
  assert.equal(result.verdict, 'BLOCK');
});

test('4. exact contraindicated condition returns BLOCK', () => {
  const result = evaluateSafety({ cart: [{ sku: 'P3', quantity: 1 }], healthProfile: { benh_nen: ['tang_huyet_ap_nang'] }, confirmedTranscript: 'nghẹt mũi', safetyData: baseData() });
  assert.equal(result.verdict, 'BLOCK');
  assert.match(result.reason || '', /Không phù hợp/);
});

test('5. paracetamol above max_mg_ngay is blocked', () => {
  const result = evaluateSafety({ cart: [{ sku: 'P1', quantity: 9 }], healthProfile: { nhom_tuoi: 'nguoi_lon' }, confirmedTranscript: 'sốt', safetyData: baseData() });
  assert.equal(result.verdict, 'BLOCK');
});

test('6. max dose selects both ingredient and nhom_tuoi', () => {
  const adult = evaluateSafety({ cart: [{ sku: 'P1', quantity: 3 }], healthProfile: { nhom_tuoi: 'nguoi_lon' }, confirmedTranscript: 'sốt', safetyData: baseData() });
  const child = evaluateSafety({ cart: [{ sku: 'P1', quantity: 3 }], healthProfile: { nhom_tuoi: 'tre_em' }, confirmedTranscript: 'sốt', safetyData: baseData() });
  assert.equal(adult.verdict, 'ALLOW');
  assert.equal(child.verdict, 'BLOCK');
});

test('7. red flag normalization treats accented, unaccented and uppercase equally', () => {
  for (const transcript of ['đau ngực', 'dau nguc', 'ĐAU NGỰC', '  đau   ngực ']) {
    assert.equal(evaluateSafety({ cart: [], healthProfile: null, confirmedTranscript: transcript, safetyData: baseData() }).verdict, 'STOP_SELL');
  }
});

test('8. STOP_SELL prevents a cart candidate', () => {
  assert.equal(evaluateSafety({ cart: [{ sku: 'P1', quantity: 1 }], healthProfile: { nhom_tuoi: 'nguoi_lon' }, confirmedTranscript: 'khó thở', safetyData: baseData() }).verdict, 'STOP_SELL');
});

test('9. refresh failure marks data unhealthy and fails closed', async () => {
  const service = new SheetsService(async () => { throw new Error('network down'); });
  const status = await service.refresh();
  assert.equal(status.isHealthy, false);
  assert.equal(evaluateSafety({ cart: [], healthProfile: null, confirmedTranscript: '', safetyData: service.getSafetyData() }).verdict, 'BLOCK');
});

test('10. users have isolated cart document identifiers', () => {
  assert.notEqual(cartDocumentId('user-a'), cartDocumentId('user-b'));
});

test('11. quantity increment cannot bypass max dose safety', () => {
  const candidate = applyCartOperation([{ sku: 'P1', quantity: 8 }], { type: 'set_quantity', sku: 'P1', quantity: 9 });
  assert.equal(evaluateSafety({ cart: candidate, healthProfile: { nhom_tuoi: 'nguoi_lon' }, confirmedTranscript: 'sốt', safetyData: baseData() }).verdict, 'BLOCK');
});

test('12. reconnect candidate starts from persisted cart state', () => {
  const persisted = [{ sku: 'P1', quantity: 1 }];
  const candidate = applyCartOperation(persisted, { type: 'add', sku: 'P2', quantity: 1 });
  assert.equal(evaluateSafety({ cart: candidate, healthProfile: { nhom_tuoi: 'nguoi_lon' }, confirmedTranscript: 'đau', safetyData: baseData() }).verdict, 'BLOCK');
});

test('13. unconfirmed transcript cannot enable mutations', () => {
  const gate = new TranscriptActionGate();
  gate.markPending();
  assert.equal(gate.canMutate(), false);
  gate.confirm('Tôi bị sốt');
  assert.equal(gate.canMutate(), true);
});

test('14. first health update proposal cannot persist without a later confirmation', () => {
  const gate = new HealthProfileConfirmationGate();
  gate.propose({ field: 'benh_nen', value: 'tang_huyet_ap_nang' });
  assert.equal(gate.confirm('tôi bị cao huyết áp'), null);
  assert.deepEqual(gate.confirm('xác nhận'), { field: 'benh_nen', value: 'tang_huyet_ap_nang' });
});

test('15. missing health profile is empty/unknown, never fabricated', () => {
  assert.deepEqual(healthProfileFromDocument(false), { status: 'missing', profile: null });
});

test('16. root route resolves to customer UI', () => assert.equal(resolveAppView('/'), 'customer'));
test('17. pharmacist route resolves directly on refresh', () => assert.equal(resolveAppView('/duoc-si'), 'pharmacist'));
