/** 前端使用的已持久化音频记录。文件二进制内容始终保存在对象存储。 */
export interface AudioFileRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  storageUrl: string;
  durationMs: number;
  sampleRate: number | null;
  bitDepth: number | null;
  numChannels: number | null;
  waveformPeaks: number[] | null;
  waveformBucketCount: number;
}

/** 与切音设置界面匹配的客户端单位：时长为毫秒，VAD间隔为秒。 */
export interface AppSettings {
  silencePrefixMs: number;
  silenceSuffixMs: number;
  vadEnergyThreshold: number;
  vadMaxSilenceDuration: number;
  vadMinSpeechDuration: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  silencePrefixMs: 200,
  silenceSuffixMs: 200,
  vadEnergyThreshold: 0.01,
  vadMaxSilenceDuration: 0.5,
  vadMinSpeechDuration: 0.1,
};
