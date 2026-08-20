import { parseWavHeader, type WavInfo } from "./audioExport";

export interface UploadAudioAnalysis {
  durationMs: number;
  sampleRate: number | null;
  bitDepth: number | null;
  numChannels: number | null;
  waveformPeaks: number[] | null;
  waveformBucketCount: number;
  wavInfo: WavInfo | null;
}

function readPcmAmplitude(view: DataView, offset: number, bitDepth: number): number {
  if (bitDepth === 8) return Math.abs((view.getUint8(offset) - 128) / 128);
  if (bitDepth === 16) return Math.abs(view.getInt16(offset, true) / 32768);
  if (bitDepth === 24) {
    const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    const signed = value & 0x800000 ? value | 0xff000000 : value;
    return Math.abs(signed / 8388608);
  }
  if (bitDepth === 32) return Math.abs(view.getInt32(offset, true) / 2147483648);
  return 0;
}

/**
 * 在固定大小分块中扫描WAV的PCM数据，峰值数组最多12,000项。
 * 这避免将数十分钟音频完整读入AudioContext或单个ArrayBuffer。
 */
async function buildWavPeaks(file: File, info: WavInfo, maxBuckets = 12000): Promise<number[]> {
  const bytesPerSample = info.bitDepth / 8;
  if (![1, 2, 3, 4].includes(bytesPerSample) || info.blockAlign <= 0 || info.byteRate <= 0) return [];

  const totalFrames = Math.floor(info.dataSize / info.blockAlign);
  const durationSeconds = info.dataSize / info.byteRate;
  const bucketCount = Math.max(512, Math.min(maxBuckets, Math.ceil(durationSeconds * 20)));
  const peaks = new Array<number>(bucketCount).fill(0);
  const framesPerBucket = Math.max(1, Math.ceil(totalFrames / bucketCount));
  const frameStride = Math.max(1, Math.floor(framesPerBucket / 96));
  const chunkSize = Math.max(info.blockAlign, Math.floor((2 * 1024 * 1024) / info.blockAlign) * info.blockAlign);
  const dataEnd = Math.min(file.size, info.dataOffset + info.dataSize);

  for (let chunkStart = info.dataOffset; chunkStart < dataEnd; chunkStart += chunkSize) {
    const chunkEnd = Math.min(dataEnd, chunkStart + chunkSize);
    const chunk = await file.slice(chunkStart, chunkEnd).arrayBuffer();
    const view = new DataView(chunk);
    const firstFrame = Math.floor((chunkStart - info.dataOffset) / info.blockAlign);
    const frameCount = Math.floor(chunk.byteLength / info.blockAlign);

    for (let localFrame = 0; localFrame < frameCount; localFrame += frameStride) {
      const frame = firstFrame + localFrame;
      const bucket = Math.min(bucketCount - 1, Math.floor(frame / framesPerBucket));
      const baseOffset = localFrame * info.blockAlign;
      let amplitude = 0;
      for (let channel = 0; channel < info.numChannels; channel++) {
        amplitude = Math.max(amplitude, readPcmAmplitude(view, baseOffset + channel * bytesPerSample, info.bitDepth));
      }
      if (amplitude > peaks[bucket]) peaks[bucket] = Math.min(1, amplitude);
    }
  }

  return peaks;
}

/** 为上传流程提取轻量元数据与波形峰值；非WAV保留时长的浏览器回退路径。 */
export async function analyzeAudioForUpload(file: File): Promise<UploadAudioAnalysis> {
  const head = await file.slice(0, Math.min(file.size, 128 * 1024)).arrayBuffer();
  const wavInfo = parseWavHeader(head);
  if (!wavInfo) {
    return { durationMs: 0, sampleRate: null, bitDepth: null, numChannels: null, waveformPeaks: null, waveformBucketCount: 0, wavInfo: null };
  }

  const durationMs = Math.max(1, Math.round((wavInfo.dataSize / wavInfo.byteRate) * 1000));
  const waveformPeaks = await buildWavPeaks(file, wavInfo);
  return {
    durationMs,
    sampleRate: wavInfo.sampleRate,
    bitDepth: wavInfo.bitDepth,
    numChannels: wavInfo.numChannels,
    waveformPeaks,
    waveformBucketCount: waveformPeaks.length,
    wavInfo,
  };
}
