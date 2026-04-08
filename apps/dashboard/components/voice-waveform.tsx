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
  barGap = 2,
  barColor = '#000000',
  fadeEdges = true,
  fadeWidth = 24,
  sensitivity = 2.6,
  smoothingTimeConstant = 0.65,
  fftSize = 512,
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationRef = useRef<number>(0);
  const cachedRectRef = useRef({ width: 0, height: 0 });

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
      const centerX = width / 2;

      // Only draw bars in the center portion of the canvas
      const maxVisualizerWidth = Math.min(width, 280);
      const visualizerBarCount = Math.floor(maxVisualizerWidth / step);
      const halfCount = Math.floor(visualizerBarCount / 2);
      const offsetX = centerX - (visualizerBarCount * step) / 2;

      ctx.clearRect(0, 0, width, height);

      if (isActive && analyserRef.current) {
        // Real-time frequency data from mic
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Focus on the voice band but include enough high range for sibilants.
        const startFreq = Math.floor(dataArray.length * 0.03);
        const endFreq = Math.floor(dataArray.length * 0.6);
        const relevantData = dataArray.slice(startFreq, endFreq);

        // Overall energy across the whole voice band — drives every bar so the
        // edges respond too, not just the center.
        let sum = 0;
        for (let i = 0; i < relevantData.length; i++) sum += relevantData[i];
        const overall = (sum / relevantData.length) / 255;

        const t = performance.now() / 1000;

        for (let i = 0; i < visualizerBarCount; i++) {
          // Per-bar frequency sample, distributed across the band.
          const freqPos = i / Math.max(1, visualizerBarCount - 1);
          const dataIndex = Math.floor(freqPos * (relevantData.length - 1));
          const localRaw = relevantData[dataIndex] / 255;
          // High-frequency EQ boost compensates for voice spectrum roll-off so
          // bars on the right (sibilants) react too.
          const eqBoost = 1 + freqPos * 1.6;
          const local = Math.min(1, localRaw * eqBoost);

          // Per-bar wobble keyed off overall energy so silent bars stay quiet
          // but every bar moves while speaking.
          const wobble = (Math.sin(t * 6 + i * 0.55) * 0.5 + 0.5) * overall * 0.55;

          // Symmetric center-bias envelope so the visualizer still has a shape.
          const distFromCenter = Math.abs(i - halfCount) / halfCount;
          const envelope = 1 - distFromCenter * 0.35;

          const mixed = (overall * 0.45 + local * 0.55 + wobble) * envelope;
          const value = Math.min(1, mixed * sensitivity);

          // Hard silence gate: below this, draw nothing so quiet moments are
          // truly blank instead of a persistent row of tiny bars.
          if (value < 0.2) continue;

          const x = offsetX + i * step;
          const barHeight = Math.max(3, value * height * 0.82);
          const y = centerY - barHeight / 2;

          ctx.fillStyle = barColor;
          ctx.globalAlpha = 0.55 + value * 0.45;
          ctx.fillRect(x, y, barWidth, barHeight);
        }
      }
      // No idle fallback — when inactive or no analyser, leave the canvas
      // blank so we never flash a fake waveform while recognition finalizes.

      // Edge fading on the visualizer region
      if (fadeEdges && fadeWidth > 0 && maxVisualizerWidth > 0) {
        const fadeGradient = ctx.createLinearGradient(offsetX, 0, offsetX + visualizerBarCount * step, 0);
        const fadePct = Math.min(0.15, fadeWidth / maxVisualizerWidth);

        fadeGradient.addColorStop(0, 'rgba(255,255,255,1)');
        fadeGradient.addColorStop(fadePct, 'rgba(255,255,255,0)');
        fadeGradient.addColorStop(1 - fadePct, 'rgba(255,255,255,0)');
        fadeGradient.addColorStop(1, 'rgba(255,255,255,1)');

        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = fadeGradient;
        ctx.fillRect(offsetX, 0, visualizerBarCount * step, height);
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
      className={cn("relative", className)}
      style={{ height: '100%', width: '100%', maxWidth: '100%' }}
      aria-label={isActive ? 'Live voice waveform' : 'Voice waveform idle'}
      role="img"
    >
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
