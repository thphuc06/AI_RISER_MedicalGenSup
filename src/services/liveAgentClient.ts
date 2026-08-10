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
  private processor: ScriptProcessorNode | null = null;
  private nextPlaybackStartTime = 0;
  private isRecording = false;
  private shouldReconnect = false;
  private reconnectTimer: any = null;

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
          this.nextPlaybackStartTime = 0;
          this.callbacks.onInterrupted?.();
        } else if (msg.type === 'error') {
          this.callbacks.onError?.(msg.message);
        }
      } catch (err: any) {
        console.error('[LiveAgentClient] Error handling message:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[LiveAgentClient] WebSocket error:', err);
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

  public sendConfirmedText(text: string) {
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

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.ws?.send(JSON.stringify({ type: 'audio_start' }));

      // Create 16kHz AudioContext for input capture
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtxInput = new AudioCtx({ sampleRate: 16000 });

      const source = this.audioCtxInput.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioCtxInput.createScriptProcessor(4096, 1, 1);

      source.connect(this.processor);
      this.processor.connect(this.audioCtxInput.destination);

      this.isRecording = true;

      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBase64 = this.float32ToBase64Pcm(inputData);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'audio_input',
              audio: pcmBase64,
            })
          );
        }
      };
    } catch (err: any) {
      console.error('[LiveAgentClient] Failed to access microphone:', err);
      this.callbacks.onError?.('Không thể truy cập Microphone: ' + err.message);
    }
  }

  public stopRecording() {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioCtxInput) {
      this.audioCtxInput.close();
      this.audioCtxInput = null;
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'audio_end' }));
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
