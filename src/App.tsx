import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PharmacistDashboard } from './components/PharmacistDashboard';
import { VoiceShoppingCustomer } from './components/VoiceShoppingCustomer';
import { INITIAL_ORDERS } from './data/mockData';
import { Order, CartItem } from './types';
import { resolveAppView, type AppView } from './routing';

export default function App() {
  const [viewMode, setViewMode] = useState<AppView>(() => resolveAppView(window.location.pathname, window.location.search));
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');

  useEffect(() => {
    const onPopState = () => setViewMode(resolveAppView(window.location.pathname, window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = (view: AppView) => {
    const url = view === 'pharmacist' ? '/duoc-si' : view === 'split' ? '/?view=split' : '/';
    window.history.pushState({}, '', url);
    setViewMode(view);
  };

  // Split view resizing state
  const [leftWidth, setLeftWidth] = useState<number>(420); // Default 420px width for left phone app
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/orders');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(`HTTP ${res.status}: Non-JSON response`);
      }
      const data = await res.json();
      if (data.success && data.orders && data.orders.length > 0) {
        setOrders(data.orders);
        if (!selectedOrderId) {
          setSelectedOrderId(data.orders[0].id);
        }
      } else {
        // Fallback to INITIAL_ORDERS and seed them to Firestore
        setOrders(INITIAL_ORDERS);
        if (!selectedOrderId && INITIAL_ORDERS.length > 0) {
          setSelectedOrderId(INITIAL_ORDERS[0].id);
        }
        for (const o of INITIAL_ORDERS) {
          await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(o),
          });
        }
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
      setOrders(INITIAL_ORDERS);
      if (!selectedOrderId && INITIAL_ORDERS.length > 0) {
        setSelectedOrderId(INITIAL_ORDERS[0].id);
      }
    }
  };

  useEffect(() => {
    fetchOrders();
    // 5 seconds real-time polling to keep all views in perfect database synchronization
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [selectedOrderId]);

  const handleSelectOrder = (id: string) => {
    setSelectedOrderId(id);
  };

  const handleApproveOrder = async (id: string) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === id) {
          const updated = { ...o, status: 'approved' as const };
          return updated;
        }
        return o;
      })
    );
    try {
      await fetch(`/api/orders/${encodeURIComponent(id)}/approve`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to approve order:', err);
    }
  };

  const handleUpdateOrderItems = async (id: string, items: CartItem[]) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === id) {
          const updated = { ...o, items };
          return updated;
        }
        return o;
      })
    );
    try {
      await fetch(`/api/orders/${encodeURIComponent(id)}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
    } catch (err) {
      console.error('Failed to update order items:', err);
    }
  };

  const handleCreateNewOrder = async (newOrder: Order) => {
    setOrders((prev) => [newOrder, ...prev]);
    setSelectedOrderId(newOrder.id);
    try {
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder),
      });
    } catch (err) {
      console.error('Failed to create order:', err);
    }
  };

  const handleCancelAndCall = async (id: string) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === id) {
          const updated = { ...o, status: 'calling' as const, priority: 'Cần gọi' };
          return updated;
        }
        return o;
      })
    );
    try {
      await fetch(`/api/orders/${encodeURIComponent(id)}/cancel-and-call`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to cancel and call order:', err);
    }
  };

  const handleCustomerSendOrder = async (cartItems: CartItem[], transcript: string) => {
    const newId = `#MD-${Math.floor(8825 + Math.random() * 1000)}`;
    const newOrder: Order = {
      id: newId,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      patientName: 'Khách hàng',
      patientAge: 0,
      patientPhone: '',
      priority: 'Tiêu chuẩn',
      status: 'pending',
      voiceTranscript: transcript,
      clinicalSummary: {
        gender: 'Nam',
        age: 0,
        medicalHistory: [],
        symptoms: 'Đặt hàng mới qua Voice Shopping App: ' + transcript,
        aiTriage: {
          category: 'Voice Shopping Order (Live)',
          riskLevel: 'Trung bình',
          note: 'Hồ sơ hiển thị cục bộ không tự suy diễn dữ liệu sức khỏe.',
        },
      },
      items: cartItems,
      processingTimeSeconds: 10,
    };

    setOrders((prev) => [newOrder, ...prev]);
    setSelectedOrderId(newId);
    try {
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder),
      });
    } catch (err) {
      console.error('Failed to create customer order:', err);
    }
  };

  // Drag handlers for splitting width
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleTouchStart = () => {
    setIsDragging(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDragging || !containerRef.current) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = clientX - containerRect.left;

      // Constrain width between 320px and 60% of screen width
      const minW = 320;
      const maxW = Math.max(minW + 100, containerRect.width * 0.65);
      const clampedWidth = Math.min(Math.max(newWidth, minW), maxW);
      setLeftWidth(clampedWidth);
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove);
      window.addEventListener('touchend', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans select-none">
      {/* Top Banner Navigation bar to toggle views easily */}
      <header className="bg-[#181c1b] text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 shadow-md z-50 text-xs border-b border-[#bdc9c5]/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#00685c] text-lg font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>
            local_pharmacy
          </span>
          <span className="font-bold text-sm text-[#00685c]">VietMed Care AI</span>
          <span className="hidden sm:inline-block text-[#bdc9c5]">|</span>
          <span className="hidden sm:inline-block text-slate-300 text-[11px]">
            Hệ thống Kiểm duyệt AI & Voice Shopping
          </span>
        </div>

        <div className="flex items-center bg-slate-800/80 p-1 rounded-lg gap-1 border border-slate-700">
          <button
            onClick={() => navigateTo('pharmacist')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'pharmacist'
                ? 'bg-[#00685c] text-white shadow-xs'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm">clinical_notes</span>
            <span>Màn hình Dược sĩ</span>
          </button>

          <button
            onClick={() => navigateTo('customer')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'customer'
                ? 'bg-[#00685c] text-white shadow-xs'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm">phone_iphone</span>
            <span>Voice Shopping App</span>
          </button>

          <button
            onClick={() => navigateTo('split')}
            className={`hidden md:flex px-3 py-1.5 rounded-md font-semibold transition-all items-center gap-1.5 cursor-pointer ${
              viewMode === 'split'
                ? 'bg-[#00685c] text-white shadow-xs'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm">view_column</span>
            <span>Chế độ Hai Màn hình</span>
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <div className="flex-1 w-full overflow-hidden">
        {viewMode === 'pharmacist' && (
          <PharmacistDashboard
            orders={orders}
            selectedOrderId={selectedOrderId}
            onSelectOrder={handleSelectOrder}
            onApproveOrder={handleApproveOrder}
            onUpdateOrderItems={handleUpdateOrderItems}
            onCreateNewOrder={handleCreateNewOrder}
            onCancelAndCall={handleCancelAndCall}
            onSwitchToCustomerView={() => navigateTo('customer')}
          />
        )}

        {viewMode === 'customer' && (
          <div className="py-2 px-2 bg-slate-900/10 min-h-screen flex items-center justify-center">
            <VoiceShoppingCustomer
              onSendOrderToPharmacist={handleCustomerSendOrder}
              onSwitchToPharmacistView={() => navigateTo('pharmacist')}
            />
          </div>
        )}

        {viewMode === 'split' && (
          <div
            ref={containerRef}
            className={`flex flex-col lg:flex-row h-[calc(100vh-42px)] w-full overflow-hidden relative ${
              isDragging ? 'cursor-col-resize select-none' : ''
            }`}
          >
            {/* Left side: Voice Shopping Customer App */}
            <div
              style={{ width: window.innerWidth >= 1024 ? `${leftWidth}px` : '100%' }}
              className="shrink-0 h-full overflow-hidden bg-[#ebefec] p-2 flex justify-center items-center transition-[width] duration-75 ease-out"
            >
              <div className="h-full w-full max-w-[420px] rounded-2xl overflow-hidden shadow-xl border border-[#bdc9c5] bg-white flex flex-col">
                <VoiceShoppingCustomer
                  onSendOrderToPharmacist={handleCustomerSendOrder}
                  onSwitchToPharmacistView={() => navigateTo('pharmacist')}
                />
              </div>
            </div>

            {/* Draggable Divider Slider (Visible on desktop/large screens) */}
            <div
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onDoubleClick={() => setLeftWidth(420)}
              title="Kéo trượt để chỉnh độ rộng 2 màn hình (Nhấp đôi để đặt lại mặc định)"
              className={`hidden lg:flex w-4 hover:w-5 bg-[#dfe3e1] hover:bg-[#00685c] group transition-all items-center justify-center cursor-col-resize border-x border-[#bdc9c5] shrink-0 z-30 relative ${
                isDragging ? 'bg-[#00685c] w-5 shadow-lg' : ''
              }`}
            >
              {/* Grip Indicator Handle */}
              <div className="flex flex-col items-center gap-1 py-3 px-0.5 rounded-full bg-white group-hover:bg-white text-[#00685c] shadow-xs border border-[#bdc9c5]">
                <span className="material-symbols-outlined text-xs font-bold select-none">
                  drag_indicator
                </span>
              </div>

              {/* Tooltip hint showing current width */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 text-white text-[10px] py-1 px-2 rounded whitespace-nowrap pointer-events-none shadow-md">
                Kéo trượt: {Math.round(leftWidth)}px
              </div>
            </div>

            {/* Right side: Pharmacist Dashboard */}
            <div className="flex-1 h-full overflow-hidden min-w-[360px]">
              <PharmacistDashboard
                orders={orders}
                selectedOrderId={selectedOrderId}
                onSelectOrder={handleSelectOrder}
                onApproveOrder={handleApproveOrder}
                onUpdateOrderItems={handleUpdateOrderItems}
                onCreateNewOrder={handleCreateNewOrder}
                onCancelAndCall={handleCancelAndCall}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
