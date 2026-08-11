export type OrderPriority = 'Cần gọi' | 'Nhanh' | 'Tiêu chuẩn';
export type PriorityTier = 'TIER_1_CALL' | 'TIER_2_STANDARD' | 'TIER_3_FAST';

export type OrderStatus = 'pending' | 'processing' | 'approved' | 'rejected' | 'calling' | 'cho_duyet' | 'duoc_duyet' | 'da_thanh_toan' | 'da_huy';

export interface CartItem {
  id: string;
  name: string;
  source: string;
  quantity: number;
  unit: string; // e.g. "vỉ", "chai", "tuýp", "hộp"
  price: number; // VND
  activeIngredient?: string;
  isWarning?: boolean;
  warningMessage?: string;
  isDisabled?: boolean;
  disabledReason?: string;
  imageUrl?: string;
}

export interface ClinicalSummary {
  gender: 'Nam' | 'Nữ' | string;
  age: number | string;
  medicalHistory: string[]; // e.g. ['Cao huyết áp', 'Tiểu đường Type 2']
  allergies?: string[]; // e.g. ['Penicillin', 'Aspirin']
  currentMeds?: string[]; // e.g. ['Amlodipine 5mg', 'Metformin 500mg']
  specialConditions?: string[]; // e.g. ['Phụ nữ mang thai', 'Suy gan nhẹ']
  healthNotes?: string;
  symptoms: string;
  aiTriage: {
    category: string; // e.g. "Gợi ý thuốc điều trị triệu chứng (Standard)"
    riskLevel: 'Thấp' | 'Trung bình' | 'Cao' | 'Cảnh báo tương tác';
    note?: string;
    riskScore?: number; // 0 - 100
    priorityTier?: PriorityTier;
    riskFactors?: string[];
  };
}

export interface Order {
  id: string; // e.g. "#MD-8821"
  timestamp: string; // e.g. "08:45"
  patientName: string; // e.g. "Trần Văn Nam"
  patientAge: number;
  patientPhone: string;
  priority: OrderPriority;
  priorityTier?: PriorityTier; // 'TIER_1_CALL' | 'TIER_2_STANDARD' | 'TIER_3_FAST'
  riskScore?: number; // 0 - 100
  riskFactors?: string[]; // Array of risk factors identified by AI
  status: OrderStatus;
  voiceTranscript?: string;
  clinicalSummary: ClinicalSummary;
  items: CartItem[];
  processingTimeSeconds?: number;
  notes?: string;
  totalPrice?: number;
}

export interface VoicePreset {
  id: string;
  label: string;
  transcript: string;
  recommendedItems: CartItem[];
  warnings: { type: 'amber' | 'red'; text: string }[];
}
