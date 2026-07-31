/**
 * SegmentList - 片段列表组件
 * 显示所有切分片段，支持点击聚焦、删除、编辑
 */

import React, { useState } from 'react';
import { Trash2, Edit2, CheckCircle, Cpu, User, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AudioSegment, WavInfo, downloadSegment, audioBufferToWavFallbackExport } from '@/lib/audioExport';
import { getSegmentColor } from './WaveformEditor';
import { toast } from 'sonner';

interface SegmentListProps {
  segments: AudioSegment[];
  selectedSegmentId: string | null;
  audioBuffer: AudioBuffer | null;
  rawArrayBuffer?: ArrayBuffer | null;
  wavInfo?: WavInfo | null;
  audioFileName: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (segment: AudioSegment) => void;
}

function formatTime(t: number): string {
  return t.toFixed(3);
}

export default function SegmentList({
  segments,
  selectedSegmentId,
  audioBuffer,
  rawArrayBuffer,
  wavInfo,
  audioFileName,
  onSelect,
  onDelete,
  onEdit,
}: SegmentListProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (e: React.MouseEvent, seg: AudioSegment, idx: number) => {
    e.stopPropagation();
    if ((!rawArrayBuffer && !audioBuffer) || downloadingId) return;
    setDownloadingId(seg.id);
    try {
      const baseName = audioFileName.replace(/\.[^/.]+$/, '');
      const label = seg.label || '';
      const fileName = label
        ? `${baseName}_${label}_${String(idx + 1).padStart(3, '0')}.wav`
        : `${baseName}__${String(idx + 1).padStart(3, '0')}.wav`;
      if (rawArrayBuffer && wavInfo) {
        await downloadSegment(rawArrayBuffer, wavInfo, seg, fileName);
      } else if (audioBuffer) {
        // 兜底：非WAV格式用AudioBuffer导出
        await audioBufferToWavFallbackExport(audioBuffer, seg, fileName);
      }
      toast.success(`片段 ${idx + 1} 已下载`);
    } catch (err) {
      toast.error('下载失败: ' + (err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  };

  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-400 text-sm gap-2">
        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
          <CheckCircle className="w-5 h-5 text-slate-300" />
        </div>
        <p>暂无片段</p>
        <p className="text-xs text-slate-300">左键标记开始，右键标记结束，空格确认</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {segments.map((seg, idx) => {
        const colors = getSegmentColor(idx);
        const isSelected = seg.id === selectedSegmentId;
        const duration = seg.endTime - seg.startTime;

        return (
          <div
            key={seg.id}
            onClick={() => onSelect(seg.id)}
            className={`group relative rounded-lg border transition-all cursor-pointer ${
              isSelected
                ? 'border-blue-400 bg-blue-50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            }`}
            style={{
              borderLeftWidth: 3,
              borderLeftColor: colors.border,
            }}
          >
            <div className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {/* 序号 */}
                  <span
                    className="text-xs font-mono font-bold flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-white"
                    style={{ backgroundColor: colors.border }}
                  >
                    {idx + 1}
                  </span>

                  {/* 时间信息 */}
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-slate-700">
                      {formatTime(seg.startTime)}s → {formatTime(seg.endTime)}s
                    </div>
                    <div className="text-xs text-slate-500">
                      时长: <span className="font-mono font-medium text-slate-700">{formatTime(duration)}s</span>
                    </div>
                  </div>
                </div>

                {/* 来源标签 */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {seg.source === 'vad' ? (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-purple-100 text-purple-700 border-purple-200">
                      <Cpu className="w-2.5 h-2.5 mr-1" />
                      VAD
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-blue-100 text-blue-700 border-blue-200">
                      <User className="w-2.5 h-2.5 mr-1" />
                      手动
                    </Badge>
                  )}
                </div>
              </div>

              {/* 标签 */}
              {seg.label && (
                <div className="mt-1 text-xs text-slate-500 truncate">{seg.label}</div>
              )}
            </div>

            {/* 操作按钮（hover 显示） */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-md px-1 py-0.5 shadow-sm border border-slate-200">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onEdit(seg); }}
                className="h-6 w-6 p-0 text-slate-500 hover:text-blue-600"
                title="编辑"
              >
                <Edit2 className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => handleDownload(e, seg, idx)}
                className="h-6 w-6 p-0 text-slate-500 hover:text-green-600"
                title="下载此片段"
                disabled={!audioBuffer || downloadingId === seg.id}
              >
                {downloadingId === seg.id ? (
                  <div className="w-3 h-3 border border-green-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onDelete(seg.id); }}
                className="h-6 w-6 p-0 text-slate-500 hover:text-red-600"
                title="删除"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
