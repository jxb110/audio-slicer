/**
 * WaveformEditor - 核心波形编辑组件
 *
 * 修复记录 v2:
 * 1. overlay canvas 改为绘制完整 scrollWidth 宽度，通过 translateX 跟随滚动，缩放后片段位置精确
 * 2. 左键标记 IN 后自动从该位置播放；右键标记 OUT 后自动播放 IN→OUT 区间预览
 * 3. 去掉空格确认后的自动波形跳转逻辑（已在 Home.tsx 移除）
 * 4. playRange 暴露给父组件，点击片段列表时播放该片段
 */

import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, SkipBack, ZoomIn, ZoomOut, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { AudioSegment } from '@/lib/audioExport';

interface WaveformEditorProps {
  audioUrl: string;
  audioFile: File | null;
  segments: AudioSegment[];
  silencePrefixMs: number;
  silenceSuffixMs: number;
  selectedSegmentId: string | null;
  onReady?: (duration: number) => void;
  onMarkStart?: (time: number) => void;
  onMarkEnd?: (time: number) => void;
  onConfirm?: () => void;
  onSegmentClick?: (segmentId: string) => void;
  markedStart: number | null;
  markedEnd: number | null;
}

export interface WaveformEditorHandle {
  seekTo: (time: number) => void;
  getWaveSurfer: () => WaveSurfer | null;
  playRange: (start: number, end: number) => void;
}

// 片段颜色列表（柔和色调）
const SEGMENT_COLORS = [
  'rgba(59, 130, 246, 0.25)',
  'rgba(16, 185, 129, 0.25)',
  'rgba(245, 158, 11, 0.25)',
  'rgba(239, 68, 68, 0.25)',
  'rgba(139, 92, 246, 0.25)',
  'rgba(236, 72, 153, 0.25)',
  'rgba(20, 184, 166, 0.25)',
  'rgba(249, 115, 22, 0.25)',
];

const SEGMENT_BORDER_COLORS = [
  'rgba(59, 130, 246, 0.7)',
  'rgba(16, 185, 129, 0.7)',
  'rgba(245, 158, 11, 0.7)',
  'rgba(239, 68, 68, 0.7)',
  'rgba(139, 92, 246, 0.7)',
  'rgba(236, 72, 153, 0.7)',
  'rgba(20, 184, 166, 0.7)',
  'rgba(249, 115, 22, 0.7)',
];

export function getSegmentColor(index: number) {
  return {
    bg: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
    border: SEGMENT_BORDER_COLORS[index % SEGMENT_BORDER_COLORS.length],
  };
}

