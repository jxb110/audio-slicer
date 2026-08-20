import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { createAudioUploadIntent } from "./audioStorage";
import * as db from "./db";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const idSchema = z.string().min(6).max(64);
const segmentSchema = z.object({
  id: idSchema,
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  label: z.string().max(512).nullable().optional(),
  source: z.enum(["manual", "vad"]),
  isConfirmed: z.boolean(),
  color: z.string().max(32).nullable().optional(),
  sortOrder: z.number().int().min(0),
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  audio: router({
    list: protectedProcedure.query(({ ctx }) => db.listAudioFilesForUser(ctx.user.id)),
    get: protectedProcedure.input(z.object({ audioFileId: idSchema })).query(async ({ ctx, input }) => {
      const file = await db.getAudioFileForUser(ctx.user.id, input.audioFileId);
      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "音频不存在或无权访问" });
      return file;
    }),
    createUploadIntent: protectedProcedure
      .input(z.object({ audioId: idSchema, originalName: z.string().min(1).max(512), mimeType: z.string().max(255) }))
      .mutation(({ ctx, input }) => createAudioUploadIntent({ userId: ctx.user.id, audioId: input.audioId, fileName: input.originalName })),
    completeUpload: protectedProcedure
      .input(z.object({
        id: idSchema,
        originalName: z.string().min(1).max(512),
        storageKey: z.string().min(1).max(1024),
        storageUrl: z.string().min(1).max(2048),
        mimeType: z.string().min(1).max(255),
        sizeBytes: z.number().int().nonnegative(),
        durationMs: z.number().int().positive(),
        sampleRate: z.number().int().positive().nullable().optional(),
        bitDepth: z.number().int().positive().nullable().optional(),
        numChannels: z.number().int().positive().nullable().optional(),
        waveformPeaks: z.array(z.number().min(0).max(1)).max(24000).nullable().optional(),
        waveformBucketCount: z.number().int().nonnegative(),
      }))
      .mutation(async ({ ctx, input }) => {
        const allowedPrefix = `audio-slicer/users/${ctx.user.id}/${input.id}/`;
        if (!input.storageKey.startsWith(allowedPrefix) || input.storageUrl !== `/manus-storage/${input.storageKey}`) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无效的音频存储路径" });
        }
        return db.createAudioFile({ ...input, userId: ctx.user.id });
      }),
    delete: protectedProcedure.input(z.object({ audioFileId: idSchema })).mutation(async ({ ctx, input }) => {
      const deleted = await db.deleteAudioFileForUser(ctx.user.id, input.audioFileId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "音频不存在或无权删除" });
      return { success: true };
    }),
  }),
  segments: router({
    list: protectedProcedure.input(z.object({ audioFileId: idSchema })).query(async ({ ctx, input }) => {
      const audioFile = await db.getAudioFileForUser(ctx.user.id, input.audioFileId);
      if (!audioFile) throw new TRPCError({ code: "NOT_FOUND", message: "音频不存在或无权访问" });
      return db.listSegmentsForUser(ctx.user.id, input.audioFileId);
    }),
    replaceAll: protectedProcedure
      .input(z.object({ audioFileId: idSchema, segments: z.array(segmentSchema).max(100000) }))
      .mutation(async ({ ctx, input }) => {
        const audioFile = await db.getAudioFileForUser(ctx.user.id, input.audioFileId);
        if (!audioFile) throw new TRPCError({ code: "NOT_FOUND", message: "音频不存在或无权编辑" });
        if (input.segments.some(segment => segment.endMs <= segment.startMs || segment.endMs > audioFile.durationMs)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "片段时间范围无效" });
        }
        return db.replaceSegmentsForUser(ctx.user.id, input.audioFileId, input.segments);
      }),
  }),
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const settings = await db.getSettingsForUser(ctx.user.id);
      return settings ?? {
        silencePrefixMs: 200,
        silenceSuffixMs: 200,
        vadEnergyThreshold: "0.01",
        vadMaxSilenceDurationMs: 500,
        vadMinSpeechDurationMs: 100,
      };
    }),
    save: protectedProcedure
      .input(z.object({
        silencePrefixMs: z.number().int().min(0).max(10000),
        silenceSuffixMs: z.number().int().min(0).max(10000),
        vadEnergyThreshold: z.number().min(0).max(1),
        vadMaxSilenceDurationMs: z.number().int().min(0).max(10000),
        vadMinSpeechDurationMs: z.number().int().min(10).max(60000),
      }))
      .mutation(({ ctx, input }) => db.saveSettingsForUser(ctx.user.id, {
        ...input,
        vadEnergyThreshold: String(input.vadEnergyThreshold),
      })),
  }),
});

export type AppRouter = typeof appRouter;
