import bcrypt from "bcryptjs";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  audioFiles,
  audioSegments,
  InsertAudioFile,
  InsertUser,
  userSlicerSettings,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export async function ensureDefaultAdmin() {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const existing = await db.select().from(users).where(eq(users.username, DEFAULT_ADMIN_USERNAME)).limit(1);
  if (existing[0]) return existing[0];
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
  await db.insert(users).values({
    openId: `local:${DEFAULT_ADMIN_USERNAME}`,
    username: DEFAULT_ADMIN_USERNAME,
    passwordHash,
    name: "管理员",
    loginMethod: "local",
    role: "admin",
    isActive: true,
    lastSignedIn: new Date(),
  });
  const created = await db.select().from(users).where(eq(users.username, DEFAULT_ADMIN_USERNAME)).limit(1);
  if (!created[0]) throw new Error("管理员账号初始化失败");
  return created[0];
}

export async function getLocalUserByUsername(username: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const result = await db.select().from(users).where(eq(users.username, normalizeUsername(username))).limit(1);
  return result[0];
}

export async function getLocalUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function verifyLocalCredentials(username: string, password: string) {
  await ensureDefaultAdmin();
  const user = await getLocalUserByUsername(username);
  if (!user || user.loginMethod !== "local" || !user.passwordHash || !user.isActive) return undefined;
  if (!(await bcrypt.compare(password, user.passwordHash))) return undefined;
  const db = await getDb();
  await db?.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  return user;
}

export async function changeLocalPassword(userId: number, currentPassword: string, newPassword: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user?.passwordHash || user.loginMethod !== "local") return false;
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return false;
  await db.update(users).set({ passwordHash: await bcrypt.hash(newPassword, 12) }).where(eq(users.id, userId));
  return true;
}

export async function createWorkerAccount(input: { username: string; displayName?: string | null; password: string }) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const username = normalizeUsername(input.username);
  if (await getLocalUserByUsername(username)) throw new Error("该登录账号已存在");
  await db.insert(users).values({
    openId: `local:${username}`,
    username,
    passwordHash: await bcrypt.hash(input.password, 12),
    name: input.displayName?.trim() || username,
    loginMethod: "local",
    role: "user",
    isActive: true,
    lastSignedIn: new Date(),
  });
  const created = await getLocalUserByUsername(username);
  if (!created) throw new Error("worker账号创建失败");
  return created;
}

export async function listLocalAccounts() {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  return db.select({
    id: users.id,
    username: users.username,
    name: users.name,
    email: users.email,
    role: users.role,
    isActive: users.isActive,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).where(eq(users.loginMethod, "local")).orderBy(asc(users.role), asc(users.username));
}

export async function updateWorkerAccount(input: { userId: number; username?: string; displayName?: string | null; isActive?: boolean; password?: string }) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const user = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
  if (!user || user.loginMethod !== "local" || user.role === "admin") throw new Error("worker账号不存在");
  const values: Record<string, unknown> = {};
  if (input.username !== undefined) {
    const username = normalizeUsername(input.username);
    const duplicate = await getLocalUserByUsername(username);
    if (duplicate && duplicate.id !== user.id) throw new Error("该登录账号已存在");
    values.username = username;
    values.openId = `local:${username}`;
  }
  if (input.displayName !== undefined) values.name = input.displayName?.trim() || user.username;
  if (input.isActive !== undefined) values.isActive = input.isActive;
  if (input.password) values.passwordHash = await bcrypt.hash(input.password, 12);
  if (Object.keys(values).length > 0) await db.update(users).set(values).where(eq(users.id, input.userId));
  return (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
}

export async function getAdminWorkOverview() {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const accounts = await listLocalAccounts();
  const accountIds = accounts.map(account => account.id);
  if (accountIds.length === 0) return { accounts: [], recentFiles: [] };
  const [fileCounts, segmentCounts, recentFiles] = await Promise.all([
    db.select({ userId: audioFiles.userId, count: count(audioFiles.id), latest: max(audioFiles.updatedAt) }).from(audioFiles).where(inArray(audioFiles.userId, accountIds)).groupBy(audioFiles.userId),
    db.select({ userId: audioSegments.userId, count: count(audioSegments.id) }).from(audioSegments).where(inArray(audioSegments.userId, accountIds)).groupBy(audioSegments.userId),
    db.select({ id: audioFiles.id, userId: audioFiles.userId, originalName: audioFiles.originalName, durationMs: audioFiles.durationMs, updatedAt: audioFiles.updatedAt, username: users.username, workerName: users.name }).from(audioFiles).leftJoin(users, eq(audioFiles.userId, users.id)).where(inArray(audioFiles.userId, accountIds)).orderBy(desc(audioFiles.updatedAt)).limit(100),
  ]);
  const fileMap = new Map(fileCounts.map(row => [row.userId, row]));
  const segmentMap = new Map(segmentCounts.map(row => [row.userId, row.count]));
  return {
    accounts: accounts.map(account => ({ ...account, audioCount: Number(fileMap.get(account.id)?.count || 0), segmentCount: Number(segmentMap.get(account.id) || 0), latestWorkAt: fileMap.get(account.id)?.latest || null })),
    recentFiles,
  };
}

export async function listAudioFilesForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  return db.select().from(audioFiles).where(eq(audioFiles.userId, userId)).orderBy(desc(audioFiles.createdAt));
}

