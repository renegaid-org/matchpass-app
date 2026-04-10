export class NFCScanner {
  constructor(onScan) {
    this.onScan = onScan;
    this.reader = null;
    this.scanning = false;
    this.abortController = null;
  }

  static isSupported() {
    return 'NDEFReader' in window;
  }

  async start() {
    if (!NFCScanner.isSupported()) throw new Error('Web NFC not supported on this device');
    this.reader = new NDEFReader();
    this.abortController = new AbortController();
    this.scanning = true;

    this.reader.addEventListener('reading', ({ message }) => {
      if (!this.scanning) return;
      for (const record of message.records) {
        if (record.recordType === 'text') {
          const decoder = new TextDecoder(record.encoding || 'utf-8');
          this.onScan(decoder.decode(record.data));
          return;
        }
      }
    });

    await this.reader.scan({ signal: this.abortController.signal });
  }

  stop() {
    this.scanning = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

export class QRScanner {
  constructor(videoElement, onScan) {
    this.video = videoElement;
    this.onScan = onScan;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.scanning = false;
    this.stream = null;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.scanning = true;
      this._scanLoop();
    } catch (err) {
      console.error('Camera access failed:', err);
      throw err;
    }
  }

  stop() {
    this.scanning = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  _scanLoop() {
    if (!this.scanning) return;
    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.ctx.drawImage(this.video, 0, 0);
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
          this.onScan(code.data);
          this.scanning = false;
          setTimeout(() => { this.scanning = true; this._scanLoop(); }, 1500);
          return;
        }
      }
    }
    requestAnimationFrame(() => this._scanLoop());
  }
}
