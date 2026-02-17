"use client"

import React, { useEffect, useRef, useState } from 'react';
import { cn } from "@/lib/utils";

interface VoiceWaveformProps {
  isActive: boolean;
  audioStream?: MediaStream | null;
  className?: string;
}

const IDLE_LEVELS = Array(32).fill(0.25);

export function VoiceWaveform({ isActive, audioStream, className }: VoiceWaveformProps) {
  const [audioLevels, setAudioLevels] = useState<number[]>(IDLE_LEVELS);
  const animationFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!audioStream || !isActive) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    // Set up audio analysis - optimized for INSTANT response
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(audioStream);
    
    analyser.fftSize = 256; // Larger for better waveform representation
    analyser.smoothingTimeConstant = 0.6; // Balanced smoothing
    source.connect(analyser);
    
    analyserRef.current = analyser;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    dataArrayRef.current = dataArray;

    // ULTRA-fast animation loop - direct render, no throttling
    const updateWaveform = () => {
      if (!analyserRef.current || !dataArrayRef.current) return;

      // Use TIME DOMAIN data (actual waveform) instead of frequency data
      // This gives more balanced left-to-right movement
      analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
      
      const barCount = 32;
      const newLevels = [];
      const step = Math.floor(bufferLength / barCount);
      
      for (let i = 0; i < barCount; i++) {
        const start = i * step;
        const end = start + step;
        
        // Calculate RMS (Root Mean Square) for each segment
        let sumSquares = 0;
        for (let j = start; j < end; j++) {
          const normalized = (dataArrayRef.current[j] - 128) / 128; // Convert to -1 to 1
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / step);
        
        // Map RMS to bar height with good visual range
        const height = Math.max(0.2, Math.min(0.95, rms * 3 + 0.2));
        newLevels.push(height);
      }
      
      setAudioLevels(newLevels);
      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    };

    animationFrameRef.current = requestAnimationFrame(updateWaveform);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      source.disconnect();
      audioContext.close();
    };
  }, [audioStream, isActive]);

  const displayedLevels = isActive && audioStream ? audioLevels : IDLE_LEVELS;

  return (
    <div className={cn("flex items-center justify-center gap-[3px] h-12", className)}>
      {displayedLevels.map((level, index) => (
        <div
          key={index}
          className={cn(
            "w-[3px] rounded-full bg-black origin-center",
            !isActive && "opacity-40"
          )}
          style={{
            height: '100%',
            transform: `scaleY(${level})`,
            transition: 'none', // No transition = instant response!
          }}
        />
      ))}
    </div>
  );
}

// Simpler pulsing waveform for small spaces (like button)
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
