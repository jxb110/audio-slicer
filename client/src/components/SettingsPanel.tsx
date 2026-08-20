/**
 * SettingsPanel - 全局设置面板
 * 配置首尾静音时长和 VAD 参数
 */

import React from 'react';
import { Settings, Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppSettings } from '@/lib/persistenceTypes';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const update = (key: keyof AppSettings, value: number) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="space-y-5">
      {/* 首尾静音 */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Settings className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">首尾静音</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-slate-600 mb-1.5 block">
              前置静音 (ms)
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 inline ml-1 text-slate-400 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[200px]">
                  在每个片段开始前自动添加的静音时长
                </TooltipContent>
              </Tooltip>
            </Label>
            <Input
              type="number"
              min="0"
              max="2000"
              step="50"
              value={settings.silencePrefixMs}
              onChange={(e) => update('silencePrefixMs', parseInt(e.target.value) || 0)}
              className="font-mono text-sm h-8"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600 mb-1.5 block">
              后置静音 (ms)
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 inline ml-1 text-slate-400 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[200px]">
                  在每个片段结束后自动添加的静音时长
                </TooltipContent>
              </Tooltip>
            </Label>
            <Input
              type="number"
              min="0"
              max="2000"
              step="50"
              value={settings.silenceSuffixMs}
              onChange={(e) => update('silenceSuffixMs', parseInt(e.target.value) || 0)}
              className="font-mono text-sm h-8"
            />
          </div>
        </div>
      </div>

      {/* VAD 参数 */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Settings className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">VAD 参数</span>
        </div>
        <div className="space-y-3">
          {/* 能量阈值 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-slate-600">
                灵敏度
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 inline ml-1 text-slate-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                    越高越灵敏（检测更多语音），越低越保守（只检测明显语音）
                  </TooltipContent>
                </Tooltip>
              </Label>
              <span className="text-xs font-mono text-slate-500">
                {(1 - settings.vadEnergyThreshold / 0.1).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[1 - settings.vadEnergyThreshold / 0.1]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={([v]) => update('vadEnergyThreshold', (1 - v) * 0.1)}
              className="w-full"
            />
          </div>

          {/* 最大静音间隔 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-slate-600">
                最大静音间隔 (s)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 inline ml-1 text-slate-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                    超过此时长的静音将分割为不同片段
                  </TooltipContent>
                </Tooltip>
              </Label>
              <span className="text-xs font-mono text-slate-500">
                {settings.vadMaxSilenceDuration.toFixed(1)}s
              </span>
            </div>
            <Slider
              value={[settings.vadMaxSilenceDuration]}
              min={0.1}
              max={3}
              step={0.1}
              onValueChange={([v]) => update('vadMaxSilenceDuration', v)}
              className="w-full"
            />
          </div>

          {/* 最小语音时长 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-slate-600">
                最小语音时长 (s)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 inline ml-1 text-slate-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                    短于此时长的语音段将被过滤掉
                  </TooltipContent>
                </Tooltip>
              </Label>
              <span className="text-xs font-mono text-slate-500">
                {settings.vadMinSpeechDuration.toFixed(2)}s
              </span>
            </div>
            <Slider
              value={[settings.vadMinSpeechDuration]}
              min={0.05}
              max={1}
              step={0.05}
              onValueChange={([v]) => update('vadMinSpeechDuration', v)}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
