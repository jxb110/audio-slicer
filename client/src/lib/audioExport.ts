/**
 * 音频导出工具 - 从 AudioBuffer 中提取片段并导出为 WAV
 * 关键：保持与源文件相同的采样率和位深度
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
 * 从 WAV/PCM 文件头读取采样率和位深度
 * 如果不是 WAV 格式则返回 null（由 decodeAudioFile 的 sampleRate 兜底）
 */
export function readWavHeader(arrayBuffer: ArrayBuffer): {
  sampleRate: number;
  bitDepth: number;
  numChannels: number;
} | null {
  try {
    const view = new DataView(arrayBuffer);
    // RIFF header: "RIFF" at 0, "WAVE" at 8
    const riff = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
    );
    const wave = String.fromCharCode(
      view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)
    );
    if (riff !== 'RIFF' || wave !== 'WAVE') return null;

    // Search for "fmt " chunk (may not be at offset 12 if there are extra chunks)
    let offset = 12;
    while (offset < arrayBuffer.byteLength - 8) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === 'fmt ') {
        const numChannels = view.getUint16(offset + 10, true);
        const sampleRate = view.getUint32(offset + 12, true);
        const bitDepth = view.getUint16(offset + 22, true);
        return { sampleRate, bitDepth, numChannels };
      }
      offset += 8 + chunkSize;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 将 AudioBuffer 转换为 WAV Blob，支持指定位深度（8/16/24/32）
 * targetSampleRate: 如果与 buffer.sampleRate 不同，需要调用方先重采样
 */
export function audioBufferToWav(
  buffer: AudioBuffer,
  bitDepth: 8 | 16 | 24 | 32 = 16
): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = bitDepth === 32 ? 3 : 1; // 3=IEEE float, 1=PCM
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

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

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      if (bitDepth === 8) {
        // 8-bit unsigned PCM: 0-255, center at 128
        view.setUint8(offset, Math.round((sample + 1) * 127.5));
        offset += 1;
      } else if (bitDepth === 16) {
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      } else if (bitDepth === 24) {
        const val = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, val & 0xff);
        view.setUint8(offset + 1, (val >> 8) & 0xff);
        view.setUint8(offset + 2, (val >> 16) & 0xff);
        offset += 3;
      } else {
        // 32-bit float
        view.setFloat32(offset, sample, true);
        offset += 4;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * 从 AudioBuffer 中提取指定时间范围的片段
 * 保持原始采样率，不做任何重采样
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

  // 直接用 OfflineAudioContext 创建 buffer，采样率与源文件一致
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
 * 解码音频文件为 AudioBuffer，保持源文件采样率
 *
 * 关键：
 * 1. 先读取原始文件头，获取真实采样率和位深度
 * 2. 用 AudioContext({ sampleRate: 原始采样率 }) 解码，避免浏览器自动重采样到 44100/48000
 * 3. 如果 AudioContext 不支持指定采样率，则解码后用 OfflineAudioContext 重采样回目标采样率
 */
export async function decodeAudioFile(
  file: File
): Promise<{ buffer: AudioBuffer; sampleRate: number; bitDepth: number; numChannels: number }> {
  const arrayBuffer = await file.arrayBuffer();

  // 读取源文件参数
  const wavInfo = readWavHeader(arrayBuffer);
  const targetSampleRate = wavInfo?.sampleRate ?? null;
  const sourceBitDepth = wavInfo?.bitDepth ?? 16;
  const sourceChannels = wavInfo?.numChannels ?? 1;

  // 用指定采样率的 AudioContext 解码，防止浏览器自动重采样
  let audioContext: AudioContext;
  if (targetSampleRate) {
    try {
      audioContext = new AudioContext({ sampleRate: targetSampleRate });
    } catch {
      audioContext = new AudioContext();
    }
  } else {
    audioContext = new AudioContext();
  }

  let decoded: AudioBuffer;
  try {
    decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioContext.close();
  }

  // 如果解码后采样率与目标不一致（浏览器忽略了指定的 sampleRate），用 OfflineAudioContext 重采样
  const finalSampleRate = targetSampleRate ?? decoded.sampleRate;
  let finalBuffer = decoded;

  if (decoded.sampleRate !== finalSampleRate) {
    const offlineCtx = new OfflineAudioContext(
      decoded.numberOfChannels,
      Math.ceil(decoded.duration * finalSampleRate),
      finalSampleRate
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineCtx.destination);
    source.start(0);
    finalBuffer = await offlineCtx.startRendering();
  }

  return {
    buffer: finalBuffer,
    sampleRate: finalSampleRate,
    bitDepth: sourceBitDepth,
    numChannels: sourceChannels,
  };
}

/**
 * 下载单个片段，保持源文件参数
 */
export async function downloadSegment(
  audioBuffer: AudioBuffer,
  segment: AudioSegment,
  fileName: string,
  bitDepth: 8 | 16 | 24 | 32 = 16
): Promise<void> {
  const segBuffer = extractSegment(audioBuffer, segment.startTime, segment.endTime);
  const wavBlob = audioBufferToWav(segBuffer, bitDepth);
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
 * 批量下载所有片段为 ZIP，保持源文件参数
 */
export async function downloadSegmentsAsZip(
  audioBuffer: AudioBuffer,
  segments: AudioSegment[],
  zipFileName: string = 'audio_segments.zip',
  bitDepth: 8 | 16 | 24 | 32 = 16
): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segBuffer = extractSegment(audioBuffer, segment.startTime, segment.endTime);
    const wavBlob = audioBufferToWav(segBuffer, bitDepth);
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
