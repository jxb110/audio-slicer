/**
 * Home - 主页面
 * 
 * 设计风格：工具美学，左侧边栏（文件列表+设置），右侧主区域（波形+片段列表）
 * 
 * 功能：
 * - 音频文件上传与管理（支持删除）
 * - 波形显示与交互标记（左键开始，右键结束，空格确认）
 * - 首尾静音配置与可视化
 * - VAD 自动检测
 * - 片段列表管理（点击聚焦、编辑、删除、下载）
 * - 批量导出（ZIP/CSV）
 * - IndexedDB 实时保存
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import {
  Upload,
  Trash2,
  Download,
  Cpu,
  Settings,
  FileAudio,
  ChevronRight,
  Loader2,
  Package,
  FileText,
  Scissors,
  X,
  Music,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import WaveformEditor, { WaveformEditorHandle } from '@/components/WaveformEditor';
import SegmentList from '@/components/SegmentList';
import SegmentEditDialog from '@/components/SegmentEditDialog';
import SettingsPanel from '@/components/SettingsPanel';
import { AudioSegment, decodeAudioFile, downloadSegmentsAsZip, exportSegmentsAsCSV } from '@/lib/audioExport';
import {
  AudioFileRecord,
  AppSettings,
  saveAudioFile,
  loadAudioFiles,
  deleteAudioFile,
  saveFileData,
  loadFileData,
  saveSegments,
  loadSegments,
  deleteSegments,
  saveSettings,
  loadSettings,
} from '@/lib/storage';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// 空状态波形预览组件（模拟波形和时间轴，传达工具定位）
function EmptyWaveformPreview() {
  const bars = Array.from({ length: 120 }, (_, i) => {
    const x = i / 120;
    const h = 0.15 + 0.7 * Math.abs(
      Math.sin(x * 18) * Math.cos(x * 7) * Math.sin(x * 31 + 1.2)
    );
    return h;
  });
  const segmentColors = [
    { start: 0.08, end: 0.22, color: 'rgba(59,130,246,0.18)', border: 'rgba(59,130,246,0.5)' },
    { start: 0.31, end: 0.47, color: 'rgba(16,185,129,0.18)', border: 'rgba(16,185,129,0.5)' },
    { start: 0.57, end: 0.71, color: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.5)' },
    { start: 0.80, end: 0.92, color: 'rgba(139,92,246,0.18)', border: 'rgba(139,92,246,0.5)' },
  ];
  return (
    <div className="w-full select-none pointer-events-none">
      <div className="flex items-end h-6 border-b border-slate-700 bg-slate-800 px-0 relative rounded-t-lg overflow-hidden">
        {Array.from({ length: 11 }, (_, i) => (
          <div key={i} className="absolute flex flex-col items-center" style={{ left: `${i * 10}%` }}>
            <span className="text-[9px] font-mono text-slate-500 mb-0.5">{(i * 3).toFixed(1)}s</span>
            <div className="h-1.5 w-px bg-slate-600" />
          </div>
        ))}
      </div>
      <div className="relative bg-slate-900 rounded-b-lg overflow-hidden" style={{ height: 120 }}>
        {segmentColors.map((seg, i) => (
          <div key={i} className="absolute inset-y-0" style={{
            left: `${seg.start * 100}%`, width: `${(seg.end - seg.start) * 100}%`,
            backgroundColor: seg.color, borderLeft: `2px solid ${seg.border}`, borderRight: `2px solid ${seg.border}`,
          }}>
            <span className="absolute top-1 left-1 text-[9px] font-mono font-bold" style={{ color: seg.border }}>{i + 1}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-center gap-px px-1">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: `${h * 80}%`, backgroundColor: '#475569', minWidth: 1 }} />
          ))}
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 opacity-60" style={{ left: '35%' }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-indigo-400" style={{ left: '31%' }}>
          <span className="absolute bottom-1 left-1 text-[9px] font-mono font-bold text-indigo-400">IN</span>
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-violet-400" style={{ left: '47%' }}>
          <span className="absolute bottom-1 left-1 text-[9px] font-mono font-bold text-violet-400">OUT</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  // ---- 文件状态 ----
  const [audioFiles, setAudioFiles] = useState<AudioFileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ---- 片段状态 ----
  const [segments, setSegments] = useState<AudioSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [editingSegment, setEditingSegment] = useState<AudioSegment | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // ---- 标记状态 ----
  const [markedStart, setMarkedStart] = useState<number | null>(null);
  const [markedEnd, setMarkedEnd] = useState<number | null>(null);

  // ---- 设置 ----
  const [settings, setSettings] = useState<AppSettings>({
    silencePrefixMs: 200,
    silenceSuffixMs: 200,
    vadEnergyThreshold: 0.01,
    vadMaxSilenceDuration: 0.5,
    vadMinSpeechDuration: 0.1,
  });
  const [showSettings, setShowSettings] = useState(false);

  // ---- VAD ----
  const [isRunningVAD, setIsRunningVAD] = useState(false);

  // ---- 导出 ----
  const [isExporting, setIsExporting] = useState(false);

  // ---- Refs ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<WaveformEditorHandle>(null);
  const objectUrlRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 并发保护：记录当前正在加载的 fileId，避免多次触发
  const loadingFileIdRef = useRef<string | null>(null);

  // ---- 初始化：从 IndexedDB 加载数据 ----
  useEffect(() => {
    (async () => {
      try {
        const [files, s] = await Promise.all([loadAudioFiles(), loadSettings()]);
        setAudioFiles(files);
        setSettings(s);
      } catch (err) {
        console.error('加载数据失败:', err);
      }
    })();
  }, []);

  // ---- 当前选中文件 ----
  const selectedFile = useMemo(
    () => audioFiles.find((f) => f.id === selectedFileId) || null,
    [audioFiles, selectedFileId]
  );

  // ---- 加载音频文件 ----
  const loadAudioFile = useCallback(async (fileId: string) => {
    // 并发保护：如果已经在加载同一个文件，跳过
    if (loadingFileIdRef.current === fileId) return;
    loadingFileIdRef.current = fileId;

    setIsLoadingFile(true);
    setAudioBuffer(null);
    setMarkedStart(null);
    setMarkedEnd(null);
    setSelectedSegmentId(null);

    // 释放旧的 URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setAudioUrl(null);

    try {
      const data = await loadFileData(fileId);

      // 检查是否已被取消（用户切换到其他文件）
      if (loadingFileIdRef.current !== fileId) return;

      if (!data) {
        toast.error('无法加载音频文件数据');
        return;
      }

      // 从 audioFiles state 或直接从 IndexedDB 获取文件记录
      const allFiles = await loadAudioFiles();
      const fileRecord = allFiles.find((f) => f.id === fileId);
      if (!fileRecord) {
        toast.error('找不到文件记录');
        return;
      }

      if (loadingFileIdRef.current !== fileId) return;

      const blob = new Blob([data], { type: fileRecord.type || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setAudioUrl(url);

      // 解码 AudioBuffer（用于 VAD 和导出）
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const buffer = await audioCtx.decodeAudioData(data.slice(0));
        await audioCtx.close();
        if (loadingFileIdRef.current === fileId) {
          setAudioBuffer(buffer);
        }
      } catch (decodeErr) {
        console.warn('AudioBuffer 解码失败（不影响波形播放）:', decodeErr);
      }

      // 加载片段
      const segs = await loadSegments(fileId);
      if (loadingFileIdRef.current === fileId) {
        setSegments(segs);
      }
    } catch (err) {
      if (loadingFileIdRef.current === fileId) {
        toast.error('加载音频失败: ' + (err as Error).message);
      }
    } finally {
      if (loadingFileIdRef.current === fileId) {
        loadingFileIdRef.current = null;
        setIsLoadingFile(false);
      }
    }
  // 移除 audioFiles 依赖，改为直接读 IndexedDB，避免 stale closure
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 选择文件 ----
  const handleSelectFile = useCallback(async (fileId: string) => {
    if (fileId === selectedFileId) return;
    loadingFileIdRef.current = null; // 取消当前加载
    setSelectedFileId(fileId);
  }, [selectedFileId]);

  // selectedFileId 变化时触发加载（唯一触发点）
  useEffect(() => {
    if (selectedFileId) {
      loadAudioFile(selectedFileId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileId]);

  // ---- 上传文件 ----
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    let firstNewId: string | null = null;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/')) {
        toast.error(`${file.name} 不是音频文件`);
        continue;
      }

      const id = nanoid();
      const record: AudioFileRecord = {
        id,
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      };

      try {
        const arrayBuffer = await file.arrayBuffer();
        await Promise.all([
          saveAudioFile(record),
          saveFileData(id, arrayBuffer),
        ]);
        setAudioFiles((prev) => [...prev, record]);
        toast.success(`已上传: ${file.name}`);

        // 记录第一个新上传的文件 id
        if (!firstNewId) {
          firstNewId = id;
        }
      } catch (err) {
        toast.error(`上传失败: ${file.name}`);
      }
    }

    // 上传完成后，如果没有选中文件，自动选中第一个新文件
    // setSelectedFileId 会触发 useEffect([selectedFileId]) 来加载，只触发一次
    if (firstNewId && !selectedFileId) {
      setSelectedFileId(firstNewId);
    }
  }, [selectedFileId]);

  // ---- 删除文件 ----
  const handleDeleteFile = useCallback(async (fileId: string) => {
    try {
      await Promise.all([
        deleteAudioFile(fileId),
        deleteSegments(fileId),
      ]);
      setAudioFiles((prev) => prev.filter((f) => f.id !== fileId));
      if (selectedFileId === fileId) {
        setSelectedFileId(null);
        setAudioUrl(null);
        setAudioBuffer(null);
        setSegments([]);
        setMarkedStart(null);
        setMarkedEnd(null);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      }
      toast.success('文件已删除');
    } catch (err) {
      toast.error('删除失败');
    }
    setDeleteConfirmId(null);
  }, [selectedFileId]);

  // ---- 实时保存片段（防抖 500ms）----
  const debouncedSaveSegments = useCallback((fileId: string, segs: AudioSegment[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveSegments(fileId, segs);
      } catch (err) {
        console.error('保存片段失败:', err);
      }
    }, 500);
  }, []);

  // ---- 标记开始 ----
  const handleMarkStart = useCallback((time: number) => {
    setMarkedStart(time);
    setMarkedEnd(null); // 重置结束标记
  }, []);

  // ---- 标记结束 ----
  const handleMarkEnd = useCallback((time: number) => {
    setMarkedEnd(time);
  }, []);

  // ---- 确认保存片段（空格键）----
  const handleConfirm = useCallback(() => {
    if (markedStart === null || markedEnd === null) {
      if (markedStart !== null) {
        toast.info('请先右键标记结束时间');
      }
      return;
    }

    const start = Math.min(markedStart, markedEnd);
    const end = Math.max(markedStart, markedEnd);

    if (end - start < 0.01) {
      toast.warning('片段太短，请重新标记');
      return;
    }

    // 加上首尾静音
    const prefixSec = settings.silencePrefixMs / 1000;
    const suffixSec = settings.silenceSuffixMs / 1000;
    const finalStart = Math.max(0, start - prefixSec);
    const finalEnd = Math.min(audioDuration || Infinity, end + suffixSec);

    const newSegment: AudioSegment = {
      id: nanoid(),
      startTime: finalStart,
      endTime: finalEnd,
      source: 'manual',
      isConfirmed: true,
    };

    const newSegments = [...segments, newSegment].sort((a, b) => a.startTime - b.startTime);
    setSegments(newSegments);
    setSelectedSegmentId(newSegment.id);

    if (selectedFileId) {
      debouncedSaveSegments(selectedFileId, newSegments);
    }

    // 重置标记
    setMarkedStart(null);
    setMarkedEnd(null);

    toast.success(`片段 ${newSegments.indexOf(newSegment) + 1} 已保存`);
  }, [markedStart, markedEnd, segments, settings, audioDuration, selectedFileId, debouncedSaveSegments]);

  // ---- 点击片段，聚焦波形 ----
  const handleSegmentClick = useCallback((segmentId: string) => {
    setSelectedSegmentId(segmentId);
    const seg = segments.find((s) => s.id === segmentId);
    if (seg) {
      // 自动播放该片段区间
      waveformRef.current?.playRange(seg.startTime, seg.endTime);
    }
  }, [segments]);

  // ---- 删除片段 ----
  const handleDeleteSegment = useCallback((segmentId: string) => {
    const newSegments = segments.filter((s) => s.id !== segmentId);
    setSegments(newSegments);
    if (selectedSegmentId === segmentId) setSelectedSegmentId(null);
    if (selectedFileId) {
      debouncedSaveSegments(selectedFileId, newSegments);
    }
    toast.success('片段已删除');
  }, [segments, selectedSegmentId, selectedFileId, debouncedSaveSegments]);

  // ---- 编辑片段 ----
  const handleSaveSegmentEdit = useCallback((updated: AudioSegment) => {
    const newSegments = segments
      .map((s) => (s.id === updated.id ? updated : s))
      .sort((a, b) => a.startTime - b.startTime);
    setSegments(newSegments);
    if (selectedFileId) {
      debouncedSaveSegments(selectedFileId, newSegments);
    }
    toast.success('片段已更新');
  }, [segments, selectedFileId, debouncedSaveSegments]);

  // ---- 更新设置 ----
  const handleSettingsChange = useCallback(async (newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      await saveSettings(newSettings);
    } catch (err) {
      console.error('保存设置失败:', err);
    }
  }, []);

  // ---- VAD 检测 ----
  const handleRunVAD = useCallback(async () => {
    if (!selectedFileId || !audioBuffer) {
      toast.error('请先选择音频文件');
      return;
    }
    setIsRunningVAD(true);
    try {
      const prefixSec = settings.silencePrefixMs / 1000;
      const suffixSec = settings.silenceSuffixMs / 1000;

      // 直接使用已解码的 AudioBuffer 进行 VAD 检测
      const { detectVoiceSegments } = await import('@/lib/vad');
      const vadSegments = await detectVoiceSegments(audioBuffer, {
        energyThreshold: settings.vadEnergyThreshold,
        maxSilenceDuration: settings.vadMaxSilenceDuration,
        minSpeechDuration: settings.vadMinSpeechDuration,
        silencePrefix: prefixSec,
        silenceSuffix: suffixSec,
      });

      if (vadSegments.length === 0) {
        toast.warning('VAD 未检测到语音片段，请调整灵敏度');
        return;
      }

      const newSegs: AudioSegment[] = vadSegments.map((seg) => ({
        id: nanoid(),
        startTime: seg.startTime,
        endTime: seg.endTime,
        source: 'vad' as const,
        isConfirmed: false,
      }));

      const merged = [...segments, ...newSegs].sort((a, b) => a.startTime - b.startTime);
      setSegments(merged);
      if (selectedFileId) {
        debouncedSaveSegments(selectedFileId, merged);
      }
      toast.success(`VAD 检测到 ${newSegs.length} 个片段`);
    } catch (err) {
      toast.error('VAD 检测失败: ' + (err as Error).message);
    } finally {
      setIsRunningVAD(false);
    }
  }, [selectedFileId, audioBuffer, settings, segments, selectedFile, debouncedSaveSegments]);

  // ---- 清空所有片段 ----
  const handleClearSegments = useCallback(async () => {
    setSegments([]);
    setSelectedSegmentId(null);
    if (selectedFileId) {
      await saveSegments(selectedFileId, []);
    }
    toast.success('已清空所有片段');
  }, [selectedFileId]);

  // ---- 批量导出 ----
  const handleExportZip = useCallback(async () => {
    if (!audioBuffer || segments.length === 0) return;
    setIsExporting(true);
    try {
      const baseName = (selectedFile?.name || 'audio').replace(/\.[^/.]+$/, '');
      await downloadSegmentsAsZip(audioBuffer, segments, `${baseName}_segments.zip`);
      toast.success(`已导出 ${segments.length} 个片段`);
    } catch (err) {
      toast.error('导出失败: ' + (err as Error).message);
    } finally {
      setIsExporting(false);
    }
  }, [audioBuffer, segments, selectedFile]);

  const handleExportCSV = useCallback(() => {
    if (segments.length === 0) return;
    const baseName = (selectedFile?.name || 'audio').replace(/\.[^/.]+$/, '');
    exportSegmentsAsCSV(segments, `${baseName}_segments.csv`);
    toast.success('元数据已导出');
  }, [segments, selectedFile]);

  // ---- 拖拽上传 ----
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileUpload(e.dataTransfer.files);
  }, [handleFileUpload]);

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* 顶部工具栏 */}
      <header className="flex-shrink-0 h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Scissors className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-800 text-sm tracking-tight font-mono">切音工具</span>
          <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">v1.0</span>
        </div>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        <div className="flex-1" />

        {/* 设置按钮 */}
        <Popover open={showSettings} onOpenChange={setShowSettings}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <Settings className="w-3.5 h-3.5" />
              设置
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-4">
            <SettingsPanel settings={settings} onChange={handleSettingsChange} />
          </PopoverContent>
        </Popover>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧边栏：文件列表 */}
        <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">音频文件</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className="h-6 w-6 p-0 text-slate-500 hover:text-blue-600"
              title="上传音频"
            >
              <Upload className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {audioFiles.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-8 text-center text-slate-400 text-xs gap-2 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 hover:text-blue-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <Music className="w-8 h-8 text-slate-300" />
                <p>点击或拖拽上传</p>
                <p className="text-slate-300">支持 MP3、WAV、OGG</p>
              </div>
            ) : (
              audioFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={() => handleSelectFile(file.id)}
                  className={`group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors ${
                    selectedFileId === file.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <FileAudio className={`w-4 h-4 flex-shrink-0 ${selectedFileId === file.id ? 'text-blue-500' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{file.name}</p>
                    <p className="text-xs text-slate-400">{formatFileSize(file.size)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(file.id); }}
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 flex-shrink-0"
                    title="删除文件"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* 上传按钮 */}
          {audioFiles.length > 0 && (
            <div className="p-2 border-t border-slate-100">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-8 text-xs gap-1.5"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <Upload className="w-3 h-3" />
                上传音频
              </Button>
            </div>
          )}
        </aside>

        {/* 主内容区 */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedFileId && selectedFile ? (
            <>
              {/* 文件信息栏 */}
              <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-slate-200">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <FileAudio className="w-4 h-4 text-blue-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-800 truncate">{selectedFile.name}</span>
                  {audioDuration > 0 && (
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {formatDuration(audioDuration)}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs flex-shrink-0">
                    {segments.length} 个片段
                  </Badge>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2">
                  {/* VAD 按钮 */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRunVAD}
                    disabled={isRunningVAD || !audioBuffer}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {isRunningVAD ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Cpu className="w-3.5 h-3.5" />
                    )}
                    {isRunningVAD ? 'VAD 检测中...' : 'VAD 自动检测'}
                  </Button>

                  {/* 导出按钮 */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={segments.length === 0 || isExporting}
                        className="h-8 gap-1.5 text-xs"
                      >
                        {isExporting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        导出
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={handleExportZip} className="gap-2 text-sm">
                        <Package className="w-4 h-4" />
                        批量下载 ZIP
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleExportCSV} className="gap-2 text-sm">
                        <FileText className="w-4 h-4" />
                        导出元数据 CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* 清空片段 */}
                  {segments.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearSegments}
                      className="h-8 gap-1.5 text-xs text-slate-500 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      清空
                    </Button>
                  )}
                </div>
              </div>

              {/* 波形区域 */}
              <div className="flex-shrink-0 px-4 py-3 bg-white border-b border-slate-200">
                {isLoadingFile ? (
                  <div className="flex items-center justify-center h-40 bg-slate-900 rounded-lg">
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      加载音频中...
                    </div>
                  </div>
                ) : audioUrl ? (
                  <WaveformEditor
                    ref={waveformRef}
                    audioUrl={audioUrl}
                    audioFile={null}
                    segments={segments}
                    silencePrefixMs={settings.silencePrefixMs}
                    silenceSuffixMs={settings.silenceSuffixMs}
                    selectedSegmentId={selectedSegmentId}
                    markedStart={markedStart}
                    markedEnd={markedEnd}
                    onReady={setAudioDuration}
                    onMarkStart={handleMarkStart}
                    onMarkEnd={handleMarkEnd}
                    onConfirm={handleConfirm}
                    onSegmentClick={handleSegmentClick}
                  />
                ) : null}
              </div>

              {/* 片段列表 */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    片段列表 ({segments.length})
                  </span>
                </div>
                <SegmentList
                  segments={segments}
                  selectedSegmentId={selectedSegmentId}
                  audioBuffer={audioBuffer}
                  audioFileName={selectedFile.name}
                  onSelect={handleSegmentClick}
                  onDelete={handleDeleteSegment}
                  onEdit={(seg) => { setEditingSegment(seg); setShowEditDialog(true); }}
                />
              </div>
            </>
          ) : (
            /* 空状态 */
            <div
              className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <div className="w-full max-w-3xl px-8">
                <EmptyWaveformPreview />
              </div>
              <div className="flex flex-col items-center gap-3 mt-2">
                <div className="flex items-center gap-5 text-xs font-mono text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: 'rgba(59,130,246,0.5)' }} />手动标记</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: 'rgba(139,92,246,0.5)' }} />VAD 检测</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: 'rgba(16,185,129,0.5)' }} />已确认</span>
                </div>
                <p className="text-sm font-semibold text-slate-700 font-mono">上传音频，开始标注切分</p>
                <p className="text-xs text-slate-400">支持 MP3 · WAV · OGG · M4A · 文件名可含空格</p>
                <Button onClick={() => fileInputRef.current?.click()} className="gap-2 mt-1">
                  <Upload className="w-4 h-4" />
                  上传音频文件
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 隐藏文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={(e) => handleFileUpload(e.target.files)}
        onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
      />

      {/* 片段编辑对话框 */}
      <SegmentEditDialog
        open={showEditDialog}
        segment={editingSegment}
        duration={audioDuration}
        silencePrefixMs={settings.silencePrefixMs}
        silenceSuffixMs={settings.silenceSuffixMs}
        onClose={() => { setShowEditDialog(false); setEditingSegment(null); }}
        onSave={handleSaveSegmentEdit}
      />

      {/* 删除文件确认对话框 */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(v) => !v && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将无法恢复，包括该文件的所有片段数据。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDeleteFile(deleteConfirmId)}
              className="bg-red-600 hover:bg-red-700"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
