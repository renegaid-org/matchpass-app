import { ScanResult } from '../components/ScanResult';
import type { ScanResult as ScanResultType } from '../types';

interface Props {
  result: ScanResultType;
  onDone: () => void;
}

export function Result({ result, onDone }: Props) {
  return <ScanResult result={result} onDone={onDone} />;
}
