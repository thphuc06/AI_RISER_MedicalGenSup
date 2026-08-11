export interface LiveAgentMessageCallbacks {
  onSessionReady?: () => void;
  onAudioOutput?: (base64Audio: string) => void;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onCartAction?: (action: 'refresh', reason?: string) => void;
  onHealthProfileUpdated?: (truong: string, gia_tri: string) => void;
  onEscalate?: (reason: string) => void;
  onError?: (err: string) => void;
  onInterrupted?: () => void;
}

export class LiveAgentClient {
  private ws: WebSocket | null = null;
  private audioCtxInput: AudioContext | null = null;
  private audioCtxOutput: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private nextPlaybackStartTime = 0;
  private isRecording = false;
  private shouldReconnect = false;
  private reconnectTimer: any = null;
  private activeAudioSources: AudioBufferSourceNode[] = [];

  constructor(private callbacks: LiveAgentMessageCallbacks, private readonly tokenProvider: () => Promise<string>) {}

  public connect() {
    this.shouldReconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/live`;

    console.log('[LiveAgentClient] Connecting to WebSocket at:', url);
    try {
      this.ws = new WebSocket(url);
    } catch (err: any) {
      console.error('[LiveAgentClient] Failed to instantiate WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = async () => {
      console.log('[LiveAgentClient] WebSocket connection established.');
      try {
        const idToken = await this.tokenProvider();
        this.ws?.send(JSON.stringify({ type: 'authenticate', idToken }));
      } catch (error) {
        this.callbacks.onError?.('Không thể xác thực phiên Gemini Live.');
        this.ws?.close();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'session_ready') {
          this.callbacks.onSessionReady?.();
        } else if (msg.type === 'audio' && msg.audio) {
          this.playAudioChunk(msg.audio);
          this.callbacks.onAudioOutput?.(msg.audio);
        } else if (msg.type === 'input_transcript' && msg.text) {
          this.callbacks.onInputTranscript?.(msg.text);
        } else if (msg.type === 'output_transcript' && msg.text) {
          this.callbacks.onOutputTranscript?.(msg.text);
        } else if (msg.type === 'cart_action') {
          this.callbacks.onCartAction?.('refresh', msg.warning || msg.reason);
        } else if (msg.type === 'health_profile_updated') {
          this.callbacks.onHealthProfileUpdated?.(msg.truong, msg.gia_tri);
        } else if (msg.type === 'escalate') {
          this.callbacks.onEscalate?.(msg.reason);
        } else if (msg.type === 'interrupted') {
          this.clearAudioQueue();
          this.callbacks.onInterrupted?.();
        } else if (msg.type === 'error') {
          this.callbacks.onError?.(msg.message);
        }
      } catch (err: any) {
        console.error('[LiveAgentClient] Error handling message:', err);
      }
    };

    this.ws.onerror = (event) => {
      console.warn('[LiveAgentClient] WebSocket connection event:', (event as Event)?.type || 'error');
    };

    this.ws.onclose = () => {
      console.log('[LiveAgentClient] WebSocket closed.');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        console.log('[LiveAgentClient] Reconnecting to WebSocket...');
        this.connect();
      }
    }, 2500);
  }

  public clearAudioQueue() {
    for (const source of this.activeAudioSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source may already have finished or stopped
      }
    }
    this.activeAudioSources = [];
    if (this.audioCtxOutput) {
      this.nextPlaybackStartTime = this.audioCtxOutput.currentTime;
    } else {
      this.nextPlaybackStartTime = 0;
    }
  }

  public prepareAudioOutput() {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtxOutput) {
        this.audioCtxOutput = new AudioCtx({ sampleRate: 24000 });
      }
      if (this.audioCtxOutput.state === 'suspended') {
        this.audioCtxOutput.resume();
      }
    } catch (err) {
      console.warn('[LiveAgentClient] Error preparing audio output:', err);
    }
  }

  public stopAudioOutput() {
    this.clearAudioQueue();
    try {
      if (this.audioCtxOutput) {
        this.audioCtxOutput.suspend();
        this.audioCtxOutput.close().catch(() => {});
        this.audioCtxOutput = null;
      }
    } catch (err) {
      console.warn('[LiveAgentClient] Error stopping audio output:', err);
    }
  }

  public sendConfirmedText(text: string) {
    this.clearAudioQueue();
    this.prepareAudioOutput();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'confirm_transcript',
          text,
        })
      );
    }
  }

  public async startRecording() {
    if (this.isRecording) return;
    this.clearAudioQueue();

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx || !AudioCtx.prototype || !('audioWorklet' in AudioCtx.prototype)) {
      const errMsg = 'Trình duyệt không hỗ trợ AudioWorklet API cho ghi âm giọng nói.';
      console.error('[LiveAgentClient]', errMsg);
      this.callbacks.onError?.(errMsg);
      return;
    }

    this.isRecording = true;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (!this.isRecording) {
        this.cleanupRecordingResources();
        return;
      }

      this.audioCtxInput = new AudioCtx({ sampleRate: 16000 });
      if (this.audioCtxInput.state === 'suspended') {
        await this.audioCtxInput.resume();
      }

      await this.audioCtxInput.audioWorklet.addModule('/pcm-capture-worklet.js');

      if (!this.isRecording) {
        this.cleanupRecordingResources();
        return;
      }

      this.sourceNode = this.audioCtxInput.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioCtxInput, 'pcm-capture-worklet');

      this.workletNode.port.onmessage = (event: MessageEvent) => {
        if (!this.isRecording) return;
        const arrayBuffer = event.data as ArrayBuffer;
        if (!arrayBuffer) return;
        const float32Data = new Float32Array(arrayBuffer);
        const pcmBase64 = this.float32ToBase64Pcm(float32Data);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'audio_input',
              audio: pcmBase64,
              mimeType: 'audio/pcm;rate=16000',
            })
          );
        }
      };

      this.sourceNode.connect(this.workletNode);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'audio_start' }));
      }
    } catch (err: any) {
      console.error('[LiveAgentClient] Failed to start recording:', err);
      this.callbacks.onError?.('Không thể truy cập Microphone: ' + err.message);
      this.stopRecording();
    }
  }

  private cleanupRecordingResources() {
    if (this.workletNode) {
      if (this.workletNode.port) {
        this.workletNode.port.onmessage = null;
      }
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioCtxInput) {
      this.audioCtxInput.close().catch(() => {});
      this.audioCtxInput = null;
    }
  }

  public stopRecording() {
    const wasRecording = this.isRecording;
    this.isRecording = false;

    this.cleanupRecordingResources();

    if (wasRecording && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'audio_end' }));
    }
  }

  private playAudioChunk(base64Pcm24k: string) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtxOutput) {
        this.audioCtxOutput = new AudioCtx({ sampleRate: 24000 });
      } else if (this.audioCtxOutput.state === 'suspended') {
        this.audioCtxOutput.resume();
      }

      const binary = atob(base64Pcm24k);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const audioBuffer = this.audioCtxOutput.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = this.audioCtxOutput.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioCtxOutput.destination);

      const now = this.audioCtxOutput.currentTime;
      const startTime = Math.max(now, this.nextPlaybackStartTime);
      source.start(startTime);
      this.nextPlaybackStartTime = startTime + audioBuffer.duration;

      this.activeAudioSources.push(source);
      source.onended = () => {
        this.activeAudioSources = this.activeAudioSources.filter((s) => s !== source);
      };
    } catch (err) {
      console.error('[LiveAgentClient] Error playing audio chunk:', err);
    }
  }

  private float32ToBase64Pcm(float32: Float32Array): string {
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    let binary = '';
    const bytes = new Uint8Array(pcm16.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  public disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopRecording();
    this.clearAudioQueue();
    if (this.audioCtxOutput) {
      this.audioCtxOutput.close();
      this.audioCtxOutput = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
