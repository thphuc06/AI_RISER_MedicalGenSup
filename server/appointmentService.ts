import { adminDb } from './firebaseAdmin.js';

export interface Appointment {
  id: string; // e.g. "#APT-1001"
  patientId?: string;
  patientName: string;
  patientPhone: string;
  patientEmail?: string;
  pharmacistId?: string; // e.g. "ds_tran_hoang_phuc_uid"
  pharmacistName: string; // e.g. "DS. Trần Hoàng Phúc"
  pharmacistEmail?: string;
  specialty: string; // e.g. "Tim mạch & Huyết áp"
  dateTime: string; // ISO String
  timeSlot: string; // e.g. "09:30 - 10:00, 13/08/2026"
  topic: string; // e.g. "Tư vấn tương tác thuốc Amlodipine & Metformin"
  status: 'pending' | 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  meetUrl: string; // Google Meet link
  relatedOrderId?: string;
  createdAt: string;
  notes?: string;
}

export interface Pharmacist {
  id: string; // matches Firebase Auth UID
  fullName: string;
  email: string;
  phone: string;
  specialties: string[];
  isOnline: boolean;
  rating: number;
  avatarUrl: string;
  workingHours: string;
  createdAt: string;
}

export const initialPharmacists: Pharmacist[] = [
  {
    id: 'ds_tran_hoang_phuc_uid',
    fullName: 'DS. Trần Hoàng Phúc',
    email: 'duocsi.phuc@vietmedcare.com',
    phone: '0901234567',
    specialties: ['Tim mạch & Huyết áp', 'Thuốc kê đơn Rx', 'Nội tổng quát'],
    isOnline: true,
    rating: 4.9,
    avatarUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=300',
    workingHours: '08:00 - 17:00',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ds_nguyen_thi_linh_uid',
    fullName: 'DS. Nguyễn Thị Linh',
    email: 'duocsi.linh@vietmedcare.com',
    phone: '0987654321',
    specialties: ['Nhi khoa & Phụ nữ mang thai', 'Dược lâm sàng', 'Đa khoa'],
    isOnline: true,
    rating: 4.8,
    avatarUrl: 'https://images.unsplash.com/photo-1594824813573-246434de83fb?auto=format&fit=crop&q=80&w=300',
    workingHours: '13:00 - 21:00',
    createdAt: new Date().toISOString(),
  }
];

// Initial sample seed appointments so there is immediate realistic data
const initialAppointments: Appointment[] = [];

// In-memory fallback map for instant updates
const appointmentStore = new Map<string, Appointment>();
initialAppointments.forEach((apt) => appointmentStore.set(apt.id, apt));

/**
 * Seed initial pharmacists into Firestore
 */
export async function seedInitialPharmacists(): Promise<void> {
  try {
    for (const p of initialPharmacists) {
      await adminDb.collection('pharmacists').doc(p.id).set(p);
      await adminDb.collection('authorized_pharmacists').doc(p.id).set({
        id: p.id,
        email: p.email,
        fullName: p.fullName,
        role: 'pharmacist',
        serverSecret: 'SECURE_SERVER_SECRET_180406_PHUC'
      });
    }
    console.log('[AppointmentService] Initialized and seeded pharmacists successfully!');
  } catch (err) {
    console.error('[AppointmentService] Error seeding pharmacists:', err);
  }
}

/**
 * Fetch all pharmacists from Firestore
 */
export async function getPharmacists(): Promise<Pharmacist[]> {
  try {
    const snapshot = await adminDb.collection('pharmacists').get();
    if (!snapshot.empty) {
      return snapshot.docs.map(doc => doc.data() as Pharmacist);
    }
    // If empty, let's seed them!
    await seedInitialPharmacists();
    return initialPharmacists;
  } catch (err) {
    console.warn('[AppointmentService] Firestore error fetching pharmacists, using in-memory:', err);
    return initialPharmacists;
  }
}

