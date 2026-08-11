import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthProfileConfirmationGate, TranscriptActionGate } from '../server/actionGate.js';
import { applyCartOperation, cartDocumentId, healthProfileFromDocument, mutateCart } from '../server/cartService.js';
import type { SafetyData } from '../server/domain.js';
import { checkConditionMatch, evaluateSafety, mapToAgeGroup, mapToConditionCode, stringSimilarity, tokenOverlapRatio } from '../server/safetyService.js';
import { parseSheetCsv, SheetsService, type SheetName, overrideSafetyData } from '../server/sheetsService.js';
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

test('9. first ever refresh failure remains fail-closed', async () => {
  const service = new SheetsService(async () => { throw new Error('network down'); });
  const status = await service.refresh();
  assert.equal(status.isHealthy, false);
  assert.equal(status.productsCount, 0);
  assert.equal(status.lastError, 'network down');
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

test('18. manual add does not require transcript but voice_ai add is blocked if not confirmed', async () => {
  overrideSafetyData(baseData());
  const userId = 'test_user_' + Date.now();
  
  // 1. voice_ai add should fail / return BLOCK because there is no confirmedTranscript in the cart document yet
  const voiceResult = await mutateCart(userId, { type: 'add', sku: 'P1', quantity: 1 }, 'voice_ai');
  assert.equal(voiceResult.success, false);
  assert.equal(voiceResult.verdict, 'BLOCK');
  assert.match(voiceResult.reason || '', /Chưa có transcript được server xác nhận/);

  // 2. manual_catalog add should proceed to evaluate safety.
  // Since we don't have a health profile (and thus no nhom_tuoi), adding 'P1' (paracetamol) which has max dose rules
  // will fail with the safety rule "Vui lòng chọn nhóm tuổi trước khi thêm sản phẩm này."
  // but NOT with "Chưa có transcript được server xác nhận."
  const manualResult = await mutateCart(userId, { type: 'add', sku: 'P1', quantity: 1 }, 'manual_catalog');
  assert.equal(manualResult.success, false);
  assert.equal(manualResult.verdict, 'BLOCK');
  assert.equal(manualResult.reason, 'Vui lòng chọn nhóm tuổi trước khi thêm sản phẩm này.');
});

test('19. successful initial refresh followed by refresh abort keeps old complete cache usable and products available', async () => {
  let failRefresh = false;
  const csv: Record<SheetName, string> = { Products: productsCsv, Contraindications: contraCsv, Max_Dose: maxCsv, Red_Flags: redCsv };
  const service = new SheetsService(async (name) => {
    if (failRefresh) throw new Error('This operation was aborted');
    return csv[name];
  });

  // Successful initial refresh
  const status1 = await service.refresh();
  assert.equal(status1.isHealthy, true);
  assert.equal(status1.latestRefreshHealthy, true);
  assert.equal(status1.productsCount, 1);
  assert.equal(status1.lastError, null);
  assert.notEqual(status1.lastSuccessfulRefresh, null);

  // Following refresh aborts
  failRefresh = true;
  const status2 = await service.refresh();

  // Old complete cache remains usable & products remain available
  assert.equal(status2.isHealthy, true);
  assert.equal(status2.latestRefreshHealthy, false);
  assert.equal(status2.productsCount, 1);
  assert.equal(status2.lastError, 'This operation was aborted');
  assert.equal(service.getSafetyData().products.length, 1);
  assert.equal(evaluateSafety({ cart: [{ sku: 'P1', quantity: 1 }], healthProfile: { nhom_tuoi: 'nguoi_lon' }, confirmedTranscript: 'sốt', safetyData: service.getSafetyData() }).verdict, 'ALLOW');
});

test('20. health profile normalizer maps Vietnamese disease terms and age inputs accurately', () => {
  const profileWithVietnameseText = {
    benh_nen: 'Tiểu đường, Cao huyết áp',
    do_tuoi: '40 tuổi',
  };
  const dummyData: SafetyData = {
    products: [{ sku: 'P1', ten_san_pham: 'Para A', hoat_chat: 'paracetamol', ham_luong_mg: '500 mg', dang_bao_che: 'viên', nhom: 'giảm đau', rx_status: 'OTC', gia: 1000, ton_kho: 20, chi_dinh_ngan: 'Sốt', cach_dung_co_ban: 'Dùng theo nhãn' }],
    contraindications: [],
    maxDoses: [{ hoat_chat: 'paracetamol', nhom_tuoi: 'nguoi_lon', max_mg_ngay: 4000 }],
    redFlags: [],
    isHealthy: true,
    lastSuccessfulRefresh: new Date(),
    lastRefreshAttempt: new Date(),
    lastError: null,
  };
  const safety = evaluateSafety({
    cart: [{ sku: 'P1', quantity: 1 }],
    healthProfile: profileWithVietnameseText,
    confirmedTranscript: 'nhức đầu',
    safetyData: dummyData,
  });
  assert.equal(safety.verdict, 'ALLOW');

  const mappedAge40 = mapToAgeGroup('40 tuổi');
  assert.equal(mappedAge40.nhom_tuoi, 'nguoi_lon');

  const mappedAge68 = mapToAgeGroup('68');
  assert.equal(mappedAge68.nhom_tuoi, 'nguoi_cao_tuoi');

  const mappedCondition = mapToConditionCode('tiểu đường');
  assert.equal(mappedCondition, 'dai_thao_duong');
});

test('25. direct active ingredient allergy blocks product with matching ingredient', () => {
  const dummyData: SafetyData = {
    products: [{ sku: 'ASP1', ten_san_pham: 'Aspirin 500', hoat_chat: 'aspirin', ham_luong_mg: '500 mg', dang_bao_che: 'viên', nhom: 'giảm đau', rx_status: 'OTC', gia: 1000, ton_kho: 20, chi_dinh_ngan: 'Đau nhức', cach_dung_co_ban: 'Uống sau ăn' }],
    contraindications: [], // Empty contraindications sheet
    maxDoses: [],
    redFlags: [],
    isHealthy: true,
    lastSuccessfulRefresh: new Date(),
    lastRefreshAttempt: new Date(),
    lastError: null,
  };
  const safety = evaluateSafety({
    cart: [{ sku: 'ASP1', quantity: 1 }],
    healthProfile: { di_ung: ['aspirin'], nhom_tuoi: 'nguoi_lon' },
    confirmedTranscript: 'đau đầu',
    safetyData: dummyData,
  });
  assert.equal(safety.verdict, 'BLOCK');
  assert.match(safety.reason || '', /Chống chỉ định dị ứng/);
  assert.match(safety.reason || '', /aspirin/);
});

test('26. fuzzy condition matching dynamically matches un-indexed disease variations', () => {
  assert.equal(checkConditionMatch('viêm loét dạ dày tá tràng', 'loet_da_day_ta_trang'), true);
  assert.equal(checkConditionMatch('đau dạ dày', 'loet_da_day_ta_trang'), true);
  assert.equal(checkConditionMatch('suy gan cấp', 'suy_gan_nang'), true);
  assert.equal(tokenOverlapRatio('viêm loét dạ dày', 'loet_da_day_ta_trang') >= 0.5, true);
  assert.equal(stringSimilarity('loet da day', 'loet da day ta trang') > 0.5, true);
});
