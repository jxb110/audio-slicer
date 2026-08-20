/**
 * 本地存储工具 - 使用 IndexedDB 实现实时保存
 * 保存音频文件元数据、片段信息和全局配置
 */

import { AudioSegment } from './audioExport';

export interface AudioFileRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  /** 存储在 IndexedDB 中的原始文件数据 */
  data?: ArrayBuffer;
}

export interface AppSettings {
  silencePrefixMs: number;
  silenceSuffixMs: number;
  vadEnergyThreshold: number;
  vadMaxSilenceDuration: number;
  vadMinSpeechDuration: number;
  allowSegmentOverlap: boolean;
}

export interface ProjectData {
  audioFiles: AudioFileRecord[];
  segments: Record<string, AudioSegment[]>; // key: audioFileId
  settings: AppSettings;
  lastUpdated: number;
}

const DB_NAME = 'AudioSlicerDB';
const DB_VERSION = 1;
const STORE_FILES = 'audioFiles';
const STORE_SEGMENTS = 'segments';
const STORE_SETTINGS = 'settings';
const STORE_FILE_DATA = 'fileData';

let db: IDBDatabase | null = null;

export async function openDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(STORE_FILES)) {
        database.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_SEGMENTS)) {
        database.createObjectStore(STORE_SEGMENTS, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
        database.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_FILE_DATA)) {
        database.createObjectStore(STORE_FILE_DATA, { keyPath: 'id' });
      }
    };
  });
}

// ---- 音频文件元数据 ----

export async function saveAudioFile(record: AudioFileRecord): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    const req = store.put(record);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

export async function loadAudioFiles(): Promise<AudioFileRecord[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_FILES, 'readonly');
    const store = tx.objectStore(STORE_FILES);
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });
}

export async function deleteAudioFile(id: string): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_FILES, STORE_FILE_DATA], 'readwrite');
    tx.objectStore(STORE_FILES).delete(id);
    tx.objectStore(STORE_FILE_DATA).delete(id);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

// ---- 音频文件二进制数据 ----

export async function saveFileData(id: string, data: ArrayBuffer): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_FILE_DATA, 'readwrite');
    const store = tx.objectStore(STORE_FILE_DATA);
    const req = store.put({ id, data });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

export async function loadFileData(id: string): Promise<ArrayBuffer | null> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_FILE_DATA, 'readonly');
    const store = tx.objectStore(STORE_FILE_DATA);
    const req = store.get(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result?.data || null);
  });
}

// ---- 片段数据 ----

export async function saveSegments(audioFileId: string, segments: AudioSegment[]): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SEGMENTS, 'readwrite');
    const store = tx.objectStore(STORE_SEGMENTS);
    const req = store.put({ key: audioFileId, segments });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

export async function loadSegments(audioFileId: string): Promise<AudioSegment[]> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SEGMENTS, 'readonly');
    const store = tx.objectStore(STORE_SEGMENTS);
    const req = store.get(audioFileId);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result?.segments || []);
  });
}

export async function deleteSegments(audioFileId: string): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SEGMENTS, 'readwrite');
    const store = tx.objectStore(STORE_SEGMENTS);
    const req = store.delete(audioFileId);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

// ---- 全局设置 ----

const DEFAULT_SETTINGS: AppSettings = {
  silencePrefixMs: 200,
  silenceSuffixMs: 200,
  vadEnergyThreshold: 0.01,
  vadMaxSilenceDuration: 0.5,
  vadMinSpeechDuration: 0.1,
  allowSegmentOverlap: false,
};

export async function saveSettings(settings: AppSettings): Promise<void> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);
    const req = store.put({ id: 'global', ...settings });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

export async function loadSettings(): Promise<AppSettings> {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);
    const req = store.get('global');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result ? { ...DEFAULT_SETTINGS, ...req.result } : DEFAULT_SETTINGS);
  });
}
