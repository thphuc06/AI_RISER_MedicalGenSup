export type ActionState = 'LISTENING' | 'TRANSCRIPT_PENDING' | 'CONFIRMED' | 'PROCESSING';

export interface PendingCartOp {
  type: 'add' | 'remove';
  sku: string;
  quantity?: number;
  source?: string;
}

export class TranscriptActionGate {
  state: ActionState = 'LISTENING';
  confirmedTranscript = '';
  pendingCartOp: PendingCartOp | null = null;

  startListening() {
    this.state = 'LISTENING';
    this.pendingCartOp = null;
  }
  markPending() { this.state = 'TRANSCRIPT_PENDING'; }
  confirm(text: string) {
    const value = text.trim();
    if (!value) throw new Error('Confirmed transcript cannot be empty');
    this.confirmedTranscript = value;
    this.state = 'CONFIRMED';
  }
  markProcessing() { if (this.state === 'CONFIRMED') this.state = 'PROCESSING'; }
  canMutate() { return Boolean(this.confirmedTranscript) && (this.state === 'CONFIRMED' || this.state === 'PROCESSING'); }

  proposeCartOp(op: PendingCartOp) {
    this.pendingCartOp = op;
  }
  getPendingCartOp() {
    return this.pendingCartOp;
  }
  clearPendingCartOp() {
    this.pendingCartOp = null;
  }
}

export interface PendingProfileUpdate { field: string; value: string }

export class HealthProfileConfirmationGate {
  private pending: PendingProfileUpdate | null = null;
  propose(update: PendingProfileUpdate) { this.pending = { ...update }; }
  confirm(text: string): PendingProfileUpdate | null {
    if (!this.pending) return null;
    const trimmed = text.trim();
    if (!/(xác nhận|xac nhan|đồng ý|dong y|đúng|dung|chính xác|chinh xac|\bok\b|\bokay\b|\byes\b|confirm|lưu|luu)/i.test(trimmed)) return null;
    const approved = this.pending;
    this.pending = null;
    return approved;
  }
  hasPending() { return this.pending !== null; }
}
