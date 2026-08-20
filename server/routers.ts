import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { sdk } from "./_core/sdk";
import { createAudioUploadIntent } from "./audioStorage";
import * as db from "./db";

const idSchema = z.string().min(6).max(64);
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, "账号需为3-64位小写字母、数字、点、下划线或短横线");
const passwordSchema = z.string().min(8, "密码至少8位").max(128);
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

function presentUser(user: { id: number; username: string | null; name: string | null; email: string | null; role: "user" | "admin"; isActive: boolean }) {
  return { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? presentUser(opts.ctx.user) : null),
    login: publicProcedure
      .input(z.object({ username: usernameSchema, password: z.string().min(1).max(128) }))
      .mutation(async ({ ctx, input }) => {
        const user = await db.verifyLocalCredentials(input.username, input.password);
        if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "账号、密码错误或账号已停用" });
        const token = await sdk.createSessionToken(user.openId, { name: user.name || user.username || "worker" });
        ctx.res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
        return presentUser(user);
      }),
    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }))
      .mutation(async ({ ctx, input }) => {
        const changed = await db.changeLocalPassword(ctx.user.id, input.currentPassword, input.newPassword);
        if (!changed) throw new TRPCError({ code: "BAD_REQUEST", message: "当前密码错误" });
        return { success: true };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  admin: router({
    accounts: adminProcedure.query(async () => (await db.listLocalAccounts()).map(presentUser)),
    createWorker: adminProcedure
      .input(z.object({ username: usernameSchema, displayName: z.string().trim().max(128).optional(), password: passwordSchema }))
      .mutation(async ({ input }) => {
        try {
          return presentUser(await db.createWorkerAccount(input));
        } catch (error) {
          throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : "账号创建失败" });
        }
      }),
    updateWorker: adminProcedure
      .input(z.object({ userId: z.number().int().positive(), username: usernameSchema.optional(), displayName: z.string().trim().max(128).optional(), isActive: z.boolean().optional(), password: passwordSchema.optional() }))
      .mutation(async ({ input }) => {
        try {
          const user = await db.updateWorkerAccount(input);
          if (!user) throw new Error("worker账号不存在");
          return presentUser(user);
        } catch (error) {
          throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "账号更新失败" });
        }
      }),
    workOverview: adminProcedure.query(() => db.getAdminWorkOverview()),
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
      return settings ?? { silencePrefixMs: 200, silenceSuffixMs: 200, vadEnergyThreshold: "0.01", vadMaxSilenceDurationMs: 500, vadMinSpeechDurationMs: 100 };
    }),
    save: protectedProcedure
      .input(z.object({ silencePrefixMs: z.number().int().min(0).max(10000), silenceSuffixMs: z.number().int().min(0).max(10000), vadEnergyThreshold: z.number().min(0).max(1), vadMaxSilenceDurationMs: z.number().int().min(0).max(10000), vadMinSpeechDurationMs: z.number().int().min(10).max(60000) }))
      .mutation(({ ctx, input }) => db.saveSettingsForUser(ctx.user.id, { ...input, vadEnergyThreshold: String(input.vadEnergyThreshold) })),
  }),
});

export type AppRouter = typeof appRouter;
