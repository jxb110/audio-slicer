import express, { type Express } from "express";
import { sdk } from "./_core/sdk";
import { Readable } from "node:stream";
import { storeAudioUpload } from "./audioStorage";
import * as db from "./db";
import { storageGetSignedUrl } from "./storage";

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

function sanitizeIncomingFileName(value: string | undefined): string {
  if (!value) return "audio.wav";
  try {
    return decodeURIComponent(value).slice(0, 512);
  } catch {
    return "audio.wav";
  }
}

/**
 * 将音频二进制先发送到同源服务器，再由服务器写入对象存储。
 * 该路由避免浏览器直接PUT至对象存储的CORS限制，并沿用登录会话来隔离用户目录。
 */
export function registerAudioUploadRoute(app: Express): void {
  app.get("/api/audio/raw/:audioId", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req).catch(() => null);
      if (!user) {
        res.status(401).json({ error: "请先登录后读取音频" });
        return;
      }
      const requestedOwnerId = Number(req.query.ownerUserId);
      const ownerUserId = Number.isInteger(requestedOwnerId) && requestedOwnerId > 0 ? requestedOwnerId : user.id;
      if (ownerUserId !== user.id && user.role !== "admin") {
        res.status(403).json({ error: "无权读取其他账号的音频" });
        return;
      }
      const audio = await db.getAudioFileForUser(ownerUserId, req.params.audioId);
      if (!audio) {
        res.status(404).json({ error: "音频不存在或无权访问" });
        return;
      }
      const signedUrl = await storageGetSignedUrl(audio.storageKey);
      const range = req.header("range");
      const upstream = await fetch(signedUrl, {
        headers: range ? { Range: range } : undefined,
      });
      if (!upstream.ok || !upstream.body) {
        throw new Error(`对象存储读取失败（${upstream.status}）`);
      }

      const passthroughHeaders = ["content-length", "content-range", "accept-ranges"] as const;
      for (const header of passthroughHeaders) {
        const value = upstream.headers.get(header);
        if (value) res.set(header, value);
      }
      res.status(upstream.status);
      res.set("Content-Type", audio.mimeType || upstream.headers.get("content-type") || "application/octet-stream");
      res.set("Cache-Control", "private, max-age=300");
      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (error) {
      console.error("[Audio Download] Failed:", error);
      res.status(502).json({ error: "原始音频读取失败" });
    }
  });

  app.post(
    "/api/audio/upload/:audioId",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      try {
        const user = await sdk.authenticateRequest(req).catch(() => null);
        if (!user) {
          res.status(401).json({ error: "请先登录后再上传音频" });
          return;
        }
        const audioId = req.params.audioId;
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(audioId)) {
          res.status(400).json({ error: "无效的音频标识" });
          return;
        }
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: "未收到音频内容" });
          return;
        }
        const result = await storeAudioUpload({
          userId: user.id,
          audioId,
          fileName: sanitizeIncomingFileName(req.header("x-audio-file-name")),
          contentType: req.header("content-type") || "application/octet-stream",
          data: req.body,
        });
        res.status(201).json(result);
      } catch (error) {
        console.error("[Audio Upload] Failed:", error);
        res.status(500).json({ error: "音频上传失败，请稍后重试" });
      }
    },
  );
}
