import React, { useState, useEffect } from 'react';
import { Order, CartItem } from '../types';

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

  const filteredOrders = orders.filter((o) => {
    const query = searchQuery.toLowerCase();
    return (
      o.id.toLowerCase().includes(query) ||
      o.patientName.toLowerCase().includes(query) ||
      o.patientPhone.includes(query)
    );
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
              <div className="p-3.5 border-b border-[#bdc9c5] bg-[#ebefec] flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase text-[#3e4946] tracking-wider">
                  Hàng đợi duyệt ({filteredOrders.length})
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

              <div className="flex-1 overflow-y-auto space-y-px">
                {filteredOrders.length === 0 ? (
                  <div className="p-6 text-center text-[#3e4946] text-xs">Không tìm thấy đơn hàng</div>
                ) : (
                  filteredOrders.map((ord) => {
                    const isSelected = ord.id === selectedOrderId;
                    return (
                      <div
                        key={ord.id}
                        onClick={() => onSelectOrder(ord.id)}
                        className={`p-3.5 cursor-pointer transition-colors border-b border-[#dfe3e1] ${
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
                          Bệnh nhân: {ord.patientAge} tuổi ({ord.patientName})
                        </p>

                        <div className="flex items-center gap-2 flex-wrap">
                          {ord.priority === 'Cần gọi' && (
                            <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded uppercase">
                              Cần gọi
                            </span>
                          )}
                          {ord.priority === 'Nhanh' && (
                            <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded uppercase">
                              Nhanh
                            </span>
                          )}
                          {ord.priority === 'Tiêu chuẩn' && (
                            <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded uppercase">
                              Tiêu chuẩn
                            </span>
                          )}
                          {(ord.status === 'cho_duyet' || ord.status === 'pending') && (
                            <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded uppercase">
                              Chờ duyệt
                            </span>
                          )}
                          {(ord.status === 'duoc_duyet' || ord.status === 'approved') && (
                            <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded uppercase">
                              Được duyệt
                            </span>
                          )}
                          {ord.status === 'da_thanh_toan' && (
                            <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded uppercase">
                              Đã thanh toán
                            </span>
                          )}
                          {(ord.status === 'da_huy' || ord.status === 'rejected') && (
                            <span className="inline-block px-2 py-0.5 bg-red-100 text-red-800 text-[10px] font-bold rounded uppercase">
                              Đã hủy
                            </span>
                          )}
                          {ord.status === 'calling' && (
                            <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-bold rounded uppercase animate-pulse">
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
            {selectedOrder ? (
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
                      Bệnh nhân: <strong className="text-[#181c1b]">{selectedOrder.patientName}</strong> ({selectedOrder.patientAge} tuổi • {selectedOrder.patientPhone}) • Thời gian xử lý: <span className="font-semibold text-[#00685c]">{formatTimer(timerSeconds)}</span>
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
                  {/* Left sub-column: Clinical summary & warnings */}
                  <div className="space-y-4">
                    <div className="bg-white border border-[#bdc9c5] rounded-xl p-4 shadow-xs">
                      <div className="flex items-center gap-2 mb-3 border-b border-[#f1f4f2] pb-2">
                        <span className="text-[#00685c] material-symbols-outlined text-lg">clinical_notes</span>
                        <h3 className="text-sm font-bold uppercase tracking-wide text-[#181c1b]">
                          Tóm tắt lâm sàng
                        </h3>
                      </div>

                      <div className="space-y-3">
                        <div className="grid grid-cols-2 text-[11px] border-b border-gray-100 pb-1.5">
                          <span className="text-gray-500 uppercase font-medium">Đối tượng</span>
                          <span className="font-bold text-right text-[#181c1b]">
                            {selectedOrder.clinicalSummary.gender}, {selectedOrder.clinicalSummary.age} tuổi
                          </span>
                        </div>

                        <div className="grid grid-cols-2 text-[11px] border-b border-gray-100 pb-1.5">
                          <span className="text-gray-500 uppercase font-medium">Tiền sử AI ghi nhận</span>
                          <span className="text-right flex flex-wrap justify-end gap-1">
                            {selectedOrder.clinicalSummary.medicalHistory.map((item, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-gray-100 text-[#3e4946] rounded text-[10px] font-medium">
                                {item}
                              </span>
                            ))}
                          </span>
                        </div>

                        <div className="bg-[#f6faf8] p-3 rounded-lg border border-[#bdc9c5] text-xs leading-relaxed">
                          <strong className="text-[#00685c] uppercase text-[10px] block mb-1">
                            Triệu chứng khai báo:
                          </strong>
                          {selectedOrder.clinicalSummary.symptoms}
                        </div>

                        {selectedOrder.voiceTranscript && (
                          <div className="bg-emerald-50/60 p-3 rounded-lg border border-emerald-200 text-xs">
                            <strong className="text-[#00685c] uppercase text-[10px] block mb-1 flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">graphic_eq</span>
                              Voice Shopping Record:
                            </strong>
                            <p className="italic text-[#181c1b]">"{selectedOrder.voiceTranscript}"</p>
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
