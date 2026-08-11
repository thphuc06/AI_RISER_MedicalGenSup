import { Order, VoicePreset } from '../types';

export const INITIAL_ORDERS: Order[] = [
  {
    id: '#MD-8821',
    timestamp: '08:45',
    patientName: 'Nguyễn Văn Nam',
    patientAge: 68,
    patientPhone: '0903 123 456',
    priority: 'Cần gọi',
    priorityTier: 'TIER_1_CALL',
    riskScore: 85,
    riskFactors: [
      'Bệnh nhân cao tuổi (68 tuổi)',
      'Cảnh báo tương tác thuốc WARN (Vitamin C liều cao & Metformin)',
      'Tiền sử bệnh nền: Cao huyết áp, Tiểu đường Type 2'
    ],
    status: 'pending',
    voiceTranscript: 'Tôi muốn mua thuốc cảm cúm cho người già.',
    clinicalSummary: {
      gender: 'Nam',
      age: 68,
      medicalHistory: ['Cao huyết áp', 'Tiểu đường Type 2'],
      allergies: ['Penicillin'],
      currentMeds: ['Metformin 500mg', 'Amlodipine 5mg'],
      symptoms:
        'Ho khan kéo dài 3 ngày, sốt nhẹ về chiều, đau họng nhẹ.',
      aiTriage: {
        category: 'Gợi ý thuốc điều trị triệu chứng (Standard)',
        riskLevel: 'Cảnh báo tương tác',
        note: 'Cảnh báo tương tác giữa Vitamin C liều cao và Metformin của bệnh nhân.',
        riskScore: 85,
        priorityTier: 'TIER_1_CALL',
        riskFactors: [
          'Bệnh nhân cao tuổi (68 tuổi)',
          'Cảnh báo tương tác thuốc WARN (Vitamin C liều cao & Metformin)',
          'Tiền sử bệnh nền: Cao huyết áp, Tiểu đường Type 2'
        ]
      },
    },
    items: [
      {
        id: 'p1',
        name: 'Panadol Extra',
        source: 'Nguồn: Phác đồ điều trị sốt nhẹ',
        quantity: 2,
        unit: 'vỉ',
        price: 45000,
        activeIngredient: 'Paracetamol 500mg, Caffeine 65mg',
        imageUrl:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuBBhECJY5E0zSbC9k8z_6Dm0QdkrrAccNMXZK1Qv9g2aMGr57l0GunMVquIP9G6wjdTD17R1MqKODYIsFSIL7lu1Rss5IYRarMpCK1PHQHx2ZMvQfqpIXFM0usjkLqc1UJQTMT2ZjBQEyiJ8PAQNI7eyfut7QJPPauvXJ-DLd80s1ChnHKgvkCbjiyhD6f3ZW3lbZFDxWIqP2zGunEZ8pP_PGAtH6RPFVxuqORmfupNBunqP-iwDII',
      },
      {
        id: 'p2',
        name: 'Eugica Fort',
        source: 'Nguồn: Triệu chứng ho',
        quantity: 1,
        unit: 'chai',
        price: 95000,
        activeIngredient: 'Eucalyptol, Bạc hà, Tần dày lá',
      },
      {
        id: 'p3',
        name: 'Berocca Performance',
        source: 'Nguồn: Bổ sung vitamin',
        quantity: 1,
        unit: 'tuýp',
        price: 185000,
        activeIngredient: 'Vitamin B complex, Vitamin C, Magnesi, Kẽm',
        isWarning: true,
        warningMessage:
          'Cảnh báo tương tác với Metformin bệnh nhân đang dùng. Cần xem xét liều lượng Vitamin C.',
        isDisabled: true,
        disabledReason: 'Khuyến cáo thay thế bằng B-Complex liều tiêu chuẩn',
        imageUrl:
          'https://lh3.googleusercontent.com/aida-public/AB6AXuDOhczyspaIAdYkb_WGDrp8HRsV9RiFFRoATBFTXwPJ47bX064TH9Uy5xV2-1YHoGo_XCS7ck_YfZKHrY_zkAmrOnm6eIQtTpmiDUpv7YPuWUv4AVf2WZHYb9HJVaLyLoSvSWalnN6qrArsBgS6HOhQFheUI_ZfR6farNg70y93rO4iR5D_sVxeaTvlU6xaUpRRw6uLLcY4TKvKBy9AkW3tDC16hX7I2kk1fKqd_bEhRQv90Nu-RuA',
      },
    ],
    processingTimeSeconds: 195,
  },
  {
    id: '#MD-8822',
    timestamp: '02:10',
    patientName: 'Lê Thị Mai',
    patientAge: 45,
    patientPhone: '0912 987 654',
    priority: 'Nhanh',
    priorityTier: 'TIER_3_FAST',
    riskScore: 15,
    riskFactors: [
      'Đơn thuốc OTC điều trị dị ứng thông thường',
      'Không có chống chỉ định nguy hiểm'
    ],
    status: 'pending',
    voiceTranscript: 'Bán cho tôi thuốc xịt mũi dị ứng và viên ngậm viêm họng.',
    clinicalSummary: {
      gender: 'Nữ',
      age: 45,
      medicalHistory: ['Viêm mũi dị ứng mạn tính'],
      allergies: [],
      currentMeds: [],
      symptoms: 'Nghẹt mũi nặng khi thay đổi thời tiết, ngứa cổ họng, không sốt.',
      aiTriage: {
        category: 'Xử lý ưu tiên (Fast Track)',
        riskLevel: 'Thấp',
        note: 'Triệu chứng dị ứng thông thường, không phát hiện trùng lặp.',
        riskScore: 15,
        priorityTier: 'TIER_3_FAST',
        riskFactors: [
          'Đơn thuốc OTC điều trị dị ứng thông thường',
          'Không có chống chỉ định nguy hiểm'
        ]
      },
    },
    items: [
      {
        id: 'p4',
        name: 'Xịt mũi Otrivin 0.1%',
        source: 'Nguồn: Triệu chứng nghẹt mũi',
        quantity: 1,
        unit: 'chai',
        price: 58000,
        activeIngredient: 'Xylometazoline hydrochloride 0.1%',
      },
      {
        id: 'p5',
        name: 'Viên ngậm Strepsils Cool',
        source: 'Nguồn: Giảm đau họng',
        quantity: 2,
        unit: 'hộp',
        price: 36000,
        activeIngredient: '2,4-Dichlorobenzyl alcohol, Amylmetacresol',
      },
    ],
    processingTimeSeconds: 45,
  },
  {
    id: '#MD-8823',
    timestamp: '05:30',
    patientName: 'Phạm Hồng Đức',
    patientAge: 72,
    patientPhone: '0988 555 444',
    priority: 'Tiêu chuẩn',
    priorityTier: 'TIER_2_STANDARD',
    riskScore: 55,
    riskFactors: [
      'Bệnh nhân cao tuổi (72 tuổi)',
      'Tiền sử bệnh nền: Viêm loét dạ dày, Tim mạch',
      'Cần tư vấn thời điểm uống thuốc cách ly với thuốc tim mạch'
    ],
    status: 'pending',
    voiceTranscript: 'Tôi cần mua thuốc đau dạ dày và men tiêu hóa.',
    clinicalSummary: {
      gender: 'Nam',
      age: 72,
      medicalHistory: ['Viêm loét dạ dày', 'Tim mạch'],
      allergies: [],
      currentMeds: ['Aspirin 81mg'],
      symptoms: 'Ợ chua, đầy hơi sau ăn, đau nhẹ vùng thượng vị 2 ngày qua.',
      aiTriage: {
        category: 'Đơn thuốc tiêu chuẩn (Standard)',
        riskLevel: 'Trung bình',
        note: 'Cần hướng dẫn uống xa bữa ăn với thuốc tim mạch.',
        riskScore: 55,
        priorityTier: 'TIER_2_STANDARD',
        riskFactors: [
          'Bệnh nhân cao tuổi (72 tuổi)',
          'Tiền sử bệnh nền: Viêm loét dạ dày, Tim mạch',
          'Cần tư vấn thời điểm uống thuốc cách ly với thuốc tim mạch'
        ]
      },
    },
    items: [
      {
        id: 'p6',
        name: 'Yumangel (Thuốc dạ dày chữ Y)',
        source: 'Nguồn: Giảm ợ chua & trào ngược',
        quantity: 1,
        unit: 'hộp',
        price: 110000,
        activeIngredient: 'Almagate 1.5g',
      },
      {
        id: 'p7',
        name: 'Men vi sinh Enterogermina',
        source: 'Nguồn: Hỗ trợ tiêu hóa',
        quantity: 2,
        unit: 'hộp',
        price: 170000,
        activeIngredient: 'Bacillus clausii 2 tỷ bào tử',
      },
    ],
    processingTimeSeconds: 120,
  },
  {
    id: '#MD-8824',
    timestamp: '09:15',
    patientName: 'Đặng Thanh Thảo',
    patientAge: 32,
    patientPhone: '0977 112 233',
    priority: 'Nhanh',
    priorityTier: 'TIER_3_FAST',
    riskScore: 10,
    riskFactors: [
      'Bệnh nhân trẻ tuổi, không bệnh nền',
      'Thuốc nhỏ mắt bổ sung, an toàn tuyệt đối'
    ],
    status: 'pending',
    voiceTranscript: 'Thuốc nhỏ mắt nhân tạo cho người dùng máy tính nhiều.',
    clinicalSummary: {
      gender: 'Nữ',
      age: 32,
      medicalHistory: ['Không ghi nhận'],
      allergies: [],
      currentMeds: [],
      symptoms: 'Mỏi mắt, khô mắt sau khi làm việc văn phòng 8-10 tiếng.',
      aiTriage: {
        category: 'Chăm sóc nhãn khoa cơ bản',
        riskLevel: 'Thấp',
        riskScore: 10,
        priorityTier: 'TIER_3_FAST',
        riskFactors: [
          'Bệnh nhân trẻ tuổi, không bệnh nền',
          'Thuốc nhỏ mắt bổ sung, an toàn tuyệt đối'
        ]
      },
    },
    items: [
      {
        id: 'p8',
        name: 'Nước nhỏ mắt Systane Ultra',
        source: 'Nguồn: Khô mắt văn phòng',
        quantity: 1,
        unit: 'chai',
        price: 125000,
        activeIngredient: 'Polyethylene glycol 400, Propylene glycol',
      },
    ],
    processingTimeSeconds: 20,
  },
];

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'preset-1',
    label: 'Cảm cúm người già (Gốc)',
    transcript: 'Tôi muốn mua thuốc cảm cúm cho người già.',
    recommendedItems: [],
    warnings: [],
  },
  {
    id: 'preset-2',
    label: 'Siro ho & Bổ phế',
    transcript: 'Cho tôi chai Eugica Fort trị ho khan ngứa cổ.',
    recommendedItems: [
      {
        id: 'p2',
        name: 'Eugica Fort',
        source: 'Nguồn: Triệu chứng ho',
        quantity: 1,
        unit: 'chai',
        price: 95000,
        activeIngredient: 'Eucalyptol, Bạc hà, Tần dày lá',
      },
      {
        id: 'p5',
        name: 'Viên ngậm Strepsils Cool',
        source: 'Nguồn: Giảm đau họng',
        quantity: 1,
        unit: 'hộp',
        price: 36000,
        activeIngredient: '2,4-Dichlorobenzyl alcohol, Amylmetacresol',
      },
    ],
    warnings: [
      {
        type: 'amber',
        text: 'Lưu ý: Người có tiền sử dị ứng tinh dầu Bạc hà nên chú ý liều dùng.',
      },
    ],
  },
  {
    id: 'preset-3',
    label: 'Đau dạ dày & Tiêu hóa',
    transcript: 'Tôi bị ợ chua đầy bụng sau khi ăn đồ mỡ.',
    recommendedItems: [
      {
        id: 'p6',
        name: 'Yumangel (Thuốc dạ dày chữ Y)',
        source: 'Nguồn: Giảm ợ chua & trào ngược',
        quantity: 1,
        unit: 'hộp',
        price: 110000,
        activeIngredient: 'Almagate 1.5g',
      },
      {
        id: 'p7',
        name: 'Men vi sinh Enterogermina',
        source: 'Nguồn: Hỗ trợ tiêu hóa',
        quantity: 1,
        unit: 'hộp',
        price: 85000,
        activeIngredient: 'Bacillus clausii 2 tỷ bào tử',
      },
    ],
    warnings: [],
  },
];
