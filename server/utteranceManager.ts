export class UtteranceManager {
  private currentUtterance = '';
  private confirmedTranscript = '';
  private modelTranscript = '';

  public startUtterance(): void {
    this.currentUtterance = '';
  }

  public appendInputFragment(fragment: string): string {
    if (fragment) {
      this.currentUtterance = `${this.currentUtterance} ${fragment}`.trim();
    }
    return this.currentUtterance;
  }

  public appendOutputFragment(fragment: string): string {
    if (fragment) {
      this.modelTranscript = `${this.modelTranscript} ${fragment}`.trim();
    }
    return this.modelTranscript;
  }

  public getCurrentUtterance(): string {
    return this.currentUtterance;
  }

  public getConfirmedTranscript(): string {
    return this.confirmedTranscript;
  }

  public getModelTranscript(): string {
    return this.modelTranscript;
  }

  public confirm(text: string): void {
    this.confirmedTranscript = text.trim();
  }
}
