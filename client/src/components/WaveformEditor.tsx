/**
 * WaveformEditor - 核心波形编辑组件
 *
 * 关键修复 v3：
 * overlay canvas 直接插入 WaveSurfer Shadow DOM 的 .wrapper 元素内
 * wrapper 宽度 = 波形总宽度（随缩放变化），canvas 随波形一起滚动
 * 无需任何 translateX 技巧，片段标记始终与波形精确对齐
 */

import React, {
  useEffect, useRef, useState, useCallback,
  forwardRef, useImperativeHandle,
} from 'react';
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
  'rgba(59, 130, 246, 0.8)',
  'rgba(16, 185, 129, 0.8)',
  'rgba(245, 158, 11, 0.8)',
  'rgba(239, 68, 68, 0.8)',
  'rgba(139, 92, 246, 0.8)',
  'rgba(236, 72, 153, 0.8)',
  'rgba(20, 184, 166, 0.8)',
  'rgba(249, 115, 22, 0.8)',
];

export function getSegmentColor(index: number) {
  return {
    bg: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
    border: SEGMENT_BORDER_COLORS[index % SEGMENT_BORDER_COLORS.length],
  };
}

const WaveformEditor = forwardRef<WaveformEditorHandle, WaveformEditorProps>(
  ({
    audioUrl, segments, silencePrefixMs, silenceSuffixMs,
    selectedSegmentId, onReady, onMarkStart, onMarkEnd,
    onConfirm, markedStart, markedEnd,
  }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // overlay canvas 将被动态插入 Shadow DOM，不再用 React ref 挂载
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
    const playRangeEndRef = useRef<number | null>(null);
    const playRangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { segmentsRef.current = segments; }, [segments]);
    useEffect(() => { markedStartRef.current = markedStart; }, [markedStart]);
    useEffect(() => { markedEndRef.current = markedEnd; }, [markedEnd]);
    useEffect(() => { silencePrefixRef.current = silencePrefixMs; }, [silencePrefixMs]);
    useEffect(() => { silenceSuffixRef.current = silenceSuffixMs; }, [silenceSuffixMs]);
    useEffect(() => { selectedSegmentIdRef.current = selectedSegmentId; }, [selectedSegmentId]);

    // ---- playRange（供外部调用，点击片段时播放区间）----
    const playRange = useCallback((start: number, end: number) => {
      const ws = wavesurferRef.current;
      if (!ws || durationRef.current === 0) return;
      if (playRangeTimerRef.current) clearTimeout(playRangeTimerRef.current);
      playRangeEndRef.current = end;
      ws.seekTo(start / durationRef.current);
      ws.play();
      const ms = (end - start) * 1000;
      playRangeTimerRef.current = setTimeout(() => {
        if (wavesurferRef.current) {
          wavesurferRef.current.pause();
          if (durationRef.current > 0) wavesurferRef.current.seekTo(start / durationRef.current);
        }
        playRangeEndRef.current = null;
      }, ms + 80);
    }, []);

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (wavesurferRef.current && durationRef.current > 0)
          wavesurferRef.current.seekTo(time / durationRef.current);
      },
      getWaveSurfer: () => wavesurferRef.current,
      playRange,
    }));

    // ---- 绘制 overlay ----
    // canvas 已在 wrapper 内，宽度 = wrapper.clientWidth（即波形总宽度）
    // 高度 = wrapper.clientHeight，坐标直接用 timeToX 映射，无需任何偏移
    const drawOverlay = useCallback(() => {
      const canvas = overlayCanvasRef.current;
      if (!canvas || durationRef.current === 0) return;

      const wrapper = canvas.parentElement;
      if (!wrapper) return;

      const totalWidth = wrapper.clientWidth;
      const totalHeight = wrapper.clientHeight;
      if (totalWidth === 0 || totalHeight === 0) return;

      canvas.width = totalWidth;
      canvas.height = totalHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, totalWidth, totalHeight);

      const dur = durationRef.current;
      const timeToX = (t: number) => (t / dur) * totalWidth;

      // 绘制已保存的片段
      segmentsRef.current.forEach((seg, idx) => {
        const x1 = timeToX(seg.startTime);
        const x2 = timeToX(seg.endTime);
        const colors = getSegmentColor(idx);
        const isSelected = seg.id === selectedSegmentIdRef.current;

        ctx.fillStyle = isSelected ? colors.bg.replace('0.25', '0.45') : colors.bg;
        ctx.fillRect(x1, 0, x2 - x1, totalHeight);
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.strokeRect(x1, 0, x2 - x1, totalHeight);
        ctx.fillStyle = colors.border.replace('0.8', '1');
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.fillText(`${idx + 1}`, x1 + 4, 15);
      });

      // 绘制当前标记区域（含首尾静音）
      const prefixSec = silencePrefixRef.current / 1000;
      const suffixSec = silenceSuffixRef.current / 1000;

      if (markedStartRef.current !== null) {
        const rawStart = markedStartRef.current;
        const startWithSilence = Math.max(0, rawStart - prefixSec);
        const endWithSilence = markedEndRef.current !== null
          ? Math.min(dur, markedEndRef.current + suffixSec) : null;

        // 前置静音区域
        if (prefixSec > 0) {
          const sx1 = timeToX(startWithSilence);
          const sx2 = timeToX(rawStart);
          ctx.fillStyle = 'rgba(99, 102, 241, 0.18)';
          ctx.fillRect(sx1, 0, sx2 - sx1, totalHeight);
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(sx1, 0); ctx.lineTo(sx1, totalHeight); ctx.stroke();
          ctx.setLineDash([]);
        }

        // IN 标记线
        const sx = timeToX(rawStart);
        ctx.strokeStyle = '#4F46E5';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, totalHeight); ctx.stroke();
        ctx.fillStyle = '#4F46E5';
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        ctx.fillText('IN', sx + 3, totalHeight - 5);

        if (markedEndRef.current !== null && endWithSilence !== null) {
          const rawEnd = markedEndRef.current;
          const ex = timeToX(rawEnd);

          // 选中区域
          ctx.fillStyle = 'rgba(99, 102, 241, 0.12)';
          ctx.fillRect(sx, 0, ex - sx, totalHeight);

          // OUT 标记线
          ctx.strokeStyle = '#7C3AED';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, totalHeight); ctx.stroke();
          ctx.fillStyle = '#7C3AED';
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          ctx.fillText('OUT', ex + 3, totalHeight - 5);

          // 后置静音区域
          if (suffixSec > 0) {
            const ex2 = timeToX(endWithSilence);
            ctx.fillStyle = 'rgba(124, 58, 237, 0.18)';
            ctx.fillRect(ex, 0, ex2 - ex, totalHeight);
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = 'rgba(124, 58, 237, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(ex2, 0); ctx.lineTo(ex2, totalHeight); ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }, []);

    // ---- 初始化 WaveSurfer ----
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

        // 将 overlay canvas 插入 Shadow DOM 的 wrapper 元素
        // wrapper 的宽度 = 波形总宽度，canvas 随波形一起滚动，无需任何偏移
        const wrapper = ws.getWrapper();
        if (wrapper) {
          // 移除旧 canvas（如果有）
          const old = wrapper.querySelector('.overlay-canvas');
          if (old) old.remove();

          const canvas = document.createElement('canvas');
          canvas.className = 'overlay-canvas';
          canvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
          `;
          wrapper.appendChild(canvas);
          overlayCanvasRef.current = canvas;
          setTimeout(drawOverlay, 100);
        }
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
        try { ws.unAll(); ws.destroy(); } catch (_) { /* AbortError 正常忽略 */ }
        if (playRangeTimerRef.current) clearTimeout(playRangeTimerRef.current);
        overlayCanvasRef.current = null;
        wavesurferRef.current = null;
        setIsReady(false); setIsPlaying(false); setCurrentTime(0); setDuration(0);
        durationRef.current = 0; playRangeEndRef.current = null;
      };
    }, [audioUrl]);

    // ---- 鼠标事件处理（在 ready 后挂载到 Shadow DOM wrapper）----
    // 左键：用 WaveSurfer 的 interaction 事件（内部已正确计算时间）
    // 右键：在 wrapper 上监听 contextmenu，用 wrapper.getBoundingClientRect() 计算（与WaveSurfer内部算法一致）
    useEffect(() => {
      if (!isReady) return;
      const ws = wavesurferRef.current;
      if (!ws) return;

      // 左键：WaveSurfer interaction 事件已经给出精确时间
      const unsubInteraction = ws.on('interaction', (time: number) => {
        onMarkStart?.(time);
        // 从该位置开始播放
        if (playRangeTimerRef.current) { clearTimeout(playRangeTimerRef.current); playRangeTimerRef.current = null; }
        playRangeEndRef.current = null;
        ws.seekTo(time / durationRef.current);
        ws.play();
      });

      // 右键：在 Shadow DOM wrapper 上监听 contextmenu
      const wrapper = ws.getWrapper();
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (durationRef.current === 0) return;
        // 与 WaveSurfer 内部完全相同的计算方式：用 wrapper.getBoundingClientRect()
        const rect = wrapper.getBoundingClientRect();
        const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = relX * durationRef.current;
        onMarkEnd?.(time);
        // 右键标记 OUT 后：播放 IN→OUT 区间预览（含首尾静音）
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
          const ms = (playEnd - playStart) * 1000;
          playRangeTimerRef.current = setTimeout(() => {
            if (wavesurferRef.current) {
              wavesurferRef.current.pause();
              if (durationRef.current > 0) wavesurferRef.current.seekTo(playStart / durationRef.current);
            }
            playRangeEndRef.current = null;
          }, ms + 80);
        } else {
          if (playRangeTimerRef.current) { clearTimeout(playRangeTimerRef.current); playRangeTimerRef.current = null; }
          playRangeEndRef.current = null;
          ws.seekTo(time / durationRef.current);
          ws.play();
        }
      };

      if (wrapper) wrapper.addEventListener('contextmenu', handleContextMenu);

      return () => {
        unsubInteraction();
        if (wrapper) wrapper.removeEventListener('contextmenu', handleContextMenu);
      };
    }, [isReady, onMarkStart, onMarkEnd]);

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
        // 等待 WaveSurfer 重绘完成后再重绘 overlay（wrapper 宽度已变化）
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
          <Button size="sm" variant="outline"
            onClick={() => wavesurferRef.current?.seekTo(0)}
            className="h-8 w-8 p-0" title="回到开头">
            <SkipBack className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm"
            onClick={() => wavesurferRef.current?.playPause()}
            className="h-8 w-8 p-0" disabled={!isReady} title="播放/暂停">
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </Button>

          <div className="text-xs font-mono text-slate-500 tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="flex-1" />

          {/* 音量 */}
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-slate-500" />
            <Slider
              value={[volume]} min={0} max={1} step={0.05}
              onValueChange={([v]) => setVolume(v)}
              className="w-20"
            />
          </div>

          {/* 缩放 */}
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.5))}
              className="h-7 w-7 p-0" title="缩小">
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-slate-500 w-10 text-center font-mono">{zoom.toFixed(1)}x</span>
            <Button size="sm" variant="ghost"
              onClick={() => setZoom((z) => Math.min(20, z + 0.5))}
              className="h-7 w-7 p-0" title="放大">
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
