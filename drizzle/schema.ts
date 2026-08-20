import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 每个上传音频对应一条记录。二进制内容存入对象存储，数据库仅保存元数据与存储引用。
 * waveformPeaks 是轻量峰值数组，长音频渲染时直接使用，避免浏览器解码整段音频。
 */
export const audioFiles = mysqlTable(
  "audioFiles",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("userId").notNull(),
    originalName: varchar("originalName", { length: 512 }).notNull(),
    storageKey: varchar("storageKey", { length: 1024 }).notNull(),
    storageUrl: varchar("storageUrl", { length: 2048 }).notNull(),
    mimeType: varchar("mimeType", { length: 255 }).notNull(),
    sizeBytes: bigint("sizeBytes", { mode: "number" }).notNull(),
    durationMs: int("durationMs").notNull(),
    sampleRate: int("sampleRate"),
    bitDepth: int("bitDepth"),
    numChannels: int("numChannels"),
    /** 简化波形峰值（每个条目为0~1的峰值），用于长音频无解码渲染 */
    waveformPeaks: json("waveformPeaks"),
    waveformBucketCount: int("waveformBucketCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("audioFiles_userId_idx").on(table.userId)],
);

/** 每一个人工或 VAD 生成的切分区间，以毫秒存储以避免小数误差。 */
export const audioSegments = mysqlTable(
  "audioSegments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    audioFileId: varchar("audioFileId", { length: 64 }).notNull(),
    userId: int("userId").notNull(),
    startMs: int("startMs").notNull(),
    endMs: int("endMs").notNull(),
    label: varchar("label", { length: 512 }),
    source: mysqlEnum("source", ["manual", "vad"]).default("manual").notNull(),
    isConfirmed: boolean("isConfirmed").default(false).notNull(),
    color: varchar("color", { length: 32 }),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("audioSegments_audioFileId_idx").on(table.audioFileId),
    index("audioSegments_userId_idx").on(table.userId),
  ],
);

/** 用户的切音与 VAD 默认参数，一位用户一行配置。 */
export const userSlicerSettings = mysqlTable(
  "userSlicerSettings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    silencePrefixMs: int("silencePrefixMs").default(200).notNull(),
    silenceSuffixMs: int("silenceSuffixMs").default(200).notNull(),
    vadEnergyThreshold: varchar("vadEnergyThreshold", { length: 32 }).default("0.01").notNull(),
    vadMaxSilenceDurationMs: int("vadMaxSilenceDurationMs").default(500).notNull(),
    vadMinSpeechDurationMs: int("vadMinSpeechDurationMs").default(100).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("userSlicerSettings_userId_unique").on(table.userId)],
);

export type AudioFile = typeof audioFiles.$inferSelect;
export type InsertAudioFile = typeof audioFiles.$inferInsert;
export type AudioSegment = typeof audioSegments.$inferSelect;
export type InsertAudioSegment = typeof audioSegments.$inferInsert;
export type UserSlicerSettings = typeof userSlicerSettings.$inferSelect;