/**
 * Helper to parse comma-separated specialties
 */
function parseSpecialties(specialtyInput: string): string[] {
  if (!specialtyInput) return [];
  return specialtyInput
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Find the most suitable online or offline pharmacist for a given specialty
 */
export async function findAvailablePharmacist(specialty: string): Promise<Pharmacist> {
  const pharmacists = await getPharmacists();
  const searchSpecs = parseSpecialties(specialty).map((s) => s.toLowerCase());

  const targetPharmacistsWithScores = pharmacists.map((p) => {
    let score = 0;
    p.specialties.forEach((s) => {
      const sLower = s.toLowerCase();
      searchSpecs.forEach((spec) => {
        if (sLower.includes(spec) || spec.includes(sLower)) {
          score += 1;
        }
      });
    });
    return { p, score };
  });

  // Filter candidates with score > 0 and sort: higher score first, online first
  const candidates = targetPharmacistsWithScores.filter((item) => item.score > 0);
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.p.isOnline !== b.p.isOnline) return a.p.isOnline ? -1 : 1;
    return 0;
  });

  if (candidates.length > 0) {
    // Try to find the first online candidate
    const onlineCandidate = candidates.find((c) => c.p.isOnline);
    if (onlineCandidate) return onlineCandidate.p;
    return candidates[0].p;
  }

  // If no specialty match, try to find any online pharmacist
  const anyOnline = pharmacists.find((p) => p.isOnline);
  if (anyOnline) return anyOnline;

  // Ultimate fallback
  return pharmacists[0] || initialPharmacists[0];
}

/**
 * Fetch all appointments from Firestore or fallback store
 */
export async function getAllAppointments(): Promise<Appointment[]> {
  const now = new Date();
  
  // Helper to auto update past appointments in memory
  const autoUpdateInMemory = () => {
    appointmentStore.forEach((apt) => {
      const aptTime = new Date(apt.dateTime);
      const finishedTime = new Date(aptTime.getTime() + 30 * 60 * 1000); // slot is 30 mins
      if (finishedTime < now) {
        if (apt.status === 'scheduled') {
          apt.status = 'completed';
          apt.notes = apt.notes || 'Tự động hoàn thành do hết giờ';
        } else if (apt.status === 'pending') {
          apt.status = 'cancelled';
          apt.notes = apt.notes || 'Tự động hủy do hết giờ duyệt';
        }
      }
    });
  };

  try {
    const snapshot = await adminDb.collection('appointments').get();
    if (!snapshot.empty) {
      const list: Appointment[] = [];
      const updates: Promise<any>[] = [];

      snapshot.docs.forEach((doc) => {
        const data = doc.data() as Appointment;
        let status = data.status || 'pending';
        let meetUrl = data.meetUrl || '';
        let notes = data.notes || '';
        let needsUpdate = false;

        const aptTime = new Date(data.dateTime);
        const finishedTime = new Date(aptTime.getTime() + 30 * 60 * 1000);

        if (finishedTime < now) {
          if (status === 'scheduled') {
            status = 'completed';
            notes = notes || 'Tự động hoàn thành do hết giờ';
            needsUpdate = true;
          } else if (status === 'pending') {
            status = 'cancelled';
            notes = notes || 'Tự động hủy do hết giờ duyệt';
            needsUpdate = true;
          }
        }

        const updatedApt: Appointment = {
          ...data,
          id: data.id || `#${doc.id}`,
          status,
          meetUrl,
          notes: notes || undefined
        };

        if (needsUpdate) {
          updates.push(
            adminDb.collection('appointments').doc(doc.id).update({
              status,
              notes,
              updatedAt: now.toISOString(),
            })
          );
        }

        // Also update memory store
        appointmentStore.set(updatedApt.id, updatedApt);
        list.push(updatedApt);
      });

      if (updates.length > 0) {
        Promise.all(updates).catch(err => console.error('[AppointmentService] Error batch updating expired appointments:', err));
      }

      list.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
      return list;
    }
  } catch (err) {
    console.warn('[AppointmentService] Firestore fetch error, using in-memory fallback store:', err);
  }

  autoUpdateInMemory();
  const list = Array.from(appointmentStore.values());
  list.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
  return list;
}

