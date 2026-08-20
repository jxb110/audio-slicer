import { and, asc, desc, eq } from "drizzle-orm";
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
  },
) {
  const db = await getDb();
  if (!db) throw new Error("数据库当前不可用");
  await db.insert(userSlicerSettings).values({ userId, ...settings }).onDuplicateKeyUpdate({ set: settings });
  return getSettingsForUser(userId);
}
