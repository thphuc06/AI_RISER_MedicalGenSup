import React, { useState, useEffect } from 'react';

export interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  pharmacistName: string;
  specialty: string;
  dateTime: string;
  timeSlot: string;
  topic: string;
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  meetUrl: string;
  relatedOrderId?: string;
  notes?: string;
  createdAt: string;
}

export const AppointmentsPagePharmacist: React.FC = () => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [pharmacists, setPharmacists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'scheduled' | 'completed' | 'cancelled' | 'no_show'>('pending');
  const [pharmacistFilter, setPharmacistFilter] = useState<string>('all');
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [notesInput, setNotesInput] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // New appointment form state
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [newPharmacist, setNewPharmacist] = useState('');
  const [newSpecialty, setNewSpecialty] = useState('Tim mạch & Huyết áp');
  const [newSlot, setNewSlot] = useState('09:30 - 10:00, Hôm nay');
  const [newTopic, setNewTopic] = useState('');

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/appointments');
      const data = await res.json();
      if (data.success && data.appointments) {
        setAppointments(data.appointments);
        if (data.appointments.length > 0) {
          // If we have selected item, let's find it in the new list to refresh its data
          setSelectedApt((prev) => {
            if (prev) {
              const fresh = data.appointments.find((item: any) => item.id === prev.id);
              if (fresh) return fresh;
            }
            return data.appointments[0];
          });
        }
      }
    } catch (err) {
      console.error('Error fetching pharmacist appointments:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPharmacists = async () => {
    try {
      const res = await fetch('/api/pharmacists');
      const data = await res.json();
      if (data.success && data.pharmacists) {
        setPharmacists(data.pharmacists);
        if (data.pharmacists.length > 0) {
          setNewPharmacist(data.pharmacists[0].fullName);
        }
      }
    } catch (err) {
      console.error('Error fetching pharmacists:', err);
    }
  };

  useEffect(() => {
    fetchAppointments();
    fetchPharmacists();
  }, []);

  const handleUpdateStatus = async (id: string, newStatus: 'scheduled' | 'completed' | 'cancelled' | 'no_show', notes?: string) => {
    try {
      const res = await fetch(`/api/appointments/${encodeURIComponent(id)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, notes }),
      });
      if (res.ok) {
        const resultData = await res.json();
        if (resultData.success && resultData.appointment) {
          setSelectedApt(resultData.appointment);
        }
        fetchAppointments();
      }
    } catch (err) {
      console.error('Error updating appointment:', err);
    }
  };

  const handleAddAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: newPatientName,
          patientPhone: newPatientPhone,
          pharmacistName: newPharmacist,
          specialty: newSpecialty,
          timeSlot: newSlot,
          topic: newTopic,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowAddModal(false);
        fetchAppointments();
        setNewPatientName('');
        setNewPatientPhone('');
        setNewTopic('');
      }
    } catch (err) {
      console.error('Error adding appointment:', err);
    }
  };

  const filtered = appointments.filter((apt) => {
    if (statusFilter !== 'all' && apt.status !== statusFilter) return false;
    if (pharmacistFilter !== 'all' && apt.pharmacistName !== pharmacistFilter) return false;
    return true;
  });

  const pendingCount = appointments.filter((a) => a.status === 'pending').length;
  const scheduledCount = appointments.filter((a) => a.status === 'scheduled').length;

  return (
    <div className="flex flex-col lg:flex-row h-full bg-[#f4f7f6] text-slate-800 overflow-hidden font-sans">
      {/* Left Column: Calendar & Appointment Queue */}
      <div className="w-full lg:w-2/5 border-r border-slate-200 bg-white flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 font-bold text-sm">
              <span className="material-symbols-outlined text-amber-400">calendar_month</span>
              <span>Lịch Trực Ban & Tư Vấn Dược Sĩ</span>
            </div>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Lịch Google Trực Ban Dùng Chung • Google Meet Sync
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="bg-[#00685c] hover:bg-[#005147] text-white font-bold px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            <span>Tạo lịch</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Chờ duyệt ({pendingCount})
            </button>
            <button
              onClick={() => setStatusFilter('scheduled')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'scheduled'
                  ? 'bg-[#00685c] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Sắp diễn ra ({scheduledCount})
            </button>
            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'completed'
                  ? 'bg-[#00685c] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Đã tư vấn
            </button>
            <button
              onClick={() => setStatusFilter('no_show')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'no_show'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Lỡ hẹn ({appointments.filter((a) => a.status === 'no_show').length})
            </button>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-[#00685c] text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Tất cả ({appointments.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-[11px] font-medium shrink-0">Dược sĩ trực:</span>
            <select
              value={pharmacistFilter}
              onChange={(e) => setPharmacistFilter(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs outline-hidden w-full"
            >
              <option value="all">Tất cả Dược sĩ trong ca trực</option>
              {pharmacists.map((p) => (
                <option key={p.id} value={p.fullName}>
                  {p.fullName} ({p.specialties[0]})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Appointment List */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <span className="material-symbols-outlined animate-spin text-2xl text-[#00685c]">
                progress_activity
              </span>
              <span>Đang tải lịch hẹn tư vấn...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <span className="material-symbols-outlined text-3xl mb-1 text-slate-300">event_busy</span>
              <p>Không có lịch hẹn nào trùng khớp</p>
            </div>
          ) : (
            filtered.map((apt) => {
              const isSelected = selectedApt?.id === apt.id;
              return (
                <div
                  key={apt.id}
                  onClick={() => setSelectedApt(apt)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#00685c] bg-teal-50/60 shadow-xs ring-1 ring-[#00685c]'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                      <span>{apt.patientName}</span>
                      <span className="text-[10px] text-slate-500 font-mono">({apt.patientPhone})</span>
                    </div>

                    {apt.status === 'pending' && (
                      <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        Chờ duyệt
                      </span>
                    )}
                    {apt.status === 'scheduled' && (
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        Chờ tư vấn
                      </span>
                    )}
                    {apt.status === 'no_show' && (
                      <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                        Lỡ hẹn (No-show)
                      </span>
                    )}
                    {apt.status === 'completed' && (
                      <span className="bg-slate-100 text-slate-600 text-[10px] font-medium px-2 py-0.5 rounded-full">
                        Hoàn thành
                      </span>
                    )}
                    {apt.status === 'cancelled' && (
                      <span className="bg-rose-100 text-rose-700 text-[10px] font-medium px-2 py-0.5 rounded-full">
                        Đã hủy
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-emerald-800 font-semibold flex items-center gap-1 mb-1">
                    <span className="material-symbols-outlined text-xs">schedule</span>
                    <span>{apt.timeSlot}</span>
                  </div>

                  <div className="text-[11px] text-slate-600 line-clamp-2">
                    <span className="font-medium text-slate-500">Nội dung:</span> {apt.topic}
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                    <span>{apt.pharmacistName}</span>
                    <span className={`${apt.status === 'pending' ? 'text-amber-600' : apt.status === 'no_show' ? 'text-rose-600' : 'text-[#00685c]'} font-medium flex items-center gap-0.5`}>
                      <span className="material-symbols-outlined text-xs">{apt.status === 'pending' ? 'hourglass_empty' : apt.status === 'no_show' ? 'cancel_presentation' : 'video_call'}</span>
                      {apt.status === 'pending' ? 'Chưa duyệt' : apt.status === 'no_show' ? 'Bệnh nhân lỡ hẹn' : 'Google Meet'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Active Appointment Detail Workspace */}
      <div className="flex-1 bg-[#f8faf9] h-full overflow-y-auto p-4 flex flex-col">
        {selectedApt ? (
          <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
            {/* Top Detail Card */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-3">
                <div>
                  <div className="text-[11px] text-[#00685c] font-bold uppercase tracking-wide">
                    {selectedApt.specialty} • Mã: {selectedApt.id}
                  </div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mt-0.5">
                    <span>{selectedApt.patientName}</span>
                    <span className="text-xs text-slate-500 font-normal">({selectedApt.patientPhone})</span>
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  {selectedApt.status === 'pending' ? (
                    <button
                      onClick={() => handleUpdateStatus(selectedApt.id, 'scheduled', 'Dược sĩ đã đồng ý lịch hẹn.')}
                      className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-base">check</span>
                      <span>Duyệt & Tạo phòng Meet</span>
                    </button>
                  ) : selectedApt.status === 'scheduled' ? (
                    <a
                      href={selectedApt.meetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-[#00685c] hover:bg-[#005147] text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-base">video_call</span>
                      <span>Bắt đầu Tư vấn Google Meet</span>
                    </a>
                  ) : (
                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                      Lịch hẹn {selectedApt.status === 'completed' ? 'đã hoàn thành' : selectedApt.status === 'no_show' ? 'bệnh nhân lỡ hẹn (no-show)' : 'đã hủy'}
                    </span>
                  )}
                </div>
              </div>

              {/* Grid Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-4">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">
                    Khung Giờ Ca Trực
                  </span>
                  <div className="font-bold text-emerald-800 flex items-center gap-1 text-sm">
                    <span className="material-symbols-outlined text-base">calendar_clock</span>
                    <span>{selectedApt.timeSlot}</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">
                    Dược Sĩ Đảm Nhận
                  </span>
                  <div className="font-bold text-slate-800 flex items-center gap-1 text-sm">
                    <span className="material-symbols-outlined text-base text-[#00685c]">badge</span>
                    <span>{selectedApt.pharmacistName}</span>
                  </div>
                </div>
              </div>

              {/* Consultation Topic */}
              <div className="mb-4">
                <h3 className="font-bold text-xs text-slate-700 mb-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm text-[#00685c]">description</span>
                  Chủ đề / Yêu cầu tư vấn của Bệnh nhân:
                </h3>
                <div className="bg-amber-50/60 border border-amber-200/80 p-3 rounded-xl text-xs text-slate-800 font-medium">
                  {selectedApt.topic}
                </div>
              </div>

              {/* Actions & Notes Entry */}
              {selectedApt.status === 'pending' && (
                <div className="border-t border-slate-100 pt-4 flex flex-col gap-3">
                  <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-amber-900 text-xs leading-relaxed">
                    <strong>Yêu cầu lịch hẹn mới:</strong> Lịch hẹn này do Bệnh nhân đăng ký hoặc được AI đề xuất và đang chờ bạn phê duyệt. 
                    Khi bạn bấm <strong>Duyệt lịch hẹn</strong>, hệ thống sẽ tự động đồng bộ và tạo phòng họp trực tuyến 
                    <strong>Google Meet</strong> cho cuộc hẹn này.
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleUpdateStatus(selectedApt.id, 'cancelled', 'Bị từ chối bởi Dược sĩ')}
                      className="px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                    >
                      Từ chối cuộc hẹn
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(selectedApt.id, 'scheduled', 'Dược sĩ đã phê duyệt cuộc hẹn.')}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">check</span>
                      <span>Duyệt cuộc hẹn & Tạo Meet</span>
                    </button>
                  </div>
                </div>
              )}

              {selectedApt.status === 'scheduled' && (
                <div className="border-t border-slate-100 pt-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Ghi chú Lâm sàng / Hướng dẫn của Dược sĩ sau tư vấn:
                    </label>
                    <textarea
                      rows={2}
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      placeholder="Nhập ghi chú tư vấn, dặn dò liều dùng hoặc khuyến cáo cho bệnh nhân..."
                      className="w-full border border-slate-300 rounded-xl p-2.5 text-xs focus:ring-2 focus:ring-[#00685c] outline-hidden bg-white"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleUpdateStatus(selectedApt.id, 'cancelled', 'Hủy bởi Dược sĩ')}
                      className="px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                    >
                      Hủy lịch hẹn
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(selectedApt.id, 'no_show', 'Bệnh nhân vắng mặt/lỡ lịch tư vấn.')}
                      className="px-3 py-2 rounded-xl text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-all cursor-pointer flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">cancel_presentation</span>
                      <span>Bệnh nhân vắng mặt (No-show)</span>
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(selectedApt.id, 'completed', notesInput || 'Đã hoàn thành tư vấn trực tuyến.')}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-xs transition-all cursor-pointer flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      <span>Xác nhận Hoàn Thành Tư Vấn</span>
                    </button>
                  </div>
                </div>
              )}

              {(selectedApt.status === 'completed' || selectedApt.status === 'cancelled' || selectedApt.status === 'no_show') && (
                <div className="border-t border-slate-100 pt-3 text-xs text-slate-600">
                  <span className="font-bold">Trạng thái:</span>{' '}
                  <span className="font-semibold">
                    {selectedApt.status === 'completed'
                      ? 'Đã hoàn thành tư vấn'
                      : selectedApt.status === 'no_show'
                      ? 'Khách hàng lỡ hẹn (No-show)'
                      : 'Đã hủy'}
                  </span>
                  {selectedApt.notes && (
                    <div className="mt-1 bg-slate-50 p-2 rounded-lg text-[11px] italic">
                      Ghi chú: {selectedApt.notes}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Google Calendar / Shared Calendar Integration Info Card */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-4 rounded-2xl shadow-sm text-xs border border-slate-700 flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-400 text-2xl shrink-0 mt-0.5">
                sync
              </span>
              <div>
                <h4 className="font-bold text-amber-300 mb-0.5">Tự Động Đồng Bộ Google Calendar & Meet</h4>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  Tất cả cuộc hẹn được tạo tự động bởi <b>Gemini Live AI</b> hoặc Dược sĩ sẽ lập tức xuất hiện trên Lịch Trực Ban chung VietMedCare. Bệnh nhân và Dược sĩ nhận link Google Meet tự động mà không cần thao tác ủy quyền thủ công.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
            <span className="material-symbols-outlined text-4xl mb-2 text-slate-300">event_upcoming</span>
            <p>Chọn một lịch hẹn ở danh sách bên trái để xem chi tiết</p>
          </div>
        )}
      </div>

      {/* Modal: Add Manual Appointment */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-3">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-[#00685c] text-sm flex items-center gap-1.5">
                <span className="material-symbols-outlined">add_circle</span>
                Tạo Lịch Tư Vấn Cho Bệnh Nhân
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleAddAppointment} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Tên Bệnh nhân</label>
                <input
                  type="text"
                  required
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  placeholder="Ví dụ: Nguyễn Văn A"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  required
                  value={newPatientPhone}
                  onChange={(e) => setNewPatientPhone(e.target.value)}
                  placeholder="Ví dụ: 0901234567"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Dược sĩ trực ban</label>
                  <select
                    value={newPharmacist}
                    onChange={(e) => setNewPharmacist(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-2.5 py-2 outline-hidden bg-white"
                  >
                    {pharmacists.map((p) => (
                      <option key={p.id} value={p.fullName}>
                        {p.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Chuyên khoa</label>
                  <select
                    value={newSpecialty}
                    onChange={(e) => setNewSpecialty(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-2.5 py-2 outline-hidden bg-white"
                  >
                    <option value="Tim mạch & Huyết áp">Tim mạch & Huyết áp</option>
                    <option value="Nhi khoa & Mẹ bé">Nhi khoa & Mẹ bé</option>
                    <option value="Thuốc kê đơn Rx">Thuốc kê đơn Rx</option>
                    <option value="Nội tổng quát">Nội tổng quát</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Khung giờ hẹn</label>
                <input
                  type="text"
                  required
                  value={newSlot}
                  onChange={(e) => setNewSlot(e.target.value)}
                  placeholder="Ví dụ: 10:30 - 11:00, Hôm nay"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 outline-hidden"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Nội dung tư vấn</label>
                <textarea
                  required
                  rows={2}
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="Chủ đề tư vấn hoặc dặn dò đặc biệt..."
                  className="w-full border border-slate-300 rounded-xl p-2.5 outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="bg-[#00685c] text-white font-bold px-4 py-1.5 rounded-xl shadow-xs"
                >
                  Thêm Lịch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
