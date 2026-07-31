/**
 * 音频导出工具 - 保持源文件采样率和位深度
 *
 * 核心策略：
 * - 导出时直接操作原始 ArrayBuffer（WAV PCM 数据），完全绕过 AudioContext 重采样
 * - AudioContext 仅用于 VAD 检测（需要 Float32 PCM），不用于导出
 * - 从 WAV 文件头读取真实的采样率、位深度、声道数
 */

export interface AudioSegment {
  id: string;
  startTime: number;
  endTime: number;
  label?: string;
  source?: 'manual' | 'vad';
  isConfirmed?: boolean;
  color?: string;
}

/** WAV 文件元信息 */
export interface WavInfo {
  sampleRate: number;
  bitDepth: number;
  numChannels: number;
  dataOffset: number;
  dataSize: number;
  byteRate: number;
  blockAlign: number;
}

/**
 * 解析 WAV 文件头，返回元信息
 */
export function parseWavHeader(arrayBuffer: ArrayBuffer): WavInfo | null {
  try {
    const view = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength < 44) return null;

    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (riff !== 'RIFF' || wave !== 'WAVE') return null;

    let offset = 12;
    let fmtFound = false;
    let numChannels = 1, sampleRate = 16000, byteRate = 0, blockAlign = 2, bitDepth = 16;
    let dataOffset = 0, dataSize = 0;

    while (offset + 8 <= arrayBuffer.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'fmt ') {
        numChannels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        byteRate = view.getUint32(offset + 16, true);
        blockAlign = view.getUint16(offset + 20, true);
        bitDepth = view.getUint16(offset + 22, true);
        fmtFound = true;
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) offset += 1;
    }

    if (!fmtFound || dataOffset === 0) return null;
    return { sampleRate, bitDepth, numChannels, dataOffset, dataSize, byteRate, blockAlign };
  } catch {
    return null;
  }
}

/**
 * 从原始 WAV ArrayBuffer 中直接切出指定时间范围的 PCM 数据
 * 完全不经过 AudioContext，保持原始采样率和位深度
 */
export function sliceWavRaw(
  arrayBuffer: ArrayBuffer,
  info: WavInfo,
  startTime: number,
  endTime: number
): ArrayBuffer {
  const { sampleRate, bitDepth, numChannels, dataOffset, dataSize, byteRate, blockAlign } = info;

  const totalSamples = Math.floor(dataSize / blockAlign);
  const startSample = Math.max(0, Math.min(totalSamples, Math.floor(startTime * sampleRate)));
  const endSample = Math.max(0, Math.min(totalSamples, Math.ceil(endTime * sampleRate)));
  const numSamples = Math.max(0, endSample - startSample);

  const sliceByteStart = dataOffset + startSample * blockAlign;
  const sliceByteLen = numSamples * blockAlign;

  const newDataSize = sliceByteLen;
  const newFileSize = 44 + newDataSize;
  const out = new ArrayBuffer(newFileSize);
  const outView = new DataView(out);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) outView.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  outView.setUint32(4, newFileSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  outView.setUint32(16, 16, true);
  outView.setUint16(20, 1, true);
  outView.setUint16(22, numChannels, true);
  outView.setUint32(24, sampleRate, true);
  outView.setUint32(28, byteRate, true);
  outView.setUint16(32, blockAlign, true);
  outView.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  outView.setUint32(40, newDataSize, true);

  const available = Math.min(sliceByteLen, arrayBuffer.byteLength - sliceByteStart);
  if (available > 0) {
    const srcBytes = new Uint8Array(arrayBuffer, sliceByteStart, available);
    const dstBytes = new Uint8Array(out, 44);
    dstBytes.set(srcBytes);
  }

  return out;
}

/**
 * 解码音频文件为 AudioBuffer（仅用于 VAD 检测）
 * 注意：AudioContext 会将采样率转为系统默认值（48000Hz），这是正常的，
 * VAD 只需要波形能量，不需要精确采样率。
 */
export async function decodeAudioForVAD(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioCtx.close();
  }
}

/**
 * 下载单个片段（直接从原始 ArrayBuffer 切片，保持源文件参数）
 */
export async function downloadSegment(
  rawArrayBuffer: ArrayBuffer,
  wavInfo: WavInfo,
  segment: AudioSegment,
  fileName: string
): Promise<void> {
  const sliced = sliceWavRaw(rawArrayBuffer, wavInfo, segment.startTime, segment.endTime);
  const blob = new Blob([sliced], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 批量下载所有片段为 ZIP（直接从原始 ArrayBuffer 切片，保持源文件参数）
 */
export async function downloadSegmentsAsZip(
  rawArrayBuffer: ArrayBuffer,
  wavInfo: WavInfo | null,
  segments: AudioSegment[],
  zipFileName: string = 'audio_segments.zip',
  audioBuffer?: AudioBuffer,
  sourceBaseName: string = 'audio'
): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    let fileData: ArrayBuffer;

    if (wavInfo) {
      fileData = sliceWavRaw(rawArrayBuffer, wavInfo, segment.startTime, segment.endTime);
    } else if (audioBuffer) {
      fileData = _audioBufferToWavFallback(audioBuffer, segment.startTime, segment.endTime);
    } else {
      continue;
    }

    const fileName = segment.label
      ? `${sourceBaseName}_${segment.label}_${String(i + 1).padStart(3, '0')}.wav`
      : `${sourceBaseName}__${String(i + 1).padStart(3, '0')}.wav`;
    zip.file(fileName, fileData);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = zipFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 兜底导出（供 SegmentList 使用，非WAV格式如MP3/OGG）
 */
export async function audioBufferToWavFallbackExport(
  buffer: AudioBuffer,
  segment: AudioSegment,
  fileName: string
): Promise<void> {
  const data = _audioBufferToWavFallback(buffer, segment.startTime, segment.endTime);
  const blob = new Blob([data], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 内部辅助：用 AudioBuffer 生成 WAV（兜底路径，非WAV格式如MP3/OGG）
 */
function _audioBufferToWavFallback(
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): ArrayBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.min(Math.ceil(endTime * sampleRate), buffer.length);
  const numSamples = Math.max(0, endSample - startSample);
  const bitDepth = 16;
  const blockAlign = numChannels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true); writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[startSample + i] || 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

/**
 * 导出片段元数据为 CSV
 */
export function exportSegmentsAsCSV(
  segments: AudioSegment[],
  fileName: string = 'segments.csv'
): void {
  const headers = ['序号', '开始时间(秒)', '结束时间(秒)', '时长(秒)', '标签', '来源'];
  const rows = segments.map((seg, idx) => [
    idx + 1,
    seg.startTime.toFixed(3),
    seg.endTime.toFixed(3),
    (seg.endTime - seg.startTime).toFixed(3),
    seg.label || '',
    seg.source || 'manual',
  ]);
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
