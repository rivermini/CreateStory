import {
  createWatermarkEngine,
  removeWatermarkFromImageData,
  type WatermarkMeta,
} from '@pilio/gemini-watermark-remover/image-data';

interface PingRequest {
  id: number;
  type: 'ping';
}

interface ProcessRequest {
  id: number;
  inputBuffer: ArrayBuffer;
  mimeType: string;
  type: 'process-image';
}

type WorkerRequest = PingRequest | ProcessRequest;

interface WorkerSuccessResponse {
  id: number;
  meta?: WatermarkMeta;
  ok: true;
  processedBuffer?: ArrayBuffer;
  type: 'ping' | 'process-image';
}

interface WorkerFailureResponse {
  error: string;
  id: number;
  ok: false;
  type: 'ping' | 'process-image';
}

type WorkerResponse = WorkerSuccessResponse | WorkerFailureResponse;

interface WorkerScope {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
}

const scope = globalThis as unknown as WorkerScope;
const enginePromise = createWatermarkEngine();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Watermark worker failed.';
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'ping') {
    scope.postMessage({ id: request.id, ok: true, type: 'ping' });
    return;
  }

  void (async () => {
    try {
      const sourceBlob = new Blob([request.inputBuffer], { type: request.mimeType });
      const bitmap = await createImageBitmap(sourceBlob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('The worker could not create an image canvas.');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const engine = await enginePromise;
      const result = await removeWatermarkFromImageData(imageData, {
        adaptiveMode: 'auto',
        engine,
      });
      imageData.data.set(result.imageData.data);
      context.putImageData(imageData, 0, 0);
      const processedBlob = await canvas.convertToBlob({ type: 'image/png' });
      const processedBuffer = await processedBlob.arrayBuffer();
      scope.postMessage({
        id: request.id,
        meta: result.meta,
        ok: true,
        processedBuffer,
        type: 'process-image',
      }, [processedBuffer]);
    } catch (error) {
      scope.postMessage({
        error: errorMessage(error),
        id: request.id,
        ok: false,
        type: 'process-image',
      });
    }
  })();
});
