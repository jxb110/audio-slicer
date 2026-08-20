import { describe, expect, it } from "vitest";
import { parseWavHeader, sliceWavRaw } from "./audioExport";

function createMonoPcmWav(sampleRate: number, bitDepth: number, samples: number[]): ArrayBuffer {
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };

  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * bytesPerSample, sample, true));
  return buffer;
}

describe("WAV 原始PCM切片", () => {
  it("保留16000Hz、16bit、单声道源文件参数", () => {
    const source = createMonoPcmWav(16000, 16, Array.from({ length: 16000 }, (_, index) => index % 2 === 0 ? 1200 : -1200));
    const info = parseWavHeader(source);
    expect(info).toMatchObject({ sampleRate: 16000, bitDepth: 16, numChannels: 1 });

    const sliced = sliceWavRaw(source, info!, 0.25, 0.75);
    const slicedInfo = parseWavHeader(sliced);
    expect(slicedInfo).toMatchObject({ sampleRate: 16000, bitDepth: 16, numChannels: 1 });
    expect(slicedInfo?.dataSize).toBe(16000);
  });
});
