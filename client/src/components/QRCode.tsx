import { useEffect, useRef } from 'react';
import QRCodeLib from 'qrcode';

interface Props {
  value: string;
  size?: number;
}

export function QRCode({ value, size = 256 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCodeLib.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).catch(err => console.warn('QR render failed', err));
  }, [value, size]);
  return <canvas ref={canvasRef} width={size} height={size} />;
}
