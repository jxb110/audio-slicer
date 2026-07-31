/**
 * 音频导出工具 - 从 AudioBuffer 中提取片段并导出为 WAV
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

/**
 * 将 AudioBuffer 转换为 WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM data (interleaved)
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * 从 AudioBuffer 中提取指定时间范围的片段
 */
export function extractSegment(
  audioBuffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.min(Math.ceil(endTime * sampleRate), audioBuffer.length);
  const length = Math.max(0, endSample - startSample);

  const offlineCtx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    Math.max(1, length),
    sampleRate
  );

  const newBuffer = offlineCtx.createBuffer(
    audioBuffer.numberOfChannels,
    Math.max(1, length),
    sampleRate
  );

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    const newChannelData = newBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      newChannelData[i] = channelData[startSample + i] || 0;
    }
  }

  return newBuffer;
}

/**
 * 解码音频文件为 AudioBuffer
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    return await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    await audioContext.close();
  }
}

/**
 * 下载单个片段
 */
export async function downloadSegment(
  audioBuffer: AudioBuffer,
  segment: AudioSegment,
  fileName: string
): Promise<void> {
  const segBuffer = extractSegment(audioBuffer, segment.startTime, segment.endTime);
  const wavBlob = audioBufferToWav(segBuffer);
  const url = URL.createObjectURL(wavBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 批量下载所有片段为 ZIP
 */
export async function downloadSegmentsAsZip(
  audioBuffer: AudioBuffer,
  segments: AudioSegment[],
  zipFileName: string = 'audio_segments.zip'
): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segBuffer = extractSegment(audioBuffer, segment.startTime, segment.endTime);
    const wavBlob = audioBufferToWav(segBuffer);
    const arrayBuffer = await wavBlob.arrayBuffer();
    const fileName = segment.label
      ? `${String(i + 1).padStart(3, '0')}_${segment.label}.wav`
      : `${String(i + 1).padStart(3, '0')}_segment.wav`;
    zip.file(fileName, arrayBuffer);
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
