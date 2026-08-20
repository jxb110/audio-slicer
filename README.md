#体验地址：https://audioslice-drq9e3wr.manus.space/    账号密码均为worker_demo
# 切音工具（动态持久化版）

本项目是一个面向唤醒词与语音数据标注场景的网页切音工具。音频原文件存放在对象存储中，文件元数据、切分片段和 VAD 设置存入 MySQL/TiDB 数据库；刷新页面或更换设备后，已保存的数据可恢复。片段和设置同时在浏览器 IndexedDB 留有离线缓存，因此网络短暂中断时，本机仍可恢复尚未同步的编辑内容。

> **长音频策略**：上传 WAV 后，浏览器会以分块方式读取 PCM 数据并生成轻量峰值数组。波形渲染使用这些峰值与媒体流，而不是由浏览器完整解码音频，因此可避免 30 分钟以上音频常见的全量解码内存问题。VAD 与 ZIP 导出仍会在用户主动触发时下载完整音频。

## 功能架构

| 数据 | 存储位置 | 用途 |
|---|---|---|
| 原始音频文件 | S3 兼容对象存储 | 播放、VAD、原始参数保真导出 |
| 音频元数据与波形峰值 | `audioFiles` | 文件列表、长音频概览波形、源格式参数 |
| 切分片段 | `audioSegments` | 实时保存 IN/OUT 结果、标签、来源及排序 |
| 全局切音/VAD设置 | `userSlicerSettings` | 首尾静音、能量阈值、最小时长等 |
| 用户身份 | `users` | 本地账号密码、管理员与worker作业隔离 |

## 账号与权限

应用使用**本地账号密码**，不依赖第三方OAuth。首次访问会初始化管理员账号：

| 角色 | 默认账号 | 默认密码 | 权限 |
|---|---|---|---|
| 管理员 | `` | `` | 创建/修改/停用worker、重置worker密码、查看全部worker作业与按账号筛选结果 |
| worker | 由管理员分配 | 由管理员分配 | 登录后直接切音作业；仅可访问自己名下的音频、片段和设置 |

> 首次登录后应立即在管理员控制台修改 `` 密码。管理员修改worker登录名后，旧登录名会立即失效，但该worker已有的音频和片段不会丢失。

## 本地开发

请使用 Node.js 22 与 pnpm 10。

```bash
git clone <你的仓库地址> audio-slicer
cd audio-slicer
pnpm install
cp .env.example .env
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
pnpm dev
```

本地服务启动后会在终端输出访问地址。首次启动前，请配置数据库和对象存储相关变量；不要将真实密钥提交到 Git。

## 环境变量

| 变量 | 是否必需 | 用途 |
|---|---|---|
| `DATABASE_URL` | 是 | MySQL/TiDB 数据库连接串 |
| `JWT_SECRET` | 是 | 会话签名密钥 |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | 是 | 经服务端鉴权的音频对象存储上传与下载代理 |
| `VITE_ANALYTICS_ENDPOINT` / `VITE_ANALYTICS_WEBSITE_ID` | 可选 | 访问分析 |

## 数据库迁移

数据库模式定义位于 `drizzle/schema.ts`。修改表结构时，应先生成迁移，再审核 SQL 后执行迁移：

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

音频二进制文件不写入数据库。浏览器先向同源的 `/api/audio/upload/:audioId` 上传，服务器在确认登录身份后写入对象存储；这避免了浏览器直接 PUT 到对象存储预签名地址时可能遇到的跨域限制。数据库仅保存 `storageKey`、`storageUrl`、格式参数、时长和波形峰值。

## GitHub 与托管部署

当前项目已经连接到 GitHub 远程仓库。保存检查点会同步项目源码并发布到已配置的托管环境。若在其他支持 Node.js、MySQL 和 S3 兼容存储的平台部署，应配置上述必要环境变量，并让服务端能够访问数据库与对象存储。

对象存储实现集中在 `server/audioStorage.ts` 与 `server/storage.ts`。如果目标环境不提供 Forge 兼容对象存储，可在这两个文件替换为该平台的 S3 预签名上传实现，同时保留数据库的 `storageKey` 与 `storageUrl` 字段。

## 验证命令

```bash
pnpm test
npx tsc --noEmit
pnpm build
```

## 导出命名

导出的片段遵循以下规则：

| 标签状态 | 文件名格式 | 示例 |
|---|---|---|
| 有标签 | `原始文件名_标签_段落序号.wav` | `wakeword_hello_001.wav` |
| 标签为空 | `原始文件名__段落序号.wav` | `wakeword__001.wav` |

段落序号固定为三位数。
