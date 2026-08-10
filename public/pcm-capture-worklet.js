class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      if (channelData && channelData.length > 0) {
        for (let i = 0; i < channelData.length; i++) {
          this.buffer[this.bufferIndex++] = channelData[i];
          if (this.bufferIndex >= this.bufferSize) {
            const outBuffer = new Float32Array(this.buffer);
            this.port.postMessage(outBuffer.buffer, [outBuffer.buffer]);
            this.bufferIndex = 0;
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture-worklet', PcmCaptureProcessor);
