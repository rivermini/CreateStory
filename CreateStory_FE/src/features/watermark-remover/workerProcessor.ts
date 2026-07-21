import type { WatermarkMeta } from '@pilio/gemini-watermark-remover/image-data';

const WORKER_TIMEOUT_MS = 120_000;

interface WorkerEnvironment {
  createImageBitmap?: unknown;
  OffscreenCanvas?: unknown;
  Worker?: unknown;
}

interface PendingRequest {
  reject: (reason: Error) => void;
  resolve: (result: WorkerResponse) => void;
  timeoutId: ReturnType<typeof globalThis.setTimeout>;
}

interface WorkerResponse {
  error?: string;
  id: number;
  meta?: WatermarkMeta;
  ok: boolean;
  processedBuffer?: ArrayBuffer;
  type: 'ping' | 'process-image';
}

export interface WorkerWatermarkResult {
  processedBlob: Blob | null;
  processedMeta: WatermarkMeta | null;
}

export function canUseWatermarkWorker(
  environment: WorkerEnvironment = globalThis,
): boolean {
  return typeof environment.Worker === 'function'
    && typeof environment.OffscreenCanvas === 'function'
    && typeof environment.createImageBitmap === 'function';
}

class WatermarkWorkerProcessor {
  private readonly pending = new Map<number, PendingRequest>();

  private readonly worker: Worker;

  private requestId = 0;

  constructor() {
    this.worker = new Worker(
      new URL('./watermarkProcessor.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse>): void => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    globalThis.clearTimeout(pending.timeoutId);
    if (response.ok) pending.resolve(response);
    else pending.reject(new Error(response.error ?? 'Watermark worker failed.'));
  };

  private readonly handleError = (event: ErrorEvent): void => {
    const error = new Error(event.message || 'Watermark worker crashed.');
    for (const pending of this.pending.values()) {
      globalThis.clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pending.clear();
  };

  private request(
    payload: { inputBuffer?: ArrayBuffer; mimeType?: string; type: 'ping' | 'process-image' },
    transfer: Transferable[] = [],
  ): Promise<WorkerResponse> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Watermark processing timed out.'));
      }, WORKER_TIMEOUT_MS);
      this.pending.set(id, { reject, resolve, timeoutId });
      this.worker.postMessage({ id, ...payload }, transfer);
    });
  }

  async process(blob: Blob): Promise<WorkerWatermarkResult> {
    const inputBuffer = await blob.arrayBuffer();
    const response = await this.request({
      inputBuffer,
      mimeType: blob.type || 'image/png',
      type: 'process-image',
    }, [inputBuffer]);

    return {
      processedBlob: response.processedBuffer
        ? new Blob([response.processedBuffer], { type: 'image/png' })
        : null,
      processedMeta: response.meta ?? null,
    };
  }
}

let sharedWorkerProcessor: WatermarkWorkerProcessor | null = null;

export async function processWatermarkBlobInWorker(
  blob: Blob,
): Promise<WorkerWatermarkResult> {
  sharedWorkerProcessor ??= new WatermarkWorkerProcessor();
  return sharedWorkerProcessor.process(blob);
}
