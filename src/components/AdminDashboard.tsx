import React, { useState, useEffect } from 'react';
import { auth, ensureAuthenticatedUser } from '../firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

interface Product {
  sku: string;
  ten_san_pham: string;
  hoat_chat: string;
  ham_luong_mg: string;
  dang_bao_che: string;
  nhom: string;
  rx_status: string;
  gia: number;
  ton_kho: number;
  chi_dinh_ngan: string;
  cach_dung_co_ban: string;
}

interface Contraindication {
  id?: number;
  hoat_chat: string;
  dieu_kien: string;
  loai: string;
  muc_do: string;
  ly_do_ngan_gon: string;
}

interface MaxDose {
  id?: number;
  hoat_chat: string;
  nhom_tuoi: string;
  max_mg_ngay: number;
}

interface RedFlag {
  id?: number;
  tu_khoa_trieu_chung: string;
  muc_do: string;
  hanh_dong: string;
  thong_diep: string;
}

type TabType = 'products' | 'contraindications' | 'max_doses' | 'red_flags';

export function AdminDashboard() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('products');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Raw data from server
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [contraindicationsList, setContraindicationsList] = useState<Contraindication[]>([]);
  const [maxDosesList, setMaxDosesList] = useState<MaxDose[]>([]);
  const [redFlagsList, setRedFlagsList] = useState<RedFlag[]>([]);

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');

  // Editing forms state
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [editingContra, setEditingContra] = useState<Partial<Contraindication> | null>(null);
  const [editingMaxDose, setEditingMaxDose] = useState<Partial<MaxDose> | null>(null);
  const [editingRedFlag, setEditingRedFlag] = useState<Partial<RedFlag> | null>(null);

  // Authenticate user on mount
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
      } else {
        try {
          const anonymousUser = await ensureAuthenticatedUser();
          setCurrentUser(anonymousUser);
        } catch (err) {
          console.error('[Admin] Authentication failed:', err);
        }
      }
    });
    return () => unsub();
  }, []);

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  // Fetch all lists from the server
  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [resProd, resContra, resMaxDose, resFlags] = await Promise.all([
        fetch('/api/pharmacy/products'),
        fetch('/api/pharmacy/contraindications'),
        fetch('/api/pharmacy/max-doses'),
        fetch('/api/pharmacy/red-flags')
      ]);

      if (resProd.ok) {
        const d = await resProd.json();
        setProductsList(d.data || []);
      }
      if (resContra.ok) {
        const d = await resContra.json();
        setContraindicationsList(d.data || []);
      }
      if (resMaxDose.ok) {
        const d = await resMaxDose.json();
        setMaxDosesList(d.data || []);
      }
      if (resFlags.ok) {
        const d = await resFlags.json();
        setRedFlagsList(d.data || []);
      }
    } catch (err) {
      console.error('[Admin] Error fetching reference tables:', err);
      showMsg('Không thể tải dữ liệu từ server.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchAllData();
    }
  }, [currentUser]);

  // General authenticated server request wrapper
  const sendAdminRequest = async (url: string, method: 'POST' | 'DELETE', body?: unknown) => {
    if (!currentUser) {
      showMsg('Vui lòng đợi thiết lập tài khoản quản trị.', 'error');
      return null;
    }
    setLoading(true);
    try {
      const token = await currentUser.getIdToken();
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`
      };
      if (body) {
        headers['content-type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Server error occurred');
      }

      showMsg(result.message || 'Thao tác thành công!', 'success');
      await fetchAllData();
      return result;
    } catch (err: any) {
      console.error('[Admin Request Error]:', err);
      showMsg(err.message || 'Thao tác thất bại.', 'error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // 1. PRODUCT CRUD
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct?.sku || !editingProduct?.ten_san_pham || !editingProduct?.hoat_chat) {
      showMsg('Vui lòng nhập SKU, Tên sản phẩm và Hoạt chất.', 'error');
      return;
    }
    const res = await sendAdminRequest('/api/admin/products', 'POST', editingProduct);
    if (res) setEditingProduct(null);
  };

  const handleDeleteProduct = async (sku: string) => {
    if (window.confirm(`Bạn có chắc chắn muốn xóa sản phẩm SKU ${sku}?`)) {
      await sendAdminRequest(`/api/admin/products/${encodeURIComponent(sku)}`, 'DELETE');
    }
  };

  // 2. CONTRAINDICATION CRUD
  const handleSaveContra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContra?.hoat_chat || !editingContra?.dieu_kien) {
      showMsg('Vui lòng nhập Hoạt chất và Điều kiện/Bệnh nền chống chỉ định.', 'error');
      return;
    }
    const res = await sendAdminRequest('/api/admin/contraindications', 'POST', editingContra);
    if (res) setEditingContra(null);
  };

  const handleDeleteContra = async (id: number) => {
    if (window.confirm('Xóa thông tin chống chỉ định này?')) {
      await sendAdminRequest(`/api/admin/contraindications/${id}`, 'DELETE');
    }
  };

  // 3. MAX DOSE CRUD
  const handleSaveMaxDose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMaxDose?.hoat_chat || !editingMaxDose?.nhom_tuoi || editingMaxDose?.max_mg_ngay === undefined) {
      showMsg('Vui lòng điền đầy đủ Hoạt chất, Nhóm tuổi và Giới hạn mg/ngày.', 'error');
      return;
    }
    const res = await sendAdminRequest('/api/admin/max-doses', 'POST', editingMaxDose);
    if (res) setEditingMaxDose(null);
  };

  const handleDeleteMaxDose = async (id: number) => {
    if (window.confirm('Xóa quy định giới hạn liều này?')) {
      await sendAdminRequest(`/api/admin/max-doses/${id}`, 'DELETE');
    }
  };

  // 4. RED FLAG CRUD
  const handleSaveRedFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRedFlag?.tu_khoa_trieu_chung) {
      showMsg('Vui lòng điền từ khóa triệu chứng cảnh báo.', 'error');
      return;
    }
    const res = await sendAdminRequest('/api/admin/red-flags', 'POST', editingRedFlag);
    if (res) setEditingRedFlag(null);
  };

  const handleDeleteRedFlag = async (id: number) => {
    if (window.confirm('Xóa cảnh báo triệu chứng này?')) {
      await sendAdminRequest(`/api/admin/red-flags/${id}`, 'DELETE');
    }
  };

  // Filtering lists
  const filteredProducts = productsList.filter(
    (p) =>
      p.ten_san_pham.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.hoat_chat.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredContras = contraindicationsList.filter(
    (c) =>
      c.hoat_chat.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.dieu_kien.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredMaxDoses = maxDosesList.filter((m) =>
    m.hoat_chat.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredRedFlags = redFlagsList.filter((r) =>
    r.tu_khoa_trieu_chung.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6 text-slate-800">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Banner notification */}
        {message && (
          <div
            className={`fixed top-14 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm font-semibold transition-all ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Màn hình Quản trị Dữ liệu Gốc</h1>
            <p className="text-sm text-slate-500 mt-1">
              Thêm mới, cập nhật và đồng bộ trực tiếp thông tin thuốc & an toàn dược lâm sàng vào Cloud SQL.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              PostgreSQL Connected
            </span>
            <button
              onClick={fetchAllData}
              disabled={loading}
              className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-xs">refresh</span>
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-2 rounded-xl shadow-xs border border-slate-200">
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => { setActiveTab('products'); setSearchTerm(''); }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'products'
                  ? 'bg-[#00685c] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined text-sm">medication</span>
              <span>Sản phẩm ({productsList.length})</span>
            </button>
            <button
              onClick={() => { setActiveTab('contraindications'); setSearchTerm(''); }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'contraindications'
                  ? 'bg-[#00685c] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined text-sm">block</span>
              <span>Chống chỉ định ({contraindicationsList.length})</span>
            </button>
            <button
              onClick={() => { setActiveTab('max_doses'); setSearchTerm(''); }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'max_doses'
                  ? 'bg-[#00685c] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined text-sm">scale</span>
              <span>Liều tối đa ({maxDosesList.length})</span>
            </button>
            <button
              onClick={() => { setActiveTab('red_flags'); setSearchTerm(''); }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'red_flags'
                  ? 'bg-[#00685c] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="material-symbols-outlined text-sm">warning</span>
              <span>Triệu chứng đỏ ({redFlagsList.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                search
              </span>
              <input
                type="text"
                placeholder="Tìm kiếm nhanh..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
              />
            </div>

            <button
              onClick={() => {
                if (activeTab === 'products') setEditingProduct({});
                if (activeTab === 'contraindications') setEditingContra({});
                if (activeTab === 'max_doses') setEditingMaxDose({});
                if (activeTab === 'red_flags') setEditingRedFlag({});
              }}
              className="px-3.5 py-1.5 bg-[#00685c] hover:bg-[#005249] text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>Thêm mới</span>
            </button>
          </div>
        </div>

        {/* Dynamic content rendering depending on Active Tab */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Form Side Panel (Only visible when active editing state exists) */}
          {(editingProduct || editingContra || editingMaxDose || editingRedFlag) && (
            <div className="lg:col-span-1 bg-white p-5 rounded-xl border border-slate-200 shadow-md animate-fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-[#00685c]">
                    {editingProduct ? 'medication' : editingContra ? 'block' : editingMaxDose ? 'scale' : 'warning'}
                  </span>
                  <span>
                    {(editingProduct?.sku || editingContra?.id || editingMaxDose?.id || editingRedFlag?.id)
                      ? 'Cập nhật'
                      : 'Thêm mới'}
                  </span>
                </h3>
                <button
                  onClick={() => {
                    setEditingProduct(null);
                    setEditingContra(null);
                    setEditingMaxDose(null);
                    setEditingRedFlag(null);
                  }}
                  className="p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              {/* 1. PRODUCT FORM */}
              {editingProduct && (
                <form onSubmit={handleSaveProduct} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">SKU (Không được trùng)*</label>
                    <input
                      type="text"
                      disabled={!!editingProduct.sku}
                      value={editingProduct.sku || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                      placeholder="VD: PARA500"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c] disabled:bg-slate-100 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Tên biệt dược / Tên sản phẩm*</label>
                    <input
                      type="text"
                      value={editingProduct.ten_san_pham || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, ten_san_pham: e.target.value })}
                      placeholder="VD: Paracetamol 500mg"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Hoạt chất*</label>
                      <input
                        type="text"
                        value={editingProduct.hoat_chat || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, hoat_chat: e.target.value })}
                        placeholder="VD: Paracetamol"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Hàm lượng (mg)</label>
                      <input
                        type="text"
                        value={editingProduct.ham_luong_mg || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, ham_luong_mg: e.target.value })}
                        placeholder="VD: 500"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Dạng bào chế</label>
                      <input
                        type="text"
                        value={editingProduct.dang_bao_che || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, dang_bao_che: e.target.value })}
                        placeholder="VD: Viên nén"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Nhóm điều trị</label>
                      <input
                        type="text"
                        value={editingProduct.nhom || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, nhom: e.target.value })}
                        placeholder="VD: Giảm đau hạ sốt"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Trạng thái kê đơn</label>
                      <select
                        value={editingProduct.rx_status || 'OTC'}
                        onChange={(e) => setEditingProduct({ ...editingProduct, rx_status: e.target.value })}
                        className="w-full px-2 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      >
                        <option value="OTC">OTC (Kẻ đơn không cần)</option>
                        <option value="RX">Rx (Bắt buộc kê đơn)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Đơn giá (đ)</label>
                      <input
                        type="number"
                        value={editingProduct.gia || 0}
                        onChange={(e) => setEditingProduct({ ...editingProduct, gia: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Tồn kho*</label>
                      <input
                        type="number"
                        value={editingProduct.ton_kho ?? 0}
                        onChange={(e) => setEditingProduct({ ...editingProduct, ton_kho: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Chỉ định ngắn (Phục vụ truy vấn ngữ nghĩa AI)*</label>
                    <textarea
                      rows={2}
                      value={editingProduct.chi_dinh_ngan || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, chi_dinh_ngan: e.target.value })}
                      placeholder="VD: Điều trị các cơn đau nhẹ và vừa, hạ sốt nhanh chóng..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c] resize-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Cách dùng cơ bản</label>
                    <textarea
                      rows={2}
                      value={editingProduct.cach_dung_co_ban || ''}
                      onChange={(e) => setEditingProduct({ ...editingProduct, cach_dung_co_ban: e.target.value })}
                      placeholder="VD: Uống 1 viên mỗi 4-6 giờ khi có triệu chứng đau sốt, tối đa 4 viên/ngày."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c] resize-none"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2 bg-[#00685c] hover:bg-[#005249] text-white font-bold rounded-lg cursor-pointer"
                    >
                      Lưu sản phẩm
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingProduct(null)}
                      className="px-3.5 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg font-bold"
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              )}

              {/* 2. CONTRAINDICATION FORM */}
              {editingContra && (
                <form onSubmit={handleSaveContra} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Hoạt chất chịu tác động*</label>
                    <input
                      type="text"
                      value={editingContra.hoat_chat || ''}
                      onChange={(e) => setEditingContra({ ...editingContra, hoat_chat: e.target.value })}
                      placeholder="VD: Paracetamol"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Điều kiện / Bệnh nền chống chỉ định*</label>
                    <textarea
                      rows={2}
                      value={editingContra.dieu_kien || ''}
                      onChange={(e) => setEditingContra({ ...editingContra, dieu_kien: e.target.value })}
                      placeholder="VD: Suy gan nặng, xơ gan mất bù, viêm gan cấp tính..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c] resize-none"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Loại rủi ro</label>
                      <input
                        type="text"
                        value={editingContra.loai || ''}
                        onChange={(e) => setEditingContra({ ...editingContra, loai: e.target.value })}
                        placeholder="VD: Bệnh nền / Tương tác"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Mức độ cảnh báo</label>
                      <select
                        value={editingContra.muc_do || 'Nguy hiểm'}
                        onChange={(e) => setEditingContra({ ...editingContra, muc_do: e.target.value })}
                        className="w-full px-2 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      >
                        <option value="Chống chỉ định">Chống chỉ định (Nguy hiểm nhất)</option>
                        <option value="Nguy hiểm">Nguy hiểm / Thận trọng cao</option>
                        <option value="Cảnh báo">Cảnh báo nhẹ</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Lý do lâm sàng ngắn gọn*</label>
                    <textarea
                      rows={3}
                      value={editingContra.ly_do_ngan_gon || ''}
                      onChange={(e) => setEditingContra({ ...editingContra, ly_do_ngan_gon: e.target.value })}
                      placeholder="VD: Paracetamol chuyển hóa chủ yếu qua gan, có thể làm trầm trọng thêm suy tế bào gan ở bệnh nhân suy gan nặng..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c] resize-none"
                      required
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2 bg-[#00685c] hover:bg-[#005249] text-white font-bold rounded-lg cursor-pointer"
                    >
                      Lưu chống chỉ định
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingContra(null)}
                      className="px-3.5 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg font-bold"
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              )}

              {/* 3. MAX DOSE FORM */}
              {editingMaxDose && (
                <form onSubmit={handleSaveMaxDose} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Hoạt chất*</label>
                    <input
                      type="text"
                      value={editingMaxDose.hoat_chat || ''}
                      onChange={(e) => setEditingMaxDose({ ...editingMaxDose, hoat_chat: e.target.value })}
                      placeholder="VD: Paracetamol"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Nhóm tuổi*</label>
                      <select
                        value={editingMaxDose.nhom_tuoi || 'nguoi_lon'}
                        onChange={(e) => setEditingMaxDose({ ...editingMaxDose, nhom_tuoi: e.target.value })}
                        className="w-full px-2 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      >
                        <option value="nguoi_lon">Người lớn (&ge; 18T)</option>
                        <option value="tre_em">Trẻ em (&lt; 18T)</option>
                        <option value="nguoi_gia">Người cao tuổi (&ge; 65T)</option>
                        <option value="phu_nu_mang_thai">Phụ nữ mang thai</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Liều tối đa/ngày (mg)*</label>
                      <input
                        type="number"
                        value={editingMaxDose.max_mg_ngay || 0}
                        onChange={(e) => setEditingMaxDose({ ...editingMaxDose, max_mg_ngay: Number(e.target.value) })}
                        placeholder="VD: 4000"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2 bg-[#00685c] hover:bg-[#005249] text-white font-bold rounded-lg cursor-pointer"
                    >
                      Lưu quy định liều
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMaxDose(null)}
                      className="px-3.5 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg font-bold"
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              )}

              {/* 4. RED FLAG FORM */}
              {editingRedFlag && (
                <form onSubmit={handleSaveRedFlag} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Từ khóa Triệu chứng Đỏ (Ví dụ lý do nguy hiểm)*</label>
                    <textarea
                      rows={2}
                      value={editingRedFlag.tu_khoa_trieu_chung || ''}
                      onChange={(e) => setEditingRedFlag({ ...editingRedFlag, tu_khoa_trieu_chung: e.target.value })}
                      placeholder="VD: Đau ngực trái lan ra vai, khó thở cấp tính, ho ra máu tươi..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c] resize-none"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Mức độ</label>
                      <select
                        value={editingRedFlag.muc_do || 'Cấp cứu'}
                        onChange={(e) => setEditingRedFlag({ ...editingRedFlag, muc_do: e.target.value })}
                        className="w-full px-2 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      >
                        <option value="Cấp cứu">Cấp cứu khẩn cấp</option>
                        <option value="Khám ngay">Cần đi khám ngay</option>
                        <option value="Thận trọng">Thận trọng theo dõi</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Hành động của AI</label>
                      <input
                        type="text"
                        value={editingRedFlag.hanh_dong || ''}
                        onChange={(e) => setEditingRedFlag({ ...editingRedFlag, hanh_dong: e.target.value })}
                        placeholder="VD: BLOCK / STOP_SELL"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Thông điệp cảnh báo hiển thị/phát âm*</label>
                    <textarea
                      rows={3}
                      value={editingRedFlag.thong_diep || ''}
                      onChange={(e) => setEditingRedFlag({ ...editingRedFlag, thong_diep: e.target.value })}
                      placeholder="VD: Triệu chứng đau ngực trái lan ra sau vai kèm khó thở có thể là dấu hiệu của nhồi máu cơ tim cấp. Hệ thống tạm từ chối bán thuốc, bạn cần gọi ngay cấp cứu 115!"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:border-[#00685c] resize-none"
                      required
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2 bg-[#00685c] hover:bg-[#005249] text-white font-bold rounded-lg cursor-pointer"
                    >
                      Lưu triệu chứng đỏ
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingRedFlag(null)}
                      className="px-3.5 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg font-bold"
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Table list view */}
          <div className={`bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden ${
            (editingProduct || editingContra || editingMaxDose || editingRedFlag) ? 'lg:col-span-2' : 'lg:col-span-3'
          }`}>
            <div className="overflow-x-auto text-xs">
              
              {/* 1. PRODUCTS TABLE */}
              {activeTab === 'products' && (
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-50 font-bold text-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-mono">SKU</th>
                      <th className="px-4 py-3">Tên sản phẩm</th>
                      <th className="px-4 py-3">Hoạt chất</th>
                      <th className="px-4 py-3">Nhóm điều trị</th>
                      <th className="px-4 py-3">Kê đơn</th>
                      <th className="px-4 py-3 text-right">Giá bán</th>
                      <th className="px-4 py-3 text-center">Tồn kho</th>
                      <th className="px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.map((p) => (
                      <tr key={p.sku} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-semibold font-mono text-[#00685c]">{p.sku}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{p.ten_san_pham}</div>
                          <div className="text-[10px] text-slate-400 max-w-xs truncate">{p.chi_dinh_ngan}</div>
                        </td>
                        <td className="px-4 py-3 font-medium">{p.hoat_chat} {p.ham_luong_mg ? `(${p.ham_luong_mg}mg)` : ''}</td>
                        <td className="px-4 py-3 text-slate-500">{p.nhom || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.rx_status === 'RX'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {p.rx_status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {p.gia.toLocaleString('vi-VN')}đ
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-md font-bold ${
                            p.ton_kho === 0
                              ? 'bg-rose-100 text-rose-800'
                              : p.ton_kho <= 10
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {p.ton_kho}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => setEditingProduct(p)}
                            className="px-2 py-1 text-slate-600 hover:text-[#00685c] hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(p.sku)}
                            className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                          Không tìm thấy sản phẩm nào khớp từ khóa.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {/* 2. CONTRAINDICATIONS TABLE */}
              {activeTab === 'contraindications' && (
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-50 font-bold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Hoạt chất</th>
                      <th className="px-4 py-3">Điều kiện chống chỉ định</th>
                      <th className="px-4 py-3">Loại rủi ro</th>
                      <th className="px-4 py-3">Mức độ</th>
                      <th className="px-4 py-3">Lý do lâm sàng ngắn gọn</th>
                      <th className="px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredContras.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-900">{c.hoat_chat}</td>
                        <td className="px-4 py-3 font-medium text-rose-700">{c.dieu_kien}</td>
                        <td className="px-4 py-3 text-slate-500">{c.loai || 'Bệnh nền'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            c.muc_do?.includes('Chống chỉ định')
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {c.muc_do || 'Chống chỉ định'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 max-w-sm truncate" title={c.ly_do_ngan_gon}>
                          {c.ly_do_ngan_gon}
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => setEditingContra(c)}
                            className="px-2 py-1 text-slate-600 hover:text-[#00685c] hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => c.id && handleDeleteContra(c.id)}
                            className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredContras.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          Chưa có thông tin chống chỉ định nào.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {/* 3. MAX DOSES TABLE */}
              {activeTab === 'max_doses' && (
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-50 font-bold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Hoạt chất</th>
                      <th className="px-4 py-3">Nhóm đối tượng / Nhóm tuổi</th>
                      <th className="px-4 py-3 text-right">Liều lượng tối đa một ngày</th>
                      <th className="px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMaxDoses.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-900">{m.hoat_chat}</td>
                        <td className="px-4 py-3">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {m.nhom_tuoi === 'nguoi_lon' ? 'Người lớn (≥ 18T)' : m.nhom_tuoi === 'tre_em' ? 'Trẻ em (< 18T)' : m.nhom_tuoi}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-800">
                          {m.max_mg_ngay.toLocaleString('vi-VN')} mg/ngày
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => setEditingMaxDose(m)}
                            className="px-2 py-1 text-slate-600 hover:text-[#00685c] hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => m.id && handleDeleteMaxDose(m.id)}
                            className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredMaxDoses.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                          Chưa có quy định giới hạn liều tối đa nào được khai báo.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {/* 4. RED FLAGS TABLE */}
              {activeTab === 'red_flags' && (
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-50 font-bold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Từ khóa triệu chứng đỏ</th>
                      <th className="px-4 py-3">Mức độ nguy hiểm</th>
                      <th className="px-4 py-3">Hành động của AI</th>
                      <th className="px-4 py-3">Thông điệp cảnh báo khách hàng</th>
                      <th className="px-4 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRedFlags.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-semibold text-rose-800 max-w-xs truncate" title={r.tu_khoa_trieu_chung}>
                          {r.tu_khoa_trieu_chung}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            {r.muc_do || 'Cấp cứu'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 font-bold">{r.hanh_dong || 'BLOCK'}</td>
                        <td className="px-4 py-3 text-slate-400 max-w-sm truncate" title={r.thong_diep}>
                          {r.thong_diep}
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => setEditingRedFlag(r)}
                            className="px-2 py-1 text-slate-600 hover:text-[#00685c] hover:bg-slate-100 rounded-md cursor-pointer"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => r.id && handleDeleteRedFlag(r.id)}
                            className="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredRedFlags.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                          Chưa cấu hình triệu chứng nguy hiểm nào.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
