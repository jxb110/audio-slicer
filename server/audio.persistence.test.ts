import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { userSlicerSettings } from "../drizzle/schema";
import {
  createAudioFile,
  deleteAudioFileForUser,
  getDb,
  getSettingsForUser,
  listAudioFilesForUser,
  listSegmentsForUser,
  replaceSegmentsForUser,
  saveSettingsForUser,
} from "./db";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;

describe("音频持久化数据库流程", () => {
  const userId = 999_999_999;
  const audioFileId = `test-${randomUUID()}`;

  afterAll(async () => {
    await deleteAudioFileForUser(userId, audioFileId).catch(() => undefined);
    const database = await getDb();
    await database?.delete(userSlicerSettings).where(eq(userSlicerSettings.userId, userId));
  });

  runIntegration("保存、读取、更新片段与删除音频记录", async () => {
    const created = await createAudioFile({
      id: audioFileId,
      userId,
      originalName: "wake word test.wav",
      storageKey: `audio-slicer/test/${audioFileId}.wav`,
      storageUrl: `/manus-storage/audio-slicer/test/${audioFileId}.wav`,
      mimeType: "audio/wav",
      sizeBytes: 32000,
      durationMs: 1000,
      sampleRate: 16000,
      bitDepth: 16,
      numChannels: 1,
      waveformPeaks: [0.1, 0.7, 0.2],
      waveformBucketCount: 3,
    });
    expect(created?.originalName).toBe("wake word test.wav");

    const files = await listAudioFilesForUser(userId);
    expect(files.some(file => file.id === audioFileId && file.sampleRate === 16000)).toBe(true);

    await replaceSegmentsForUser(userId, audioFileId, [{
      id: `segment-${randomUUID()}`,
      startMs: 100,
      endMs: 700,
      label: "wake",
      source: "manual",
      isConfirmed: true,
      color: "#3b82f6",
      sortOrder: 0,
    }]);
    const segments = await listSegmentsForUser(userId, audioFileId);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startMs: 100, endMs: 700, label: "wake" });

    await saveSettingsForUser(userId, {
      silencePrefixMs: 150,
      silenceSuffixMs: 180,
      vadEnergyThreshold: "0.02",
      vadMaxSilenceDurationMs: 450,
      vadMinSpeechDurationMs: 120,
      allowSegmentOverlap: false,
    });
    await expect(getSettingsForUser(userId)).resolves.toMatchObject({
      silencePrefixMs: 150,
      silenceSuffixMs: 180,
      vadEnergyThreshold: "0.02",
      allowSegmentOverlap: false,
    });

    await expect(deleteAudioFileForUser(userId, audioFileId)).resolves.toBe(true);
    await expect(listSegmentsForUser(userId, audioFileId)).resolves.toHaveLength(0);
  }, 30_000);
});
