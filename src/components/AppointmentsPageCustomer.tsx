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

export const AppointmentsPageCustomer: React.FC = () => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [pharmacists, setPharmacists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'scheduled' | 'past'>('scheduled');
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state for booking new appointment
  const [patientName, setPatientName] = useState('Trần Văn Nam');
  const [patientPhone, setPatientPhone] = useState('0901234567');
  const [pharmacistName, setPharmacistName] = useState('');
  const [specialty, setSpecialty] = useState('Tim mạch & Huyết áp');
  const [date, setDate] = useState('2026-08-13');
  const [time, setTime] = useState('09:30');
  const [topic, setTopic] = useState('Tư vấn sử dụng thuốc cao huyết áp và cảnh báo tương tác');

  const fetchAppointments = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/appointments');
      const data = await res.json();
      if (data.success && data.appointments) {
        setAppointments(data.appointments);
      }
    } catch (err) {
      console.error('Error loading appointments:', err);
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
      }
    } catch (err) {
      console.error('Error fetching pharmacists:', err);
    }
  };

  const findMatchingPharmacist = (spec: string, list: any[]) => {
    if (list.length === 0) return 'DS. Trần Hoàng Phúc';
    const searchSpec = spec ? spec.toLowerCase() : '';
    let found = list.find((p) => p.isOnline && p.specialties.some((s: string) => s.toLowerCase().includes(searchSpec) || searchSpec.includes(s.toLowerCase())));
    if (!found) {
      found = list.find((p) => p.specialties.some((s: string) => s.toLowerCase().includes(searchSpec) || searchSpec.includes(s.toLowerCase())));
    }
    if (!found) {
      found = list.find((p) => p.isOnline);
    }
    return found ? found.fullName : list[0].fullName;
  };

  useEffect(() => {
    fetchAppointments();
    fetchPharmacists();
  }, []);

  useEffect(() => {
    if (pharmacists.length > 0) {
      const matched = findMatchingPharmacist(specialty, pharmacists);
      setPharmacistName(matched);
    }
  }, [pharmacists, specialty]);

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const formattedSlot = `${time}, ngày ${date.split('-').reverse().join('/')}`;
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName,
          patientPhone,
          pharmacistName,
          specialty,
          dateTime: new Date(`${date}T${time}:00`).toISOString(),
          timeSlot: formattedSlot,
          topic,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        fetchAppointments();
        setTopic('');
      } else {
        alert('Lỗi: ' + data.error);
      }
    } catch (err) {
      console.error('Error booking appointment:', err);
      alert('Không thể tạo lịch hẹn. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelAppointment = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn hủy lịch hẹn này không?')) return;
    try {
      const res = await fetch(`/api/appointments/${encodeURIComponent(id)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', notes: 'Hủy bởi người dùng' }),
      });
      if (res.ok) fetchAppointments();
    } catch (err) {
      console.error('Failed to cancel appointment:', err);
    }
  };

  const filtered = appointments.filter((apt) => {
    if (activeTab === 'scheduled') return apt.status === 'scheduled' || apt.status === 'pending';
    if (activeTab === 'past') return apt.status === 'completed' || apt.status === 'cancelled' || apt.status === 'no_show';
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-[#f8faf9] text-slate-800 p-3 overflow-y-auto font-sans">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#00685c] to-[#00897b] rounded-2xl p-4 text-white shadow-md mb-4 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-amber-300">calendar_month</span>
            <h2 className="font-bold text-base">Lịch Hẹn Tư Vấn Trực Tuyến</h2>
          </div>
          <p className="text-xs text-emerald-100">
            Hẹn giờ trao đổi 1-1 với Dược sĩ chuyên khoa qua Google Meet
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
        >
          <span className="material-symbols-outlined text-base">add_circle</span>
          <span>Đặt lịch mới</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('scheduled')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
            activeTab === 'scheduled'
              ? 'bg-[#00685c] text-white shadow-xs'
              : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <span className="material-symbols-outlined text-sm">schedule</span>
          <span>Sắp diễn ra ({appointments.filter((a) => a.status === 'scheduled' || a.status === 'pending').length})</span>
        </button>

        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
            activeTab === 'all'
              ? 'bg-[#00685c] text-white shadow-xs'
              : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <span>Tất cả ({appointments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('past')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
            activeTab === 'past'
              ? 'bg-[#00685c] text-white shadow-xs'
              : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <span>Đã qua ({appointments.filter((a) => a.status === 'completed' || a.status === 'cancelled' || a.status === 'no_show').length})</span>
        </button>
      </div>

      {/* Appointment List */}
      {loading ? (
        <div className="py-10 text-center text-slate-500 text-xs flex flex-col items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-2xl text-[#00685c]">
            progress_activity
          </span>
          <span>Đang tải danh sách lịch hẹn...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 shadow-xs my-4 flex flex-col items-center">
          <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">
            event_busy
          </span>
          <h3 className="font-semibold text-sm text-slate-700">Chưa có lịch hẹn nào</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">
            Bạn có thể hẹn giờ tư vấn 1-1 với Dược sĩ chuyên khoa VietMed Care bất cứ lúc nào.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 bg-[#00685c] text-white font-semibold px-4 py-2 rounded-xl text-xs hover:bg-[#005147] transition-all cursor-pointer shadow-xs"
          >
            Đặt lịch tư vấn ngay
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((apt) => (
            <div
              key={apt.id}
              className={`bg-white rounded-2xl p-4 border shadow-xs transition-all ${
                apt.status === 'scheduled'
                  ? 'border-emerald-300 bg-gradient-to-br from-emerald-50/30 to-white'
                  : apt.status === 'pending'
                  ? 'border-amber-300 bg-gradient-to-br from-amber-50/30 to-white'
                  : apt.status === 'completed'
                  ? 'border-slate-200 opacity-90'
                  : apt.status === 'no_show'
                  ? 'border-rose-200 bg-rose-50/10 opacity-85'
                  : 'border-rose-200 bg-rose-50/20 opacity-75'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-emerald-100 text-[#00685c] flex items-center justify-center font-bold text-xs shrink-0 border border-emerald-200">
                    <span className="material-symbols-outlined text-lg">clinical_notes</span>
                  </div>
                  <div>
                    <div className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                      <span>{apt.pharmacistName}</span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-[#00685c] border border-teal-200">
                        {apt.specialty}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-xs">person</span>
                      <span>Bệnh nhân: {apt.patientName} ({apt.patientPhone})</span>
                    </div>
                  </div>
                </div>

                {/* Status Badge */}
                <div>
                  {apt.status === 'pending' && (
                    <span className="bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                      Chờ duyệt
                    </span>
                  )}
                  {apt.status === 'scheduled' && (
                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Sắp diễn ra
                    </span>
                  )}
                  {apt.status === 'completed' && (
                    <span className="bg-slate-100 text-slate-700 border border-slate-300 px-2.5 py-1 rounded-full text-[10px] font-medium">
                      Đã hoàn thành
                    </span>
                  )}
                  {apt.status === 'no_show' && (
                    <span className="bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      Lỡ hẹn (No-show)
                    </span>
                  )}
                  {apt.status === 'cancelled' && (
                    <span className="bg-rose-100 text-rose-700 border border-rose-300 px-2.5 py-1 rounded-full text-[10px] font-medium">
                      Đã hủy
                    </span>
                  )}
                </div>
              </div>

              {/* Time slot & Details */}
              <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100 my-2 text-xs flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                  <span className="material-symbols-outlined text-base text-[#00685c]">
                    event_available
                  </span>
                  <span>{apt.timeSlot}</span>
                </div>

                <div className="text-slate-700">
                  <span className="font-medium text-slate-500">Chủ đề / Lý do tư vấn:</span>{' '}
                  <span>{apt.topic}</span>
                </div>

                {apt.notes && (
                  <div className="text-[11px] text-slate-500 italic bg-white p-2 rounded-lg border border-slate-200/60">
                    <span className="font-semibold text-slate-600">Ghi chú Dược sĩ:</span> {apt.notes}
                  </div>
                )}
              </div>

              {/* Actions & Google Meet Button */}
              <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-100">
                <span className="text-[10px] text-slate-400 font-mono">Mã lịch: {apt.id}</span>

                <div className="flex items-center gap-2">
                  {(apt.status === 'scheduled' || apt.status === 'pending') && (
                    <button
                      onClick={() => handleCancelAppointment(apt.id)}
                      className="text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg font-medium transition-all cursor-pointer"
                    >
                      Hủy lịch
                    </button>
                  )}

                  {apt.status === 'scheduled' ? (
                    <a
                      href={apt.meetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-[#00685c] hover:bg-[#005147] text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-base">video_call</span>
                      <span>Vào họp Google Meet</span>
                    </a>
                  ) : apt.status === 'pending' ? (
                    <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">hourglass_empty</span>
                      <span>Dược sĩ đang duyệt...</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">info</span>
                      <span>
                        {apt.status === 'completed'
                          ? 'Đã hoàn thành'
                          : apt.status === 'no_show'
                          ? 'Bệnh nhân lỡ hẹn'
                          : 'Đã hủy'}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Book New Appointment */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-3">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2 text-[#00685c] font-bold text-base">
                <span className="material-symbols-outlined">edit_calendar</span>
                <span>Đặt Lịch Tư Vấn Trực Tuyến</span>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Họ và tên Bệnh nhân</label>
                <input
                  type="text"
                  required
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 focus:ring-2 focus:ring-[#00685c] outline-hidden"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Số điện thoại liên hệ</label>
                <input
                  type="tel"
                  required
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 focus:ring-2 focus:ring-[#00685c] outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Chuyên khoa tư vấn</label>
                  <select
                    value={specialty}
                    onChange={(e) => {
                      const newSpec = e.target.value;
                      setSpecialty(newSpec);
                      const matched = findMatchingPharmacist(newSpec, pharmacists);
                      setPharmacistName(matched);
                    }}
                    className="w-full border border-slate-300 rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-[#00685c] outline-hidden bg-white"
                  >
                    <option value="Tim mạch & Huyết áp">Tim mạch & Huyết áp</option>
                    <option value="Nhi khoa & Mẹ bé">Nhi khoa & Mẹ bé</option>
                    <option value="Thuốc kê đơn Rx">Thuốc kê đơn Rx</option>
                    <option value="Nội tổng quát & Dược lâm sàng">Nội tổng quát & Dược lâm sàng</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Dược sĩ phụ trách</label>
                  <input
                    type="text"
                    readOnly
                    value={pharmacistName}
                    className="w-full border border-slate-200 bg-slate-50 text-slate-700 rounded-xl px-3 py-2 font-medium"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Chọn Ngày tư vấn</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-[#00685c] outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Chọn Giờ tư vấn</label>
                  <select
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-2.5 py-2 focus:ring-2 focus:ring-[#00685c] outline-hidden bg-white"
                  >
                    <option value="08:30">08:30 sáng</option>
                    <option value="09:30">09:30 sáng</option>
                    <option value="10:30">10:30 sáng</option>
                    <option value="14:00">14:00 chiều</option>
                    <option value="15:30">15:30 chiều</option>
                    <option value="16:30">16:30 chiều</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Chủ đề / Vấn đề cần tư vấn</label>
                <textarea
                  required
                  rows={2}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Ví dụ: Cần tư vấn cách dùng thuốc hạ áp kết hợp với thuốc tiểu đường..."
                  className="w-full border border-slate-300 rounded-xl p-2.5 focus:ring-2 focus:ring-[#00685c] outline-hidden text-xs"
                />
              </div>

              <div className="bg-emerald-50 rounded-xl p-2.5 text-[11px] text-emerald-800 border border-emerald-200 flex items-center gap-2">
                <span className="material-symbols-outlined text-base shrink-0 text-[#00685c]">
                  videocam
                </span>
                <span>Hệ thống sẽ tự động tạo đường link <b>Google Meet</b> ngay khi bạn bấm xác nhận.</span>
              </div>

              <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-[#00685c] hover:bg-[#005147] text-white font-bold px-5 py-2 rounded-xl shadow-xs cursor-pointer flex items-center gap-1"
                >
                  {submitting ? 'Đang tạo...' : 'Xác nhận Đặt Lịch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
