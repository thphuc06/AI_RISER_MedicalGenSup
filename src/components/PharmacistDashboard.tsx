import React, { useState, useEffect } from 'react';
import { Order, CartItem } from '../types';
import { formatConditionToVietnamese, formatAgeDisplay } from '../utils/formatters';

interface PharmacistDashboardProps {
  orders: Order[];
  selectedOrderId: string;
  onSelectOrder: (id: string) => void;
  onApproveOrder: (id: string) => void;
  onUpdateOrderItems: (id: string, items: CartItem[]) => void;
  onCreateNewOrder: (newOrder: Order) => void;
  onCancelAndCall: (id: string) => void;
  onSwitchToCustomerView?: () => void;
}

export const PharmacistDashboard: React.FC<PharmacistDashboardProps> = ({
  orders,
  selectedOrderId,
  onSelectOrder,
  onApproveOrder,
  onUpdateOrderItems,
  onCreateNewOrder,
  onCancelAndCall,
  onSwitchToCustomerView,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'orders' | 'patients' | 'inventory' | 'reports'>('orders');
  const [showQueue, setShowQueue] = useState(true);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [showEditOrderModal, setShowEditOrderModal] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Order Form state
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientAge, setNewPatientAge] = useState<number>(60);
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [newSymptoms, setNewSymptoms] = useState('');
  const [newMedicalHistory, setNewMedicalHistory] = useState('Cao huyết áp');

  // Tier Filter and Sort State
  const [tierFilter, setTierFilter] = useState<'ALL' | 'TIER_1_CALL' | 'TIER_2_STANDARD' | 'TIER_3_FAST'>('ALL');
  const [sortBy, setSortBy] = useState<'RISK_DESC' | 'NEWEST'>('RISK_DESC');

  // Timer simulation for selected order
  const [timerSeconds, setTimerSeconds] = useState<number>(195);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || orders[0];

  useEffect(() => {
    if (selectedOrder) {
      setTimerSeconds(selectedOrder.processingTimeSeconds || 195);
    }
  }, [selectedOrderId, selectedOrder]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const getOrderRiskScore = (o: Order): number => {
    if (typeof o.riskScore === 'number') return o.riskScore;
    if (typeof o.clinicalSummary?.aiTriage?.riskScore === 'number') return o.clinicalSummary.aiTriage.riskScore;
    if (o.priority === 'Cần gọi') return 80;
    if (o.priority === 'Nhanh') return 15;
    return 45;
  };

  const getOrderTier = (o: Order): 'TIER_1_CALL' | 'TIER_2_STANDARD' | 'TIER_3_FAST' => {
    if (o.priorityTier) return o.priorityTier;
    if (o.clinicalSummary?.aiTriage?.priorityTier) return o.clinicalSummary.aiTriage.priorityTier;
    const score = getOrderRiskScore(o);
    if (score >= 65 || o.priority === 'Cần gọi') return 'TIER_1_CALL';
    if (score >= 30) return 'TIER_2_STANDARD';
    return 'TIER_3_FAST';
  };

  const tier1Count = orders.filter((o) => getOrderTier(o) === 'TIER_1_CALL').length;
  const tier2Count = orders.filter((o) => getOrderTier(o) === 'TIER_2_STANDARD').length;
  const tier3Count = orders.filter((o) => getOrderTier(o) === 'TIER_3_FAST').length;

  const filteredOrders = orders
    .filter((o) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        o.id.toLowerCase().includes(query) ||
        o.patientName.toLowerCase().includes(query) ||
        o.patientPhone.includes(query);
      if (!matchesSearch) return false;

      const tier = getOrderTier(o);
      if (tierFilter === 'TIER_1_CALL') return tier === 'TIER_1_CALL';
      if (tierFilter === 'TIER_2_STANDARD') return tier === 'TIER_2_STANDARD';
      if (tierFilter === 'TIER_3_FAST') return tier === 'TIER_3_FAST';
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'RISK_DESC') {
        return getOrderRiskScore(b) - getOrderRiskScore(a);
      }
      const tA = a.timestamp || '';
      const tB = b.timestamp || '';
      return tB.localeCompare(tA);
    });

  const handleApprove = () => {
    if (!selectedOrder) return;
    onApproveOrder(selectedOrder.id);
    showToast(`Đã phê duyệt & chuyển giao hàng cho đơn ${selectedOrder.id}!`);
  };

  const handleCall = () => {
    if (!selectedOrder) return;
    setShowCallModal(true);
  };

  const handleCreateOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName) return;

    const newId = `#MD-${Math.floor(1000 + Math.random() * 9000)}`;
    const createdOrder: Order = {
      id: newId,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      patientName: newPatientName,
      patientAge: newPatientAge,
      patientPhone: newPatientPhone || '0901 234 567',
      priority: 'Nhanh',
      status: 'pending',
      clinicalSummary: {
        gender: 'Nam',
        age: newPatientAge,
        medicalHistory: newMedicalHistory.split(',').map((s) => s.trim()),
        symptoms: newSymptoms || 'Bệnh nhân khai báo qua tổng đài Dược sĩ.',
        aiTriage: {
          category: 'Đơn tạo mới từ Dược sĩ',
          riskLevel: 'Thấp',
        },
      },
      items: [
        {
          id: `p-${Date.now()}-1`,
          name: 'Panadol Extra',
          source: 'Khuyến nghị triệu chứng',
          quantity: 1,
          unit: 'vỉ',
          price: 45000,
          activeIngredient: 'Paracetamol 500mg, Caffeine 65mg',
        },
      ],
      processingTimeSeconds: 5,
    };

    onCreateNewOrder(createdOrder);
    setShowNewOrderModal(false);
    showToast(`Đã tạo thành công đơn hàng ${newId}`);
    setNewPatientName('');
    setNewSymptoms('');
  };

  return (
    <div className="bg-background text-on-surface flex h-full w-full relative overflow-hidden">
      {/* Toast notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-primary text-on-primary px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-bounce">
          <span className="material-symbols-outlined">check_circle</span>
          <span className="font-label-lg text-sm">{toastMessage}</span>
        </div>
      )}

      {/* SideNavBar */}
      <aside className="bg-[#ebefec] w-60 shrink-0 h-full flex flex-col border-r border-[#bdc9c5] z-20 hidden md:flex">
        <div className="p-5 flex items-center gap-3 border-b border-[#bdc9c5]">
          <div className="w-10 h-10 rounded-lg bg-[#00685c] flex items-center justify-center text-white shrink-0 shadow-xs">
            <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              local_pharmacy
            </span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-[#00685c] uppercase tracking-wider">Dược sĩ Trực</h1>
            <p className="text-[10px] text-[#3e4946] font-medium">Nhà thuốc Việt v1.2</p>
          </div>
        </div>

        <div className="p-4">
          <button
            onClick={() => setShowNewOrderModal(true)}
            className="w-full bg-[#00685c] text-white rounded-md py-2 px-3 text-sm font-semibold hover:bg-[#005047] transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-base font-bold">add</span>
            + Tạo đơn mới
          </button>
        </div>

        <div className="flex-1 px-3 space-y-1">
          <button
            onClick={() => setActiveTab('orders')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer text-left ${
              activeTab === 'orders'
                ? 'bg-[#218274] text-white shadow-xs'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
              assignment
            </span>
            <span>Đơn hàng</span>
          </button>

          <button
            onClick={() => setActiveTab('patients')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer text-left ${
              activeTab === 'patients'
                ? 'bg-[#218274] text-white shadow-xs'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span className="material-symbols-outlined text-lg">group</span>
            <span>Bệnh nhân</span>
          </button>

          <button
            onClick={() => setActiveTab('inventory')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer text-left ${
              activeTab === 'inventory'
                ? 'bg-[#218274] text-white shadow-xs'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span className="material-symbols-outlined text-lg">inventory_2</span>
            <span>Kho dược</span>
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer text-left ${
              activeTab === 'reports'
                ? 'bg-[#218274] text-white shadow-xs'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span className="material-symbols-outlined text-lg">analytics</span>
            <span>Báo cáo</span>
          </button>
        </div>



        <div className="p-3 border-t border-[#bdc9c5] bg-[#dfe3e1] flex items-center gap-3 mt-auto">
          <img
            alt="Nguyen Van A"
            className="w-8 h-8 rounded-full object-cover border border-[#bdc9c5]"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDZN8OBtioD7MSsIuUGvWFDSnFepHXPXR-4LIZ6NtT29w-yxGbLjKmbkv59RfdNy5VHe8Ztq8JbTUHU7g4FeNi1LcezYKZgQ_Zd1diJconSPV0gZz6d_um92HzJPzKnYx23bCiMRXq6cfBIkkzIbb82aEB3q4xtR8Rp8DGYa1jdee86BSc4QeAU6cswKckK7NMZ_oob8gEDOfWjjOv9jGTHQH_g5CRvnUc4sqcXscVqcY6xS_D_K1A"
          />
          <div className="text-[11px] overflow-hidden">
            <p className="font-bold text-[#181c1b] truncate">Nguyen Van A</p>
            <p className="text-[#3e4946] uppercase text-[10px] tracking-wider font-semibold">Senior Pharm.</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#f6faf8]">
        {/* TopNavBar */}
        <header className="h-14 bg-white border-b border-[#bdc9c5] flex items-center justify-between px-4 sm:px-6 shrink-0 z-10 gap-3">
          <div className="flex items-center gap-3 sm:gap-6 flex-1 max-w-xl">
            <h2 className="text-base sm:text-lg font-bold text-[#00685c] whitespace-nowrap">Kiểm duyệt AI</h2>
            
            {/* Toggle Queue Panel Button */}
            <button
              onClick={() => setShowQueue(!showQueue)}
              className={`px-2.5 py-1 text-xs font-bold rounded-md border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                showQueue
                  ? 'bg-[#ebefec] text-[#00685c] border-[#bdc9c5] hover:bg-[#dfe3e1]'
                  : 'bg-[#00685c] text-white border-[#00685c] shadow-xs hover:bg-[#005047]'
              }`}
              title={showQueue ? "Ẩn danh sách hàng đợi" : "Hiện danh sách hàng đợi"}
            >
              <span className="material-symbols-outlined text-sm">
                {showQueue ? 'view_sidebar' : 'dock_to_right'}
              </span>
              <span className="hidden md:inline">
                {showQueue ? 'Ẩn hàng đợi' : 'Hiện hàng đợi'}
              </span>
            </button>

            <div className="relative flex-1 max-w-xs">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#3e4946] text-sm">
                search
              </span>
              <input
                type="text"
                placeholder="Tìm đơn hàng, bệnh nhân..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#f1f4f2] border border-[#bdc9c5] rounded-full pl-9 pr-4 py-1.5 text-xs text-[#181c1b] focus:outline-none focus:ring-1 focus:ring-[#00685c]"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 text-[#3e4946]">

            <div className="relative cursor-pointer hover:opacity-80 transition-opacity">
              <span className="material-symbols-outlined text-xl">notifications</span>
              <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
            </div>
            <span className="material-symbols-outlined text-xl cursor-pointer hover:opacity-80 transition-opacity">
              settings
            </span>
          </div>
        </header>

        {/* Dashboard Layout */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* LEFT QUEUE */}
          {showQueue && (
            <aside className="w-full md:w-72 bg-white border-r border-[#bdc9c5] flex flex-col shrink-0 h-full z-20 transition-all">
              <div className="p-3 border-b border-[#bdc9c5] bg-[#ebefec] space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold uppercase text-[#3e4946] tracking-wider">
                    Hàng đợi ({filteredOrders.length})
                  </h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowNewOrderModal(true)}
                      className="text-[#00685c] hover:bg-[#00685c]/10 px-2 py-0.5 rounded text-xs font-bold md:hidden cursor-pointer"
                    >
                      + Thêm
                    </button>
                    <button
                      onClick={() => setShowQueue(false)}
                      title="Thu gọn hàng đợi"
                      className="text-[#3e4946] hover:bg-[#dfe3e1] p-1 rounded transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-base">chevron_left</span>
                    </button>
                  </div>
                </div>

                {/* Tier Filter Tabs */}
                <div className="grid grid-cols-4 gap-1 text-[10px] font-bold">
                  <button
                    onClick={() => setTierFilter('ALL')}
                    className={`py-1 rounded text-center cursor-pointer border transition-colors ${
                      tierFilter === 'ALL'
                        ? 'bg-[#00685c] text-white border-[#00685c]'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Tất cả ({orders.length})
                  </button>
                  <button
                    onClick={() => setTierFilter('TIER_1_CALL')}
                    className={`py-1 rounded text-center cursor-pointer border transition-colors ${
                      tierFilter === 'TIER_1_CALL'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                    }`}
                    title="Tier 1: Đơn có cảnh báo / Cần gọi điện"
                  >
                    🔴 T1 ({tier1Count})
                  </button>
                  <button
                    onClick={() => setTierFilter('TIER_2_STANDARD')}
                    className={`py-1 rounded text-center cursor-pointer border transition-colors ${
                      tierFilter === 'TIER_2_STANDARD'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                    }`}
                    title="Tier 2: Duyệt tiêu chuẩn"
                  >
                    🟡 T2 ({tier2Count})
                  </button>
                  <button
                    onClick={() => setTierFilter('TIER_3_FAST')}
                    className={`py-1 rounded text-center cursor-pointer border transition-colors ${
                      tierFilter === 'TIER_3_FAST'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    }`}
                    title="Tier 3: Duyệt nhanh Fast Track"
                  >
                    🟢 T3 ({tier3Count})
                  </button>
                </div>

                {/* Sort Option */}
                <div className="flex items-center justify-between text-[11px] pt-1">
                  <span className="text-gray-500 font-medium">Sắp xếp:</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSortBy('RISK_DESC')}
                      className={`font-semibold cursor-pointer ${
                        sortBy === 'RISK_DESC' ? 'text-[#00685c] underline' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      🎯 Điểm rủi ro (Cao)
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => setSortBy('NEWEST')}
                      className={`font-semibold cursor-pointer ${
                        sortBy === 'NEWEST' ? 'text-[#00685c] underline' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      🕒 Mới nhất
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-px">
                {filteredOrders.length === 0 ? (
                  <div className="p-6 text-center text-[#3e4946] text-xs">Không tìm thấy đơn hàng trong phân luồng này</div>
                ) : (
                  filteredOrders.map((ord) => {
                    const isSelected = ord.id === selectedOrderId;
                    const score = getOrderRiskScore(ord);
                    const tier = getOrderTier(ord);

                    const tierColorMap = {
                      TIER_1_CALL: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', label: '🔴 T1: Cần gọi' },
                      TIER_2_STANDARD: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', label: '🟡 T2: Tiêu chuẩn' },
                      TIER_3_FAST: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', label: '🟢 T3: Duyệt nhanh' },
                    };
                    const tierMeta = tierColorMap[tier];

                    return (
                      <div
                        key={ord.id}
                        onClick={() => onSelectOrder(ord.id)}
                        className={`p-3 cursor-pointer transition-colors border-b border-[#dfe3e1] ${
                          isSelected
                            ? 'bg-[#f4fffb] border-l-4 border-l-[#00685c]'
                            : 'hover:bg-[#f6faf8] bg-white'
                        }`}
                      >
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className={`font-bold ${isSelected ? 'text-[#00685c]' : 'text-[#181c1b]'}`}>
                            {ord.id}
                          </span>
                          <span className="text-gray-400 italic text-[11px]">{ord.timestamp}</span>
                        </div>

                        <p className="text-xs font-medium text-[#181c1b] mb-1.5">
                          <strong className="font-semibold text-emerald-900">{ord.patientName}</strong> • {formatAgeDisplay(ord.patientAge, ord.clinicalSummary?.age?.toString())}
                        </p>

                        {/* Risk Score Gauge & Tier Pill */}
                        <div className="flex items-center justify-between gap-1 mb-1.5 bg-gray-50 p-1.5 rounded border border-gray-100">
                          <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded border ${tierMeta.bg} ${tierMeta.text} ${tierMeta.border}`}>
                            {tierMeta.label}
                          </span>
                          <span className={`text-[11px] font-extrabold ${score >= 65 ? 'text-red-600' : score >= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            Risk Score: {score}/100
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {(ord.status === 'cho_duyet' || ord.status === 'pending') && (
                            <span className="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                              Chờ duyệt
                            </span>
                          )}
                          {(ord.status === 'duoc_duyet' || ord.status === 'approved') && (
                            <span className="inline-block px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                              Đã duyệt
                            </span>
                          )}
                          {ord.status === 'da_thanh_toan' && (
                            <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">
                              Đã thanh toán
                            </span>
                          )}
                          {(ord.status === 'da_huy' || ord.status === 'rejected') && (
                            <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-800 text-[10px] font-bold rounded">
                              Đã hủy
                            </span>
                          )}
                          {ord.status === 'calling' && (
                            <span className="inline-block px-1.5 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-bold rounded animate-pulse">
                              Đang gọi
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
          )}

          {/* RIGHT DETAIL PANEL */}
          <section className="flex-1 flex flex-col p-6 overflow-y-auto bg-[#f6faf8]">
            {activeTab === 'patients' ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4 border-[#bdc9c5]">
                  <div>
                    <h2 className="text-xl font-bold text-[#00685c] flex items-center gap-2">
                      <span className="material-symbols-outlined">group</span> Danh sách Bệnh nhân & Hồ sơ Sức khỏe
                    </h2>
                    <p className="text-xs text-[#3e4946] mt-0.5">
                      Tổng hợp hồ sơ AI theo dõi và lịch sử đơn thuốc của từng bệnh nhân
                    </p>
                  </div>
                  <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full border border-emerald-300">
                    {orders.length} đơn hàng • {new Set(orders.map((o) => o.patientName)).size} bệnh nhân
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(Array.from(new Map<string, Order>(orders.map((o) => [o.patientName + '_' + o.patientPhone, o])).values()) as Order[]).map((pOrder) => (
                    <div key={pOrder.id} className="bg-white border border-[#bdc9c5] rounded-xl p-4 shadow-xs hover:shadow-md transition-all">
                      <div className="flex justify-between items-start border-b border-gray-100 pb-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#00685c]/10 text-[#00685c] font-bold flex items-center justify-center text-sm border border-[#00685c]/20">
                            {pOrder.patientName.charAt(0)}
                          </div>
                          <div>
                            <h3 className="font-bold text-sm text-[#181c1b] flex items-center gap-1.5">
                              {pOrder.patientName}
                              <span className="material-symbols-outlined text-emerald-600 text-sm" title="Tên có dấu chuẩn">verified</span>
                            </h3>
                            <p className="text-xs text-[#3e4946]">
                              {formatAgeDisplay(pOrder.patientAge, pOrder.clinicalSummary?.age?.toString())} • {pOrder.patientPhone}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            onSelectOrder(pOrder.id);
                            setActiveTab('orders');
                          }}
                          className="text-xs bg-[#00685c] hover:bg-[#005047] text-white px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 cursor-pointer shadow-xs"
                        >
                          <span className="material-symbols-outlined text-xs">receipt_long</span> Xem đơn
                        </button>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                          <span className="text-[10px] font-bold uppercase text-gray-500 block mb-1">Tiền sử AI ghi nhận:</span>
                          <div className="flex flex-wrap gap-1">
                            {pOrder.clinicalSummary?.medicalHistory && pOrder.clinicalSummary.medicalHistory.length > 0 ? (
                              pOrder.clinicalSummary.medicalHistory.map((item, i) => (
                                <span key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-800 text-[11px] font-semibold rounded border border-emerald-200">
                                  {formatConditionToVietnamese(item)}
                                </span>
                              ))
                            ) : (
                              <span className="text-gray-500 italic text-[11px]">Chưa ghi nhận bệnh nền đặc biệt</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] pt-1">
                          <span className="text-gray-500">Đơn mới nhất: <strong className="text-[#00685c]">{pOrder.id}</strong> ({pOrder.timestamp})</span>
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-800 rounded font-semibold border border-amber-200">
                            {pOrder.clinicalSummary?.aiTriage?.riskLevel || 'An toàn'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : activeTab === 'inventory' ? (
              <div className="space-y-4">
                <div className="border-b pb-3 border-[#bdc9c5]">
                  <h2 className="text-xl font-bold text-[#00685c] flex items-center gap-2">
                    <span className="material-symbols-outlined">inventory_2</span> Quản lý Kho dược & Tồn kho
                  </h2>
                  <p className="text-xs text-[#3e4946]">Danh mục thuốc kê đơn & không kê đơn có sẵn tại nhà thuốc</p>
                </div>
                <div className="bg-white border border-[#bdc9c5] rounded-xl overflow-hidden shadow-xs">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#ebefec] text-[#3e4946] font-bold uppercase border-b border-[#bdc9c5]">
                      <tr>
                        <th className="p-3">Tên sản phẩm</th>
                        <th className="p-3">Hoạt chất</th>
                        <th className="p-3">Đơn vị</th>
                        <th className="p-3">Đơn giá</th>
                        <th className="p-3 text-center">Trạng thái kho</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="p-3 font-bold text-gray-900">Panadol Extra</td>
                        <td className="p-3 text-gray-600">Paracetamol 500mg, Caffeine 65mg</td>
                        <td className="p-3">Vỉ</td>
                        <td className="p-3 font-semibold text-[#00685c]">45.000 đ</td>
                        <td className="p-3 text-center"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">Còn hàng (120 vỉ)</span></td>
                      </tr>
                      <tr>
                        <td className="p-3 font-bold text-gray-900">Eugica Fort</td>
                        <td className="p-3 text-gray-600">Eucalyptol, Bạc hà, Tần dày lá</td>
                        <td className="p-3">Chai</td>
                        <td className="p-3 font-semibold text-[#00685c]">95.000 đ</td>
                        <td className="p-3 text-center"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">Còn hàng (45 chai)</span></td>
                      </tr>
                      <tr>
                        <td className="p-3 font-bold text-gray-900">Berocca Performance</td>
                        <td className="p-3 text-gray-600">Vitamin B complex, Vitamin C, Magnesi, Kẽm</td>
                        <td className="p-3">Tuýp</td>
                        <td className="p-3 font-semibold text-[#00685c]">185.000 đ</td>
                        <td className="p-3 text-center"><span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded">Sắp hết (8 tuýp)</span></td>
                      </tr>
                      <tr>
                        <td className="p-3 font-bold text-gray-900">Yumangel (Dạ dày chữ Y)</td>
                        <td className="p-3 text-gray-600">Almagate 1.5g</td>
                        <td className="p-3">Hộp</td>
                        <td className="p-3 font-semibold text-[#00685c]">110.000 đ</td>
                        <td className="p-3 text-center"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">Còn hàng (60 hộp)</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : activeTab === 'reports' ? (
              <div className="space-y-4">
                <div className="border-b pb-3 border-[#bdc9c5]">
                  <h2 className="text-xl font-bold text-[#00685c] flex items-center gap-2">
                    <span className="material-symbols-outlined">analytics</span> Báo cáo & Thống kê Lâm sàng
                  </h2>
                  <p className="text-xs text-[#3e4946]">Tổng quan hoạt động tư vấn Voice Shopping & Kiểm duyệt AI</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white border border-[#bdc9c5] p-4 rounded-xl shadow-xs">
                    <p className="text-xs text-gray-500 font-medium">Tổng đơn tiếp nhận</p>
                    <p className="text-2xl font-extrabold text-[#00685c] mt-1">{orders.length}</p>
                    <p className="text-[10px] text-emerald-600 font-semibold mt-1">100% Đồng bộ Realtime</p>
                  </div>
                  <div className="bg-white border border-[#bdc9c5] p-4 rounded-xl shadow-xs">
                    <p className="text-xs text-gray-500 font-medium">Đã phê duyệt thành công</p>
                    <p className="text-2xl font-extrabold text-emerald-600 mt-1">{orders.filter(o => o.status === 'duoc_duyet' || o.status === 'approved' || o.status === 'da_thanh_toan').length}</p>
                    <p className="text-[10px] text-gray-500 mt-1">Chuyển giao hàng tự động</p>
                  </div>
                  <div className="bg-white border border-[#bdc9c5] p-4 rounded-xl shadow-xs">
                    <p className="text-xs text-gray-500 font-medium">Cảnh báo tương tác thuốc</p>
                    <p className="text-2xl font-extrabold text-amber-600 mt-1">{orders.filter(o => o.clinicalSummary?.aiTriage?.riskLevel?.includes('Cảnh báo') || o.items?.some(i => i.isWarning)).length}</p>
                    <p className="text-[10px] text-amber-700 font-semibold mt-1">AI phát hiện & gán thẻ đỏ/vàng</p>
                  </div>
                </div>
              </div>
            ) : selectedOrder ? (
              <>
                <div className="mb-5 flex flex-wrap justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-bold text-[#181c1b]">
                        Chi tiết đơn {selectedOrder.id}
                      </h2>
                      {(selectedOrder.status === 'cho_duyet' || selectedOrder.status === 'pending') && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded">
                          Chờ duyệt
                        </span>
                      )}
                      {(selectedOrder.status === 'duoc_duyet' || selectedOrder.status === 'approved') && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded animate-pulse">
                          Đã duyệt đơn thuốc
                        </span>
                      )}
                      {selectedOrder.status === 'da_thanh_toan' && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-bold rounded">
                          Đã thanh toán
                        </span>
                      )}
                      {(selectedOrder.status === 'da_huy' || selectedOrder.status === 'rejected') && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs font-bold rounded">
                          Đã hủy
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#3e4946] mt-1">
                      Bệnh nhân: <strong className="text-[#181c1b] font-bold">{selectedOrder.patientName}</strong> ({formatAgeDisplay(selectedOrder.patientAge, selectedOrder.clinicalSummary?.age?.toString())} • {selectedOrder.patientPhone}) • Thời gian xử lý: <span className="font-semibold text-[#00685c]">{formatTimer(timerSeconds)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCall}
                      className="bg-white border border-[#bdc9c5] px-4 py-2 rounded text-xs font-bold text-red-600 hover:bg-red-50 transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">call</span>
                      Hủy & Gọi điện
                    </button>
                    <button
                      onClick={handleApprove}
                      className="bg-[#00685c] text-white px-6 py-2 rounded text-xs font-bold shadow-md hover:bg-[#005047] transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                        done_all
                      </span>
                      Phê duyệt & Giao hàng
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 min-[1200px]:grid-cols-2 gap-6 items-start">
                  {/* Left sub-column: AI Triage & Clinical summary & warnings */}
                  <div className="space-y-4">
                    {/* AI RISK TRIAGE & PRIORITY CARD */}
                    {(() => {
                      const selScore = getOrderRiskScore(selectedOrder);
                      const selTier = getOrderTier(selectedOrder);
                      const selFactors = selectedOrder.riskFactors || selectedOrder.clinicalSummary?.aiTriage?.riskFactors || [];

                      const tierCardConfig = {
                        TIER_1_CALL: {
                          bg: 'bg-gradient-to-br from-red-50 to-orange-50/60',
                          border: 'border-red-300',
                          badgeBg: 'bg-red-600 text-white',
                          barColor: 'bg-red-600',
                          textColor: 'text-red-900',
                          title: '🔴 TIER 1 - YÊU CẦU DƯỢC SĨ GỌI ĐIỆN TƯ VẤN TRỰC TIẾP',
                          subtitle: 'Đơn hàng có nguy cơ cao, thuộc đối tượng nhạy cảm hoặc có cảnh báo chống chỉ định (WARN/BLOCK).',
                          actionText: '📞 Bắt đầu gọi điện cho bệnh nhân',
                          actionFn: handleCall,
                          actionBtnClass: 'bg-red-600 hover:bg-red-700 text-white',
                        },
                        TIER_2_STANDARD: {
                          bg: 'bg-gradient-to-br from-amber-50 to-yellow-50/60',
                          border: 'border-amber-300',
                          badgeBg: 'bg-amber-600 text-white',
                          barColor: 'bg-amber-500',
                          textColor: 'text-amber-900',
                          title: '🟡 TIER 2 - DUYỆT ĐƠN TIÊU CHUẨN',
                          subtitle: 'Mức độ rủi ro trung bình. Dược sĩ kiểm tra danh mục thuốc và tiền sử bệnh lý trước khi ký duyệt.',
                          actionText: '✅ Duyệt đơn thuốc tiêu chuẩn',
                          actionFn: handleApprove,
                          actionBtnClass: 'bg-amber-700 hover:bg-amber-800 text-white',
                        },
                        TIER_3_FAST: {
                          bg: 'bg-gradient-to-br from-emerald-50 to-teal-50/60',
                          border: 'border-emerald-300',
                          badgeBg: 'bg-emerald-600 text-white',
                          barColor: 'bg-emerald-500',
                          textColor: 'text-emerald-900',
                          title: '🟢 TIER 3 - PHÂN LUỒNG DUYỆT NHANH (FAST TRACK)',
                          subtitle: 'Đơn hàng an toàn cao, không vi phạm chống chỉ định hay có triệu chứng nặng.',
                          actionText: '⚡ Phê duyệt nhanh 1-Click',
                          actionFn: handleApprove,
                          actionBtnClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
                        },
                      }[selTier];

                      return (
                        <div className={`rounded-xl p-4 border shadow-xs ${tierCardConfig.bg} ${tierCardConfig.border}`}>
                          <div className="flex justify-between items-start mb-2 gap-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`px-2.5 py-0.5 text-xs font-black rounded-full uppercase tracking-wider ${tierCardConfig.badgeBg}`}>
                                  {selTier === 'TIER_1_CALL' ? 'TIER 1 (CALL)' : selTier === 'TIER_2_STANDARD' ? 'TIER 2 (STANDARD)' : 'TIER 3 (FAST)'}
                                </span>
                                <span className="text-xs font-bold text-gray-600">
                                  Phân luồng ưu tiên AI
                                </span>
                              </div>
                              <h3 className={`text-sm font-extrabold ${tierCardConfig.textColor}`}>
                                {tierCardConfig.title}
                              </h3>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-2xl font-black text-gray-900">{selScore}</span>
                              <span className="text-xs text-gray-500 font-bold">/100</span>
                              <p className="text-[10px] uppercase font-bold text-gray-500">Risk Score</p>
                            </div>
                          </div>

                          {/* Risk Score Progress Bar */}
                          <div className="w-full bg-gray-200 h-2.5 rounded-full overflow-hidden mb-3">
                            <div
                              className={`h-full transition-all duration-500 ${tierCardConfig.barColor}`}
                              style={{ width: `${Math.min(100, Math.max(5, selScore))}%` }}
                            />
                          </div>

                          <p className="text-xs text-gray-700 mb-3 leading-relaxed">
                            {tierCardConfig.subtitle}
                          </p>

                          {/* Risk factors list */}
                          {selFactors.length > 0 && (
                            <div className="bg-white/80 backdrop-blur-xs p-2.5 rounded-lg border border-gray-200 mb-3 space-y-1">
                              <p className="text-[11px] font-extrabold uppercase text-gray-700 flex items-center gap-1">
                                <span className="material-symbols-outlined text-sm text-amber-600">troubleshoot</span>
                                Yếu tố rủi ro ghi nhận bởi AI ({selFactors.length}):
                              </p>
                              <ul className="text-xs text-gray-800 space-y-1 pl-1">
                                {selFactors.map((factor, idx) => (
                                  <li key={idx} className="flex items-start gap-1.5 font-medium">
                                    <span className="text-amber-600 font-bold">•</span>
                                    <span>{factor}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Action button */}
                          <div className="flex justify-end pt-1">
                            <button
                              onClick={tierCardConfig.actionFn}
                              className={`px-4 py-2 rounded-lg text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 ${tierCardConfig.actionBtnClass}`}
                            >
                              <span>{tierCardConfig.actionText}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="bg-white border border-[#bdc9c5] rounded-xl p-4 shadow-xs">
                      <div className="flex items-center justify-between mb-3 border-b border-[#f1f4f2] pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[#00685c] material-symbols-outlined text-lg">medical_information</span>
                          <h3 className="text-sm font-bold uppercase tracking-wide text-[#181c1b]">
                            Hồ sơ lâm sàng & Sức khỏe
                          </h3>
                        </div>
                        <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px] text-emerald-600">verified_user</span>
                          Firestore Profile
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        <div className="grid grid-cols-2 text-[11px] border-b border-gray-100 pb-1.5">
                          <span className="text-gray-500 uppercase font-medium">Đối tượng</span>
                          <span className="font-bold text-right text-[#181c1b]">
                            {selectedOrder.clinicalSummary.gender}, {formatAgeDisplay(selectedOrder.clinicalSummary.age, selectedOrder.patientAge?.toString())}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 text-[11px] border-b border-gray-100 pb-1.5">
                          <span className="text-gray-500 uppercase font-medium">Bệnh nền ghi nhận</span>
                          <span className="text-right flex flex-wrap justify-end gap-1">
                            {selectedOrder.clinicalSummary.medicalHistory?.length > 0 ? (
                              selectedOrder.clinicalSummary.medicalHistory.map((item, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200/80 rounded text-[10px] font-bold">
                                  {formatConditionToVietnamese(item)}
                                </span>
                              ))
                            ) : (
                              <span className="text-gray-400 italic">Không ghi nhận</span>
                            )}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 text-[11px] border-b border-gray-100 pb-1.5">
                          <span className="text-gray-500 uppercase font-medium">Tiền sử dị ứng</span>
                          <span className="text-right flex flex-wrap justify-end gap-1">
                            {selectedOrder.clinicalSummary.allergies && selectedOrder.clinicalSummary.allergies.length > 0 ? (
                              selectedOrder.clinicalSummary.allergies.map((item, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-[10px] font-bold">
                                  {item}
                                </span>
                              ))
                            ) : (
                              <span className="text-gray-400 italic">Không ghi nhận</span>
                            )}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 text-[11px] border-b border-gray-100 pb-1.5">
                          <span className="text-gray-500 uppercase font-medium">Thuốc đang sử dụng</span>
                          <span className="text-right flex flex-wrap justify-end gap-1">
                            {selectedOrder.clinicalSummary.currentMeds && selectedOrder.clinicalSummary.currentMeds.length > 0 ? (
                              selectedOrder.clinicalSummary.currentMeds.map((item, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px] font-bold">
                                  {item}
                                </span>
                              ))
                            ) : (
                              <span className="text-gray-400 italic">Không ghi nhận</span>
                            )}
                          </span>
                        </div>

                        {selectedOrder.clinicalSummary.specialConditions && selectedOrder.clinicalSummary.specialConditions.length > 0 && (
                          <div className="grid grid-cols-2 text-[11px] border-b border-gray-100 pb-1.5">
                            <span className="text-gray-500 uppercase font-medium">Trạng thái đặc biệt</span>
                            <span className="text-right flex flex-wrap justify-end gap-1">
                              {selectedOrder.clinicalSummary.specialConditions.map((item, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-[10px] font-bold">
                                  {item}
                                </span>
                              ))}
                            </span>
                          </div>
                        )}


                      </div>
                    </div>

                    <div className="bg-[#fff4f2] border border-[#ffdad6] rounded-xl p-4 shadow-xs">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-red-600 text-lg material-symbols-outlined">warning</span>
                        <h3 className="text-sm font-bold text-red-800 uppercase tracking-wide">
                          Cảnh báo dược lý ({selectedOrder.clinicalSummary.aiTriage.riskLevel})
                        </h3>
                      </div>
                      <p className="text-xs text-red-700 leading-snug">
                        {selectedOrder.clinicalSummary.aiTriage.note ||
                          'Kiểm tra liều dùng và tương tác với các nhóm thuốc hạ huyết áp, tiểu đường đang điều trị.'}
                      </p>
                    </div>
                  </div>

                  {/* Right sub-column: Proposed Cart */}
                  <div className="bg-white border border-[#bdc9c5] rounded-xl p-4 shadow-xs flex flex-col">
                    <div className="flex items-center justify-between border-b border-[#f1f4f2] pb-2 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[#00685c] material-symbols-outlined text-lg">medication</span>
                        <h3 className="text-sm font-bold uppercase tracking-wide text-[#181c1b]">
                          Giỏ hàng đề xuất
                        </h3>
                      </div>
                      <button
                        onClick={() => setShowEditOrderModal(true)}
                        className="text-xs text-[#00685c] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">edit</span> Sửa đơn
                      </button>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto max-h-[320px] pr-1">
                      {selectedOrder.items.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                            item.isWarning
                              ? 'bg-red-50 border-red-200'
                              : 'bg-[#f1f4f2] border-[#dfe3e1]'
                          }`}
                        >
                          <div className="flex gap-3 items-center flex-1">
                            <div className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold shrink-0 ${
                              item.isWarning ? 'bg-red-100 text-red-700' : 'bg-white text-[#00685c]'
                            }`}>
                              {item.name.charAt(0)}
                            </div>
                            <div className="overflow-hidden">
                              <p className={`text-xs font-bold truncate ${item.isWarning ? 'text-red-800' : 'text-[#181c1b]'}`}>
                                {item.name}
                              </p>
                              <p className="text-[10px] text-gray-500 italic truncate">
                                {item.source} {item.activeIngredient ? `• ${item.activeIngredient}` : ''}
                              </p>
                            </div>
                          </div>
                          <span className={`text-xs font-bold shrink-0 ml-2 ${item.isWarning ? 'text-red-700' : 'text-[#00685c]'}`}>
                            x{item.quantity} {item.unit}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#dfe3e1]">
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className="text-[#3e4946]">Tổng trị giá (tạm tính):</span>
                        <span className="text-lg text-[#00685c]">
                          {selectedOrder.items
                            .reduce((sum, i) => sum + (i.isDisabled ? 0 : i.price * i.quantity), 0)
                            .toLocaleString('vi-VN')}
                          đ
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-[#3e4946] text-sm">Chọn một đơn hàng để kiểm duyệt</div>
            )}
          </section>
        </div>
      </main>

      {/* Modal: Tạo đơn mới */}
      {showNewOrderModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-outline-variant">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3 className="font-bold text-lg text-primary flex items-center gap-2">
                <span className="material-symbols-outlined">add_circle</span> Tạo đơn thuốc mới
              </h3>
              <button
                onClick={() => setShowNewOrderModal(false)}
                className="text-on-surface-variant hover:text-on-surface text-xl"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrderSubmit} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold mb-1">Họ tên bệnh nhân *</label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Trần Văn Nam"
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  className="w-full p-2.5 border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Tuổi</label>
                  <input
                    type="number"
                    value={newPatientAge}
                    onChange={(e) => setNewPatientAge(Number(e.target.value))}
                    className="w-full p-2.5 border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Số điện thoại</label>
                  <input
                    type="text"
                    placeholder="090x xxx xxx"
                    value={newPatientPhone}
                    onChange={(e) => setNewPatientPhone(e.target.value)}
                    className="w-full p-2.5 border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Tiền sử bệnh (phân cách dấu phẩy)</label>
                <input
                  type="text"
                  value={newMedicalHistory}
                  onChange={(e) => setNewMedicalHistory(e.target.value)}
                  className="w-full p-2.5 border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Triệu chứng & ghi chú dược sĩ</label>
                <textarea
                  rows={3}
                  placeholder="Nhập triệu chứng khai báo..."
                  value={newSymptoms}
                  onChange={(e) => setNewSymptoms(e.target.value)}
                  className="w-full p-2.5 border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewOrderModal(false)}
                  className="flex-1 py-2.5 border border-outline-variant rounded-lg hover:bg-surface-container"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-primary text-on-primary rounded-lg font-bold hover:bg-surface-tint"
                >
                  Tạo đơn ngay
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Chỉnh sửa đơn thuốc */}
      {showEditOrderModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-outline-variant">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
              <h3 className="font-bold text-lg text-primary flex items-center gap-2">
                <span className="material-symbols-outlined">edit_note</span> Chỉnh sửa đơn {selectedOrder.id}
              </h3>
              <button
                onClick={() => setShowEditOrderModal(false)}
                className="text-on-surface-variant hover:text-on-surface text-xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
              <p className="text-xs text-on-surface-variant">Danh sách thuốc trong giỏ hàng:</p>
              {selectedOrder.items.map((item, idx) => (
                <div key={item.id} className="p-3 border rounded-lg flex items-center justify-between gap-3 text-xs">
                  <div className="flex-1">
                    <p className="font-bold text-sm text-on-surface">{item.name}</p>
                    <p className="text-on-surface-variant">{item.activeIngredient}</p>
                    <p className="text-primary font-semibold mt-0.5">{item.price.toLocaleString('vi-VN')}đ / {item.unit}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const newItems = [...selectedOrder.items];
                        if (newItems[idx].quantity > 1) {
                          newItems[idx].quantity -= 1;
                          onUpdateOrderItems(selectedOrder.id, newItems);
                        }
                      }}
                      className="w-7 h-7 rounded-full bg-surface-container border flex items-center justify-center font-bold text-base"
                    >
                      -
                    </button>
                    <span className="font-bold text-sm min-w-[20px] text-center">{item.quantity}</span>
                    <button
                      onClick={() => {
                        const newItems = [...selectedOrder.items];
                        newItems[idx].quantity += 1;
                        onUpdateOrderItems(selectedOrder.id, newItems);
                      }}
                      className="w-7 h-7 rounded-full bg-surface-container border flex items-center justify-center font-bold text-base"
                    >
                      +
                    </button>
                    <button
                      onClick={() => {
                        const newItems = selectedOrder.items.filter((_, i) => i !== idx);
                        onUpdateOrderItems(selectedOrder.id, newItems);
                      }}
                      className="text-error hover:bg-error-container p-1 rounded ml-2"
                      title="Xóa sản phẩm"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <button
                  onClick={() => {
                    const newItem: CartItem = {
                      id: `p-add-${Date.now()}`,
                      name: 'Siro Ho Astex',
                      source: 'Bổ sung bởi Dược sĩ',
                      quantity: 1,
                      unit: 'chai',
                      price: 52000,
                      activeIngredient: 'Tần dày lá, Núc nác, Đường phèn',
                    };
                    onUpdateOrderItems(selectedOrder.id, [...selectedOrder.items, newItem]);
                  }}
                  className="w-full py-2 border-2 border-dashed border-primary text-primary font-semibold text-xs rounded-lg hover:bg-primary/5 flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">add</span> Thêm Siro Ho Astex vào đơn
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t mt-4">
              <button
                onClick={() => {
                  setShowEditOrderModal(false);
                  showToast('Đã lưu thay đổi đơn thuốc thành công!');
                }}
                className="py-2.5 px-6 bg-primary text-on-primary font-bold text-sm rounded-lg hover:bg-surface-tint"
              >
                Hoàn tất & Cập nhật
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Gọi điện bệnh nhân */}
      {showCallModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-inverse-surface text-inverse-on-surface rounded-2xl max-w-sm w-full p-6 text-center shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-primary-container text-on-primary-container mx-auto flex items-center justify-center text-2xl mb-4 animate-pulse">
              <span className="material-symbols-outlined">call</span>
            </div>

            <h3 className="font-bold text-lg mb-1">Đang gọi cho bệnh nhân</h3>
            <p className="text-sm font-semibold text-primary-fixed mb-1">{selectedOrder.patientName}</p>
            <p className="text-xs text-outline-variant mb-6">{selectedOrder.patientPhone}</p>

            <div className="bg-surface-container-highest/10 p-3 rounded-lg text-xs text-left mb-6 text-slate-300 space-y-1">
              <p className="font-bold text-white mb-1">Nội dung tư vấn dược sĩ:</p>
              <p>• Xác nhận tiền sử dị ứng & thuốc đang dùng (Metformin).</p>
              <p>• Tư vấn điều chỉnh liều Vitamin C trong Berocca.</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCallModal(false);
                  onCancelAndCall(selectedOrder.id);
                  showToast('Đã kết thúc cuộc gọi tư vấn.');
                }}
                className="w-full py-3 bg-error text-on-error rounded-full font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-700"
              >
                <span className="material-symbols-outlined text-base">call_end</span> Kết thúc cuộc gọi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