/**
 * Get appointments for a specific user ID or phone
 */
export async function getUserAppointments(userId?: string, phone?: string): Promise<Appointment[]> {
  const all = await getAllAppointments();
  if (!userId && !phone) return all;
  return all.filter((a) => (userId && a.patientId === userId) || (phone && a.patientPhone === phone) || true);
}

/**
 * Create a new appointment
 */
export async function createAppointment(data: Omit<Appointment, 'id' | 'createdAt' | 'status' | 'meetUrl'>): Promise<Appointment> {
  const nextNum = Math.floor(1000 + Math.random() * 9000);
  const id = `#APT-${nextNum}`;
  const meetUrl = ""; // No Google Meet link until approved by pharmacist

  let resolvedPharmacistName = data.pharmacistName;
  let resolvedPharmacistEmail = data.pharmacistEmail || '';
  let resolvedPharmacistId = data.pharmacistId || '';

  if (resolvedPharmacistId && !resolvedPharmacistName) {
    const pharmacists = await getPharmacists();
    const p = pharmacists.find((item) => item.id === resolvedPharmacistId);
    if (p) {
      resolvedPharmacistName = p.fullName;
      resolvedPharmacistEmail = p.email;
    }
  }

  if (!resolvedPharmacistName) {
    const assigned = await findAvailablePharmacist(data.specialty || 'Tư vấn Dược lâm sàng');
    resolvedPharmacistName = assigned.fullName;
    resolvedPharmacistEmail = assigned.email;
    resolvedPharmacistId = assigned.id;
  }

  const newApt: Appointment = {
    ...data,
    id,
    pharmacistId: resolvedPharmacistId,
    pharmacistName: resolvedPharmacistName,
    pharmacistEmail: resolvedPharmacistEmail,
    status: 'pending',
    meetUrl,
    createdAt: new Date().toISOString(),
  };

  appointmentStore.set(id, newApt);

  try {
    const docRef = adminDb.collection('appointments').doc(id.replace('#', ''));
    await docRef.set(newApt);
    console.log(`[AppointmentService] Created pending appointment ${id} in Firestore`);
  } catch (err) {
    console.error(`[AppointmentService] Firestore save error for ${id}, stored in memory:`, err);
  }

  return newApt;
}

function parseRequestedDate(dateStr: string): string {
  const normalized = dateStr.toLowerCase();
  const now = new Date();
  if (normalized.includes('hôm nay') || normalized === 'today') {
    return now.toISOString().split('T')[0];
  }
  if (normalized.includes('ngày mai') || normalized === 'tomorrow') {
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    return tomorrow.toISOString().split('T')[0];
  }
  // Try to match YYYY-MM-DD
  const match = dateStr.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  return now.toISOString().split('T')[0]; // Default to today
}

function generateSlotsForPharmacist(workingHours: string): string[] {
  let startHour = 8;
  let endHour = 17;
  if (workingHours.includes('-')) {
    const parts = workingHours.split('-');
    const startStr = parts[0].trim();
    const endStr = parts[1].trim();
    const startH = parseInt(startStr.split(':')[0], 10);
    const endH = parseInt(endStr.split(':')[0], 10);
    if (!isNaN(startH)) startHour = startH;
    if (!isNaN(endH)) endHour = endH;
  }

  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    if (startHour <= 12 && endHour >= 13 && h === 12) {
      continue; // lunch break
    }
    const hStr = h < 10 ? `0${h}` : `${h}`;
    slots.push(`${hStr}:00 - ${hStr}:30`);
    slots.push(`${hStr}:30 - ${(h + 1) < 10 ? `0${h+1}` : h+1}:00`);
  }
  return slots;
}

