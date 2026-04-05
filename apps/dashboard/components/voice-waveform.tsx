"use client"

import React, { useEffect, useRef, useState } from 'react';
import { cn } from "@/lib/utils";

// ── Canvas-based waveform (Midday-style) ──────────────────────────

interface VoiceWaveformProps {
  isActive: boolean;
  audioStream?: MediaStream | null;
  className?: string;
  barWidth?: number;
  barGap?: number;
  barColor?: string;
  fadeEdges?: boolean;
  fadeWidth?: number;
  sensitivity?: number;
  smoothingTimeConstant?: number;
  fftSize?: number;
}

export function VoiceWaveform({
  isActive,
  audioStream,
  className,
  barWidth = 3,
  barGap = 1,
  barColor = '#000000',
  fadeEdges = true,
  fadeWidth = 24,
  sensitivity = 1.8,
  smoothingTimeConstant = 0.75,
  fftSize = 256,
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationRef = useRef<number>(0);
  const cachedRectRef = useRef({ width: 0, height: 0 });
  const gradientCacheRef = useRef<CanvasGradient | null>(null);
  const lastWidthRef = useRef(0);

  // Handle canvas resizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);

      cachedRectRef.current = { width: rect.width, height: rect.height };
      gradientCacheRef.current = null;
      lastWidthRef.current = rect.width;
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Setup audio context from mic stream
  useEffect(() => {
    if (!audioStream || !isActive) {
      // Tear down when inactive
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = 0;
      }
      if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      return;
    }

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothingTimeConstant;
    analyserRef.current = analyser;

    const source = audioContext.createMediaStreamSource(audioStream);
    sourceRef.current = source;
    source.connect(analyser);
    // Don't connect to destination — we don't want to play back the mic

    return () => {
      source.disconnect();
      audioContext.close().catch(() => {});
      sourceRef.current = null;
      audioContextRef.current = null;
      analyserRef.current = null;
    };
  }, [audioStream, isActive, fftSize, smoothingTimeConstant]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const step = barWidth + barGap;

    const animate = () => {
      const { width, height } = cachedRectRef.current;
      if (width === 0 || height === 0) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const centerY = height / 2;
      const barCount = Math.floor(width / step);
      const halfCount = Math.floor(barCount / 2);

      ctx.clearRect(0, 0, width, height);

      if (isActive && analyserRef.current) {
        // Real-time frequency data from mic
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Focus on voice frequencies (skip very low and very high)
        const startFreq = Math.floor(dataArray.length * 0.05);
        const endFreq = Math.floor(dataArray.length * 0.5);
        const relevantData = dataArray.slice(startFreq, endFreq);

        // Build symmetric bars: mirror left ← center → right
        const bars: number[] = [];
        for (let i = halfCount - 1; i >= 0; i--) {
          const dataIndex = Math.floor((i / halfCount) * relevantData.length);
          const value = Math.min(1, (relevantData[dataIndex] / 255) * sensitivity);
          bars.push(Math.max(0.05, value));
        }
        for (let i = 0; i < halfCount; i++) {
          const dataIndex = Math.floor((i / halfCount) * relevantData.length);
          const value = Math.min(1, (relevantData[dataIndex] / 255) * sensitivity);
          bars.push(Math.max(0.05, value));
        }

        // Draw active bars
        for (let i = 0; i < barCount && i < bars.length; i++) {
          const value = bars[i];
          const x = i * step;
          const barHeight = Math.max(2, value * height * 0.85);
          const y = centerY - barHeight / 2;

          ctx.fillStyle = barColor;
          ctx.globalAlpha = value > 0.1 ? 0.4 + value * 0.6 : 0.3;
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      } else {
        // Idle state: deterministic voice-like sine pattern (no randomness)
        for (let i = 0; i < barCount; i++) {
          const normalizedPos = Math.abs((i - halfCount) / halfCount);
          const wave1 = Math.sin(normalizedPos * Math.PI * 3) * 0.3;
          const wave2 = Math.sin(normalizedPos * Math.PI * 7) * 0.15;
          const wave3 = Math.cos(normalizedPos * Math.PI * 11) * 0.1;
          const value = Math.max(0.15, 0.3 + wave1 + wave2 + wave3);

          const x = i * step;
          const barHeight = Math.max(2, value * height * 0.6);
          const y = centerY - barHeight / 2;

          ctx.fillStyle = barColor;
          ctx.globalAlpha = 0.3 + value * 0.3;
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      }

      // Edge fading (Midday-style gradient mask)
      if (fadeEdges && fadeWidth > 0 && width > 0) {
        if (!gradientCacheRef.current || lastWidthRef.current !== width) {
          const gradient = ctx.createLinearGradient(0, 0, width, 0);
          const fadePercent = Math.min(0.3, fadeWidth / width);

          gradient.addColorStop(0, 'rgba(255,255,255,1)');
          gradient.addColorStop(fadePercent, 'rgba(255,255,255,0)');
          gradient.addColorStop(1 - fadePercent, 'rgba(255,255,255,0)');
          gradient.addColorStop(1, 'rgba(255,255,255,1)');

          gradientCacheRef.current = gradient;
          lastWidthRef.current = width;
        }

        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = gradientCacheRef.current;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.globalAlpha = 1;
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = 0;
      }
    };
  }, [isActive, barWidth, barGap, barColor, fadeEdges, fadeWidth, sensitivity]);

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full", className)}
      style={{ height: '100%' }}
      aria-label={isActive ? 'Live voice waveform' : 'Voice waveform idle'}
      role="img"
    >
      {!isActive && (
        <div className="absolute top-1/2 right-0 left-0 -translate-y-1/2 border-t border-dotted border-black/15" />
      )}
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

// ── Mini pulsing waveform (for compact button spaces) ─────────────

export function VoiceWaveformMini({ isActive, className }: { isActive: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-[2px]", className)}>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className={cn(
            "w-[2px] rounded-full transition-all duration-200",
            isActive
              ? "bg-black animate-voice-pulse"
              : "bg-gray-600"
          )}
          style={{
            animationDelay: `${index * 100}ms`,
            height: isActive ? undefined : '10px',
          }}
        />
      ))}
    </div>
  );
}
