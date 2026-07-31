/**
 * VAD (Voice Activity Detection) - 基于能量阈值的语音活动检测
 * 纯前端实现，使用 Web Audio API 分析音频能量
 */

export interface VADOptions {
  /** 能量阈值 (0-1)，越小越灵敏，默认 0.01 */
  energyThreshold?: number;
  /** 最小语音段长度（秒），默认 0.1 */
  minSpeechDuration?: number;
  /** 最大静音间隔（秒），超过则分割，默认 0.5 */
  maxSilenceDuration?: number;
  /** 帧长度（秒），默认 0.02 */
  frameDuration?: number;
  /** 前置静音（秒），默认 0 */
  silencePrefix?: number;
  /** 后置静音（秒），默认 0 */
  silenceSuffix?: number;
}

export interface VADSegment {
  startTime: number;
  endTime: number;
  /** 原始检测时间（不含首尾静音） */
  rawStart: number;
  rawEnd: number;
}

/**
 * 对 AudioBuffer 进行 VAD 检测
 */
export async function detectVoiceSegments(
  audioBuffer: AudioBuffer,
  options: VADOptions = {}
): Promise<VADSegment[]> {
  const {
    energyThreshold = 0.01,
    minSpeechDuration = 0.1,
    maxSilenceDuration = 0.5,
    frameDuration = 0.02,
    silencePrefix = 0,
    silenceSuffix = 0,
  } = options;

  const sampleRate = audioBuffer.sampleRate;
  const frameSize = Math.floor(frameDuration * sampleRate);
  const duration = audioBuffer.duration;

  // 混合所有声道
  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;
  const mixed = new Float32Array(totalSamples);

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < totalSamples; i++) {
      mixed[i] += channelData[i] / numChannels;
    }
  }

  // 计算每帧 RMS 能量
  const numFrames = Math.floor(totalSamples / frameSize);
  const energies: number[] = [];

  for (let f = 0; f < numFrames; f++) {
    let sumSq = 0;
    const start = f * frameSize;
    for (let i = start; i < start + frameSize; i++) {
      sumSq += mixed[i] * mixed[i];
    }
    energies.push(Math.sqrt(sumSq / frameSize));
  }

  // 标记每帧是否为语音
  const isSpeech = energies.map((e) => e > energyThreshold);

  // 合并连续语音段
  const rawSegments: { start: number; end: number }[] = [];
  let inSpeech = false;
  let speechStart = 0;
  let silenceCount = 0;
  const maxSilenceFrames = Math.ceil(maxSilenceDuration / frameDuration);

  for (let f = 0; f < numFrames; f++) {
    if (isSpeech[f]) {
      if (!inSpeech) {
        speechStart = f;
        inSpeech = true;
      }
      silenceCount = 0;
    } else {
      if (inSpeech) {
        silenceCount++;
        if (silenceCount > maxSilenceFrames) {
          // 结束当前语音段
          const segEnd = (f - silenceCount) * frameDuration;
          const segStart = speechStart * frameDuration;
          if (segEnd - segStart >= minSpeechDuration) {
            rawSegments.push({ start: segStart, end: segEnd });
          }
          inSpeech = false;
          silenceCount = 0;
        }
      }
    }
  }

  // 处理最后一段
  if (inSpeech) {
    const segEnd = (numFrames - silenceCount) * frameDuration;
    const segStart = speechStart * frameDuration;
    if (segEnd - segStart >= minSpeechDuration) {
      rawSegments.push({ start: segStart, end: segEnd });
    }
  }

  // 加上首尾静音，并限制在音频范围内
  return rawSegments.map((seg) => ({
    rawStart: seg.start,
    rawEnd: seg.end,
    startTime: Math.max(0, seg.start - silencePrefix),
    endTime: Math.min(duration, seg.end + silenceSuffix),
  }));
}

/**
 * 从 File 对象检测语音段
 */
export async function detectVoiceSegmentsFromFile(
  file: File,
  options: VADOptions = {}
): Promise<VADSegment[]> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return detectVoiceSegments(audioBuffer, options);
  } finally {
    await audioContext.close();
  }
}
