import { File } from "node:buffer";
import { describe, expect, it } from "vitest";
import { analyzeAudioForUpload } from "./longAudio";

function createWav(sampleRate: number, samples: number[]): ArrayBuffer {
  const dataSize = samples.length * 2;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF"); view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, dataSize, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return output;
}

describe("长音频波形预处理", () => {
  it("从WAV分块读取采样率、时长和有效峰值", async () => {
    const source = createWav(16000, Array.from({ length: 16000 }, (_, index) => index % 50 < 25 ? 10000 : -10000));
    const file = new File([source], "wake word.wav", { type: "audio/wav" });
    const result = await analyzeAudioForUpload(file as unknown as File);

    expect(result.durationMs).toBe(1000);
    expect(result.sampleRate).toBe(16000);
    expect(result.bitDepth).toBe(16);
    expect(result.waveformPeaks?.length).toBeGreaterThanOrEqual(512);
    expect(Math.max(...(result.waveformPeaks || []))).toBeGreaterThan(0.2);
  });

  it("为30分钟16000Hz WAV生成受限大小的概览峰值", async () => {
    const sampleRate = 16000;
    const durationSeconds = 30 * 60;
    const dataSize = sampleRate * durationSeconds * 2;
    const header = createWav(sampleRate, []);
    new DataView(header).setUint32(4, 36 + dataSize, true);
    new DataView(header).setUint32(40, dataSize, true);
    const file = new File([header, new Uint8Array(dataSize)], "long wakeword.wav", { type: "audio/wav" });

    const result = await analyzeAudioForUpload(file as unknown as File);
    expect(result.durationMs).toBe(durationSeconds * 1000);
    expect(result.waveformPeaks).toHaveLength(12000);
    expect(result.waveformBucketCount).toBe(12000);
  });
});