export async function getAudioFileForUser(userId: number, audioFileId: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const result = await db
    .select()
    .from(audioFiles)
    .where(and(eq(audioFiles.userId, userId), eq(audioFiles.id, audioFileId)))
    .limit(1);
  return result[0];
}

export async function createAudioFile(record: InsertAudioFile) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  await db.insert(audioFiles).values(record);
  return getAudioFileForUser(record.userId, record.id);
}

export async function deleteAudioFileForUser(userId: number, audioFileId: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const existing = await getAudioFileForUser(userId, audioFileId);
  if (!existing) return false;
  await db.transaction(async tx => {
    await tx.delete(audioSegments).where(and(eq(audioSegments.userId, userId), eq(audioSegments.audioFileId, audioFileId)));
    await tx.delete(audioFiles).where(and(eq(audioFiles.userId, userId), eq(audioFiles.id, audioFileId)));
  });
  return true;
}

export async function listSegmentsForUser(userId: number, audioFileId: string) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  return db
    .select()
    .from(audioSegments)
    .where(and(eq(audioSegments.userId, userId), eq(audioSegments.audioFileId, audioFileId)))
    .orderBy(asc(audioSegments.sortOrder), asc(audioSegments.startMs));
}

export async function replaceSegmentsForUser(
  userId: number,
  audioFileId: string,
  segments: Array<{
    id: string;
    startMs: number;
    endMs: number;
    label?: string | null;
    source: "manual" | "vad";
    isConfirmed: boolean;
    color?: string | null;
    sortOrder: number;
  }>,
) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  await db.transaction(async tx => {
    await tx.delete(audioSegments).where(and(eq(audioSegments.userId, userId), eq(audioSegments.audioFileId, audioFileId)));
    if (segments.length > 0) {
      await tx.insert(audioSegments).values(
        segments.map(segment => ({
          ...segment,
          audioFileId,
          userId,
          label: segment.label || null,
          color: segment.color || null,
        })),
      );
    }
  });
  return listSegmentsForUser(userId, audioFileId);
}

export async function getSettingsForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  const result = await db.select().from(userSlicerSettings).where(eq(userSlicerSettings.userId, userId)).limit(1);
  return result[0];
}

export async function saveSettingsForUser(
  userId: number,
  settings: {
    silencePrefixMs: number;
    silenceSuffixMs: number;
    vadEnergyThreshold: string;
    vadMaxSilenceDurationMs: number;
    vadMinSpeechDurationMs: number;
    allowSegmentOverlap: boolean;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  await db.insert(userSlicerSettings).values({ userId, ...settings }).onDuplicateKeyUpdate({ set: settings });
  return getSettingsForUser(userId);
}
