import { PriorityTier } from '../types';

export interface TriageInput {
  age?: number | string;
  medicalHistory?: string[];
  allergies?: string[];
  currentMeds?: string[];
  specialConditions?: string[];
  symptoms?: string;
  safetyVerdict?: string;
  safetyReason?: string | null;
  items?: Array<{ name: string; isWarning?: boolean; warningMessage?: string }>;
}

export interface TriageResult {
  riskScore: number; // 0 - 100
  priorityTier: PriorityTier;
  priority: 'Cần gọi' | 'Tiêu chuẩn' | 'Nhanh';
  riskFactors: string[];
}

export function computeOrderTriageScore(params: TriageInput): TriageResult {
  let score = 10; // Base score
  const factors: string[] = [];

  const ageNum = Number(params.age) || 0;
  if (ageNum >= 65) {
    score += 25;
    factors.push(`Người cao tuổi (${ageNum} tuổi)`);
  } else if (ageNum > 0 && ageNum <= 6) {
    score += 20;
    factors.push(`Trẻ em nhỏ tuổi (${ageNum} tuổi)`);
  }

  // Safety Verdict & Warning items
  if (params.safetyVerdict === 'WARN') {
    score += 35;
    factors.push(`Cảnh báo tương tác/chống chỉ định (WARN: ${params.safetyReason || 'Cần xem xét liều dùng'})`);
  } else if (params.safetyVerdict === 'BLOCK') {
    score += 50;
    factors.push(`Vi phạm nghiêm trọng chống chỉ định (BLOCK)`);
  }

  const warningItems = (params.items || []).filter((i) => i.isWarning);
  if (warningItems.length > 0) {
    score += 20;
    factors.push(`${warningItems.length} thuốc có cảnh báo dược lý`);
  }

  // Chronic conditions / Medical history
  const history = (params.medicalHistory || []).filter(
    (h) => h && !h.toLowerCase().includes('không') && !h.toLowerCase().includes('bình thường')
  );
  if (history.length > 0) {
    score += Math.min(30, history.length * 10);
    factors.push(`Bệnh nền: ${history.join(', ')}`);
  }

  // Allergies
  const allergies = (params.allergies || []).filter(
    (a) => a && !a.toLowerCase().includes('không')
  );
  if (allergies.length > 0) {
    score += 20;
    factors.push(`Tiền sử dị ứng: ${allergies.join(', ')}`);
  }

  // Special conditions
  const special = (params.specialConditions || []).filter((s) => s);
  if (special.length > 0) {
    score += 20;
    factors.push(`Trạng thái đặc biệt: ${special.join(', ')}`);
  }

  // Current Meds polypharmacy
  const meds = (params.currentMeds || []).filter((m) => m);
  if (meds.length >= 2) {
    score += 15;
    factors.push(`Phối hợp nhiều thuốc đang dùng (${meds.length} loại)`);
  } else if (meds.length === 1) {
    score += 5;
    factors.push(`Đang uống thuốc: ${meds[0]}`);
  }

  // Severe symptoms keywords
  const symptomsText = (params.symptoms || '').toLowerCase();
  const severeKeywords = [
    'sốt cao',
    'khó thở',
    'đau ngực',
    'co giật',
    'mất ý thức',
    'nôn ra máu',
    'tiêu chảy nặng',
    'sưng phù',
  ];
  const matchedSymptoms = severeKeywords.filter((kw) => symptomsText.includes(kw));
  if (matchedSymptoms.length > 0) {
    score += 30;
    factors.push(`Triệu chứng cần chú ý: ${matchedSymptoms.join(', ')}`);
  }

  // Clamp score 0 to 100
  const finalScore = Math.min(100, Math.max(5, score));

  // Determine Tier
  let tier: PriorityTier;
  let priorityLabel: 'Cần gọi' | 'Tiêu chuẩn' | 'Nhanh';

  if (finalScore >= 65 || params.safetyVerdict === 'WARN' || params.safetyVerdict === 'BLOCK') {
    tier = 'TIER_1_CALL';
    priorityLabel = 'Cần gọi';
  } else if (finalScore >= 30) {
    tier = 'TIER_2_STANDARD';
    priorityLabel = 'Tiêu chuẩn';
  } else {
    tier = 'TIER_3_FAST';
    priorityLabel = 'Nhanh';
  }

  if (factors.length === 0) {
    factors.push('Đơn hàng an toàn cơ bản, không có yếu tố rủi ro cao');
  }

  return {
    riskScore: finalScore,
    priorityTier: tier,
    priority: priorityLabel,
    riskFactors: factors,
  };
}