export interface AvailablePharmacistSlots {
  pharmacistId: string;
  fullName: string;
  specialties: string[];
  avatarUrl: string;
  isOnline: boolean;
  date: string;
  availableSlots: string[];
}

/**
 * Checks all pharmacists availability for a given specialty and requested date range/day.
 * Filters out slots that are already booked in Firestore.
 */
export async function checkPharmacistsAvailability(
  specialty: string,
  requestedDateStr: string
): Promise<AvailablePharmacistSlots[]> {
  const dateStr = parseRequestedDate(requestedDateStr);
  const pharmacists = await getPharmacists();
  const allAppointments = await getAllAppointments();

  const searchSpecs = parseSpecialties(specialty).map((s) => s.toLowerCase());
  
  const targetPharmacistsWithScores = pharmacists.map((p) => {
    let score = 0;
    p.specialties.forEach((s) => {
      const sLower = s.toLowerCase();
      searchSpecs.forEach((spec) => {
        if (sLower.includes(spec) || spec.includes(sLower)) {
          score += 1;
        }
      });
    });
    return { p, score };
  });

  // Filter candidates with score > 0
  const filtered = targetPharmacistsWithScores.filter((item) => item.score > 0);
  
  // Sort by score descending (highest weight first), then online status, then general order
  filtered.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.p.isOnline !== b.p.isOnline) {
      return a.p.isOnline ? -1 : 1;
    }
    return 0;
  });

  const targets = filtered.length > 0 ? filtered.map((item) => item.p) : pharmacists;
  const result: AvailablePharmacistSlots[] = [];

  for (const p of targets) {
    const allWorkingSlots = generateSlotsForPharmacist(p.workingHours);
    
    const pharmacistApts = allAppointments.filter((apt) => {
      if (apt.pharmacistId !== p.id) return false;
      if (apt.status === 'cancelled') return false;
      
      const aptDate = apt.dateTime.split('T')[0];
      if (aptDate === dateStr) return true;

      const lowerSlot = apt.timeSlot.toLowerCase();
      if (requestedDateStr.includes('hôm nay') && lowerSlot.includes('hôm nay')) return true;
      if (requestedDateStr.includes('ngày mai') && lowerSlot.includes('ngày mai')) return true;

      return false;
    });

    const availableSlots = allWorkingSlots.filter((slot) => {
      const isBooked = pharmacistApts.some((apt) => {
        return apt.timeSlot.includes(slot.split(' - ')[0]);
      });
      return !isBooked;
    });

    result.push({
      pharmacistId: p.id,
      fullName: p.fullName,
      specialties: p.specialties,
      avatarUrl: p.avatarUrl,
      isOnline: p.isOnline,
      date: dateStr,
      availableSlots,
    });
  }

  return result;
}

/**
 * Update appointment status
 */
export async function updateAppointmentStatus(id: string, status: 'pending' | 'scheduled' | 'completed' | 'cancelled' | 'no_show', notes?: string): Promise<Appointment | null> {
  const existing = appointmentStore.get(id) || Array.from(appointmentStore.values()).find((a) => a.id === id || a.id === `#${id}`);
  if (!existing) return null;

  let meetUrl = existing.meetUrl || '';
  if (status === 'scheduled' && !meetUrl) {
    const meetCode = Math.random().toString(36).substring(2, 6) + '-' + Math.random().toString(36).substring(2, 6) + '-' + Math.random().toString(36).substring(2, 6);
    meetUrl = `https://meet.google.com/${meetCode}`;
  }

  existing.status = status;
  existing.meetUrl = meetUrl;
  if (notes) existing.notes = notes;
  appointmentStore.set(existing.id, existing);

  try {
    const docId = existing.id.replace('#', '');
    await adminDb.collection('appointments').doc(docId).update({
      status,
      meetUrl,
      ...(notes ? { notes } : {}),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[AppointmentService] Firestore update error for ${id}:`, err);
  }

  return existing;
}
