import { doc, onSnapshot } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';

export interface HealthProfile {
  ho_ten?: string;
  benh_nen?: string;
  di_ung?: string;
  nhom_tuoi?: string;
  do_tuoi?: string;
  ghi_chu_suckhoe?: string;
  updatedAt?: unknown;
}

export function subscribeToHealthProfile(userId: string, onUpdate: (profile: HealthProfile) => void, onError?: (error: Error) => void) {
  return onSnapshot(doc(db, 'health_profiles', userId), (snapshot) => {
    onUpdate(snapshot.exists() ? snapshot.data() as HealthProfile : {});
  }, (error) => { console.error('[Firestore] Health profile listener failed:', error); onError?.(error); });
}

export async function fetchHealthProfileFromServer(user: any): Promise<HealthProfile> {
  const token = await user.getIdToken();
  const response = await fetch('/api/health-profile', {
    headers: { authorization: `Bearer ${token}` }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to fetch health profile');
  return result.profile || {};
}

export async function saveHealthProfile(user: User, profile: HealthProfile) {
  const token = await user.getIdToken();
  const response = await fetch('/api/health-profile', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ confirmed: true, profile }) });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || 'Không thể lưu hồ sơ');
  }
}