const WaveformEditor = forwardRef<WaveformEditorHandle, WaveformEditorProps>(
  (
    {
      audioUrl,
      segments,
      silencePrefixMs,
      silenceSuffixMs,
      selectedSegmentId,
      onReady,
      onMarkStart,
      onMarkEnd,
      onConfirm,
      onSegmentClick,
      markedStart,
      markedEnd,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isReady, setIsReady] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [volume, setVolume] = useState(1);
    const durationRef = useRef(0);
    const segmentsRef = useRef(segments);
    const markedStartRef = useRef(markedStart);
    const markedEndRef = useRef(markedEnd);
    const silencePrefixRef = useRef(silencePrefixMs);
    const silenceSuffixRef = useRef(silenceSuffixMs);
    const selectedSegmentIdRef = useRef(selectedSegmentId);
    // 片段区间播放
    const playRangeEndRef = useRef<number | null>(null);
    const playRangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 保持 ref 同步
    useEffect(() => { segmentsRef.current = segments; }, [segments]);
    useEffect(() => { markedStartRef.current = markedStart; }, [markedStart]);
    useEffect(() => { markedEndRef.current = markedEnd; }, [markedEnd]);
    useEffect(() => { silencePrefixRef.current = silencePrefixMs; }, [silencePrefixMs]);
    useEffect(() => { silenceSuffixRef.current = silenceSuffixMs; }, [silenceSuffixMs]);
    useEffect(() => { selectedSegmentIdRef.current = selectedSegmentId; }, [selectedSegmentId]);

    // 获取 WaveSurfer 内部滚动容器（缓存查找逻辑）
    const getScrollContainer = useCallback((): HTMLElement | null => {
      const container = containerRef.current;
      if (!container) return null;
      return (container.querySelector('[part="scroll"]') as HTMLElement)
        || (container.querySelector('div[style*="overflow-x"]') as HTMLElement)
        || (container.querySelector('div[style*="overflow: auto"]') as HTMLElement)
        || null;
    }, []);

    // 播放区间（供外部调用）
    const playRange = useCallback((start: number, end: number) => {
      const ws = wavesurferRef.current;
      if (!ws || durationRef.current === 0) return;
      if (playRangeTimerRef.current) clearTimeout(playRangeTimerRef.current);
      playRangeEndRef.current = end;
      ws.seekTo(start / durationRef.current);
      ws.play();
      const durationMs = (end - start) * 1000;
      playRangeTimerRef.current = setTimeout(() => {
        if (wavesurferRef.current) {
          wavesurferRef.current.pause();
          if (durationRef.current > 0) wavesurferRef.current.seekTo(start / durationRef.current);
        }
        playRangeEndRef.current = null;
      }, durationMs + 80);
    }, []);

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (wavesurferRef.current && durationRef.current > 0) {
          wavesurferRef.current.seekTo(time / durationRef.current);
        }
      },
      getWaveSurfer: () => wavesurferRef.current,
      playRange,
    }));

    // ---- 绘制 overlay ----
    // 核心修复：canvas 宽度 = scrollWidth（完整波形宽度），通过 translateX(-scrollLeft) 跟随滚动
    // 这样无论缩放多少倍，timeToX 的坐标始终与波形像素对齐
    const drawOverlay = useCallback(() => {
      const canvas = overlayRef.current;
      const container = containerRef.current;
      if (!canvas || !container || durationRef.current === 0) return;

      const scrollEl = getScrollContainer();
      const totalWidth = scrollEl ? scrollEl.scrollWidth : container.clientWidth;
      const scrollLeft = scrollEl ? scrollEl.scrollLeft : 0;
      const height = container.clientHeight;

      // 设置 canvas 物理尺寸
      canvas.width = totalWidth;
      canvas.height = height;
      // CSS 宽度也要跟上，否则 canvas 会被拉伸
      canvas.style.width = `${totalWidth}px`;
      // 通过 translateX 让 canvas 跟随滚动位置
      canvas.style.transform = `translateX(-${scrollLeft}px)`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, totalWidth, height);

      const dur = durationRef.current;
      const timeToX = (t: number) => (t / dur) * totalWidth;

      // 绘制已保存的片段
      segmentsRef.current.forEach((seg, idx) => {
        const x1 = timeToX(seg.startTime);
        const x2 = timeToX(seg.endTime);
        const colors = getSegmentColor(idx);
        const isSelected = seg.id === selectedSegmentIdRef.current;

        ctx.fillStyle = isSelected ? colors.bg.replace('0.25', '0.4') : colors.bg;
        ctx.fillRect(x1, 0, x2 - x1, height);

        ctx.strokeStyle = colors.border;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(x1, 0, x2 - x1, height);

        ctx.fillStyle = colors.border.replace('0.7', '1');
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText(`${idx + 1}`, x1 + 3, 14);
      });

      // 绘制当前标记区域（含首尾静音）
      const prefixSec = silencePrefixRef.current / 1000;
      const suffixSec = silenceSuffixRef.current / 1000;

      if (markedStartRef.current !== null) {
        const rawStart = markedStartRef.current;
        const startWithSilence = Math.max(0, rawStart - prefixSec);
        const endWithSilence = markedEndRef.current !== null
          ? Math.min(dur, markedEndRef.current + suffixSec)
          : null;

        // 前置静音区域
        if (prefixSec > 0) {
          const sx1 = timeToX(startWithSilence);
          const sx2 = timeToX(rawStart);
          ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
          ctx.fillRect(sx1, 0, sx2 - sx1, height);
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(sx1, 0); ctx.lineTo(sx1, height); ctx.stroke();
          ctx.setLineDash([]);
        }

        // 开始标记线
        const sx = timeToX(rawStart);
        ctx.strokeStyle = '#4F46E5';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, height); ctx.stroke();
        ctx.fillStyle = '#4F46E5';
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.fillText('IN', sx + 3, height - 4);

        if (markedEndRef.current !== null && endWithSilence !== null) {
          const rawEnd = markedEndRef.current;
          const ex = timeToX(rawEnd);

          // 选中区域
          ctx.fillStyle = 'rgba(99, 102, 241, 0.12)';
          ctx.fillRect(sx, 0, ex - sx, height);

          // 结束标记线
          ctx.strokeStyle = '#7C3AED';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, height); ctx.stroke();
          ctx.fillStyle = '#7C3AED';
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          ctx.fillText('OUT', ex + 3, height - 4);

          // 后置静音区域
          if (suffixSec > 0) {
            const ex2 = timeToX(endWithSilence);
            ctx.fillStyle = 'rgba(124, 58, 237, 0.15)';
            ctx.fillRect(ex, 0, ex2 - ex, height);
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = 'rgba(124, 58, 237, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(ex2, 0); ctx.lineTo(ex2, height); ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }, [getScrollContainer]);

    // 初始化 WaveSurfer
    useEffect(() => {
      if (!containerRef.current) return;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#94A3B8',
        progressColor: '#3B82F6',
        cursorColor: '#EF4444',
        cursorWidth: 2,
        height: 160,
        normalize: true,
        minPxPerSec: 100,
        fillParent: true,
        interact: true,
        autoCenter: true,
      });

      wavesurferRef.current = ws;
      ws.load(audioUrl);

      ws.on('ready', () => {
        const dur = ws.getDuration();
        durationRef.current = dur;
        setDuration(dur);
        setIsReady(true);
        onReady?.(dur);
        setTimeout(drawOverlay, 150);
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));
      ws.on('finish', () => setIsPlaying(false));

      ws.on('timeupdate', (time) => {
        setCurrentTime(time);
        // 区间播放到结束时间时自动停止
        if (playRangeEndRef.current !== null && time >= playRangeEndRef.current) {
          const endTime = playRangeEndRef.current;
          playRangeEndRef.current = null;
          if (playRangeTimerRef.current) { clearTimeout(playRangeTimerRef.current); playRangeTimerRef.current = null; }
          ws.pause();
          if (durationRef.current > 0) ws.seekTo(endTime / durationRef.current);
        }
      });

      ws.on('redraw', () => { setTimeout(drawOverlay, 50); });
      ws.on('scroll', () => { setTimeout(drawOverlay, 30); });

      return () => {
        try { ws.unAll(); ws.destroy(); } catch (e) { /* AbortError 正常忽略 */ }
        if (playRangeTimerRef.current) clearTimeout(playRangeTimerRef.current);
        wavesurferRef.current = null;
        setIsReady(false); setIsPlaying(false); setCurrentTime(0); setDuration(0);
        durationRef.current = 0; playRangeEndRef.current = null;
      };
    }, [audioUrl]);

    // 重绘 overlay（当依赖变化时）
    useEffect(() => {
      if (isReady) drawOverlay();
    }, [segments, markedStart, markedEnd, silencePrefixMs, silenceSuffixMs, selectedSegmentId, isReady, drawOverlay]);

    // 监听窗口大小变化
    useEffect(() => {
      const handleResize = () => { if (isReady) setTimeout(drawOverlay, 100); };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [isReady, drawOverlay]);

    // 鼠标事件处理
    useEffect(() => {
      const container = containerRef.current;
      if (!container || !isReady) return;

      const getTimeFromEvent = (e: MouseEvent): number => {
        const rect = container.getBoundingClientRect();
        const ws = wavesurferRef.current;
        if (!ws) return 0;
        const scrollContainer = getScrollContainer() || container;
        const scrollLeft = scrollContainer.scrollLeft || 0;
        const scrollWidth = scrollContainer.scrollWidth || rect.width;
        const clickX = e.clientX - rect.left + scrollLeft;
        const pct = Math.max(0, Math.min(1, clickX / scrollWidth));
        return pct * durationRef.current;
      };

      const handleMouseDown = (e: MouseEvent) => {
        if (e.button === 0) {
          const time = getTimeFromEvent(e);
          onMarkStart?.(time);
          // 左键标记 IN 后，自动从该位置开始播放
          const ws = wavesurferRef.current;
          if (ws && durationRef.current > 0) {
            if (playRangeTimerRef.current) { clearTimeout(playRangeTimerRef.current); playRangeTimerRef.current = null; }
            playRangeEndRef.current = null;
            ws.seekTo(time / durationRef.current);
            ws.play();
          }
        }
      };

      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const time = getTimeFromEvent(e);
        onMarkEnd?.(time);
        // 右键标记 OUT 后：播放 IN→OUT 区间预览（含首尾静音）
        const ws = wavesurferRef.current;
        if (ws && durationRef.current > 0) {
          const startTime = markedStartRef.current;
          const prefixSec = silencePrefixRef.current / 1000;
          const suffixSec = silenceSuffixRef.current / 1000;
          if (startTime !== null && time > startTime) {
            const playStart = Math.max(0, startTime - prefixSec);
            const playEnd = Math.min(durationRef.current, time + suffixSec);
            if (playRangeTimerRef.current) { clearTimeout(playRangeTimerRef.current); playRangeTimerRef.current = null; }
            playRangeEndRef.current = playEnd;
            ws.seekTo(playStart / durationRef.current);
            ws.play();
            const durationMs = (playEnd - playStart) * 1000;
            playRangeTimerRef.current = setTimeout(() => {
              if (wavesurferRef.current) {
                wavesurferRef.current.pause();
                if (durationRef.current > 0) wavesurferRef.current.seekTo(playStart / durationRef.current);
              }
              playRangeEndRef.current = null;
            }, durationMs + 80);
          } else {
            if (playRangeTimerRef.current) { clearTimeout(playRangeTimerRef.current); playRangeTimerRef.current = null; }
            playRangeEndRef.current = null;
            ws.seekTo(time / durationRef.current);
            ws.play();
          }
        }
      };

      container.addEventListener('mousedown', handleMouseDown);
      container.addEventListener('contextmenu', handleContextMenu);
      return () => {
        container.removeEventListener('mousedown', handleMouseDown);
        container.removeEventListener('contextmenu', handleContextMenu);
      };
    }, [isReady, onMarkStart, onMarkEnd, getScrollContainer]);

    // 空格键确认
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && e.target === document.body) {
          e.preventDefault();
          onConfirm?.();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onConfirm]);

    // 缩放
    useEffect(() => {
      if (wavesurferRef.current && isReady) {
        wavesurferRef.current.zoom(zoom * 100);
        // 等待 WaveSurfer 重绘完成后再重绘 overlay（缩放后 scrollWidth 变化）
        setTimeout(drawOverlay, 200);
      }
    }, [zoom, isReady, drawOverlay]);

    // 音量
    useEffect(() => {
      if (wavesurferRef.current) wavesurferRef.current.setVolume(volume);
    }, [volume]);

    const formatTime = (t: number) => {
      const m = Math.floor(t / 60);
      const s = (t % 60).toFixed(3);
      return `${m}:${s.padStart(6, '0')}`;
    };

    const togglePlay = () => { wavesurferRef.current?.playPause(); };
    const handleReset = () => { wavesurferRef.current?.seekTo(0); };

    return (
      <div className="flex flex-col gap-2">
        {/* 波形容器 */}
        <div
          className="relative rounded-lg overflow-hidden bg-slate-900 border border-slate-700"
          style={{ height: 160 }}
        >
          <div
            ref={containerRef}
            className="w-full h-full"
            style={{ cursor: 'crosshair' }}
          />
          {/* Overlay canvas：absolute top-0 left-0，宽度由 JS 控制，translateX 跟随滚动 */}
          <canvas
            ref={overlayRef}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ height: '100%' }}
          />
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                加载波形中...
              </div>
            </div>
          )}
        </div>

        {/* 控制栏 */}
        <div className="flex items-center gap-3 px-1">
          <Button size="sm" variant="outline" onClick={handleReset} className="h-8 w-8 p-0" title="回到开头">
            <SkipBack className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" onClick={togglePlay} className="h-8 w-8 p-0" disabled={!isReady} title="播放/暂停">
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </Button>

          {/* 时间显示 */}
          <div className="text-xs font-mono text-slate-500 tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="flex-1" />

          {/* 音量 */}
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-slate-500" />
            <Slider
              value={[volume]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={([v]) => setVolume(v)}
              className="w-20"
            />
          </div>

          {/* 缩放 */}
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.5))} className="h-7 w-7 p-0" title="缩小">
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-slate-500 w-10 text-center font-mono">{zoom.toFixed(1)}x</span>
            <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(20, z + 0.5))} className="h-7 w-7 p-0" title="放大">
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* 标记状态提示 */}
        <div className="flex items-center gap-4 px-1 text-xs text-slate-500">
          <span>
            <span className="font-mono text-indigo-600">IN</span>
            {markedStart !== null ? `: ${markedStart.toFixed(3)}s` : ': 未标记 (左键)'}
          </span>
          <span>
            <span className="font-mono text-violet-600">OUT</span>
            {markedEnd !== null ? `: ${markedEnd.toFixed(3)}s` : ': 未标记 (右键)'}
          </span>
          {markedStart !== null && markedEnd !== null && (
            <span className="text-green-600 font-medium">
              时长: {(markedEnd - markedStart).toFixed(3)}s → 按空格确认
            </span>
          )}
        </div>
      </div>
    );
  }
);

WaveformEditor.displayName = 'WaveformEditor';
export default WaveformEditor;
