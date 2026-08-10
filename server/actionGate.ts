export type ActionState = 'LISTENING' | 'TRANSCRIPT_PENDING' | 'CONFIRMED' | 'PROCESSING';

export class TranscriptActionGate {
  state: ActionState = 'LISTENING';
  confirmedTranscript = '';

  startListening() { this.state = 'LISTENING'; this.confirmedTranscript = ''; }
  markPending() { this.state = 'TRANSCRIPT_PENDING'; this.confirmedTranscript = ''; }
  confirm(text: string) {
    const value = text.trim();
    if (!value) throw new Error('Confirmed transcript cannot be empty');
    this.confirmedTranscript = value;
    this.state = 'CONFIRMED';
  }
  markProcessing() { if (this.state === 'CONFIRMED') this.state = 'PROCESSING'; }
  canMutate() { return Boolean(this.confirmedTranscript) && (this.state === 'CONFIRMED' || this.state === 'PROCESSING'); }
}

export interface PendingProfileUpdate { field: string; value: string }

export class HealthProfileConfirmationGate {
  private pending: PendingProfileUpdate | null = null;
  propose(update: PendingProfileUpdate) { this.pending = { ...update }; }
  confirm(text: string): PendingProfileUpdate | null {
    if (!this.pending || !/^(xác nhận|xac nhan|đồng ý|dong y|đúng|dung|yes|confirm)[.!\s]*$/i.test(text.trim())) return null;
    const approved = this.pending;
    this.pending = null;
    return approved;
  }
  hasPending() { return this.pending !== null; }
}
