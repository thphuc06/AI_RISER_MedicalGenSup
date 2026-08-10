export type OrderPriority = 'Cần gọi' | 'Nhanh' | 'Tiêu chuẩn';

export type OrderStatus = 'pending' | 'processing' | 'approved' | 'rejected' | 'calling';

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
  gender: 'Nam' | 'Nữ';
  age: number;
  medicalHistory: string[]; // e.g. ['Cao huyết áp', 'Tiểu đường Type 2']
  symptoms: string;
  aiTriage: {
    category: string; // e.g. "Gợi ý thuốc điều trị triệu chứng (Standard)"
    riskLevel: 'Thấp' | 'Trung bình' | 'Cao' | 'Cảnh báo tương tác';
    note?: string;
  };
}

export interface Order {
  id: string; // e.g. "#MD-8821"
  timestamp: string; // e.g. "08:45"
  patientName: string; // e.g. "Trần Văn Nam"
  patientAge: number;
  patientPhone: string;
  priority: OrderPriority;
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
