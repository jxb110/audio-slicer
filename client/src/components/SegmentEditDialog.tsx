/**
 * SegmentEditDialog - 片段编辑对话框
 * 支持调整开始/结束时间（含首尾静音）
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AudioSegment } from '@/lib/audioExport';

interface SegmentEditDialogProps {
  open: boolean;
  segment: AudioSegment | null;
  duration: number;
  silencePrefixMs: number;
  silenceSuffixMs: number;
  onClose: () => void;
  onSave: (updated: AudioSegment) => void;
}

export default function SegmentEditDialog({
  open,
  segment,
  duration,
  silencePrefixMs,
  silenceSuffixMs,
  onClose,
  onSave,
}: SegmentEditDialogProps) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (segment) {
      setStartTime(segment.startTime.toFixed(3));
      setEndTime(segment.endTime.toFixed(3));
      setLabel(segment.label || '');
    }
  }, [segment]);

  const handleSave = () => {
    if (!segment) return;
    const start = parseFloat(startTime);
    const end = parseFloat(endTime);
    if (isNaN(start) || isNaN(end) || start >= end || start < 0 || end > duration) return;
    onSave({ ...segment, startTime: start, endTime: end, label: label || undefined });
    onClose();
  };

  const prefixSec = silencePrefixMs / 1000;
  const suffixSec = silenceSuffixMs / 1000;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>编辑片段</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">开始时间 (秒)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                max={duration}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="font-mono text-sm"
              />
              {prefixSec > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  含前置静音: {Math.max(0, parseFloat(startTime) - prefixSec).toFixed(3)}s
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">结束时间 (秒)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                max={duration}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="font-mono text-sm"
              />
              {suffixSec > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  含后置静音: {Math.min(duration, parseFloat(endTime) + suffixSec).toFixed(3)}s
                </p>
              )}
            </div>
          </div>

          {/* 时长显示 */}
          {!isNaN(parseFloat(startTime)) && !isNaN(parseFloat(endTime)) && (
            <div className="text-xs text-slate-500 bg-slate-50 rounded px-3 py-2 font-mono">
              时长: {(parseFloat(endTime) - parseFloat(startTime)).toFixed(3)}s
            </div>
          )}

          <div>
            <Label className="text-xs text-slate-600 mb-1 block">标签（可选）</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="为此片段添加标签..."
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
