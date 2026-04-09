class DeepgramPCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options?.processorOptions?.targetSampleRate || 16000;
    this.ratio = sampleRate / this.targetSampleRate;
    this.buffer = [];
    this.readIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channel = input[0];
    for (let i = 0; i < channel.length; i += 1) {
      this.buffer.push(channel[i]);
    }

    const samples = [];
    while (this.readIndex + this.ratio <= this.buffer.length) {
      const start = Math.floor(this.readIndex);
      const end = Math.max(start + 1, Math.floor(this.readIndex + this.ratio));
      let sum = 0;
      let count = 0;
      for (let i = start; i < end; i += 1) {
        sum += this.buffer[i] || 0;
        count += 1;
      }
      const average = count > 0 ? sum / count : 0;
      const clamped = Math.max(-1, Math.min(1, average));
      samples.push(clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff));
      this.readIndex += this.ratio;
    }

    const consumed = Math.floor(this.readIndex);
    if (consumed > 0) {
      this.buffer = this.buffer.slice(consumed);
      this.readIndex -= consumed;
    }

    if (samples.length > 0) {
      const pcm = new Int16Array(samples);
      this.port.postMessage({ type: 'audio', buffer: pcm.buffer }, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor('deepgram-pcm-processor', DeepgramPCMProcessor);
