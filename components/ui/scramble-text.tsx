"use client"

import { useEffect, useState, useRef } from "react"
import { useScramble } from "use-scramble"

interface ScrambleTextProps {
  text: string
  alternateText?: string
  className?: string
  // Parameters from use-scramble docs
  speed?: number        // (0-1) Controls animation framerate
  tick?: number         // (1-∞) Controls internal clock 
  step?: number         // (1-∞) Controls how many positions to animate at once
  scramble?: number     // (0-∞) How many times to randomize before final character
  seed?: number         // (0-∞) Creates more erratic animation
  chance?: number       // (0-1) Probability of character randomization
  overflow?: boolean    // Animation flows over previous text and replaces it
  range?: [number, number] // Unicode codepoint range for scrambling
  overdrive?: boolean | number // Animation flows across text replacing with underscores or custom character
  playOnMount?: boolean // Whether to play animation immediately on mount
  ignore?: string[]     // Characters to not randomize (like spaces)
  onAnimationStart?: () => void
  onAnimationFrame?: (result: string) => void
  onAnimationEnd?: () => void
  // Timing parameters
  initialDelay?: number  // Delay before first text switch (ms)
  switchInterval?: number // Interval between text switches (ms)
  pauseBeforeScramble?: number // Pause before scrambling starts (ms)
}

export function ScrambleText({ 
  text,
  alternateText,
  className = "",
  speed = 0.3,
  tick = 5,
  step = 7,
  scramble = 15,
  seed = 5,
  chance = 1,
  overflow = false,
  range = [65, 125],
  overdrive = false,
  playOnMount = true,
  ignore = [" "],
  onAnimationStart,
  onAnimationFrame,
  onAnimationEnd,
  // Default timing values
  initialDelay = 2500,  // 2 seconds before first switch
  switchInterval = 9000, // 5 seconds between switches
  pauseBeforeScramble = 500 // 300ms pause before scrambling starts
}: ScrambleTextProps) {
  const [currentText, setCurrentText] = useState(text);
  const [shouldAnimate, setShouldAnimate] = useState(playOnMount);
  const isInitialMount = useRef(true);
  
  // Get the ref and API from useScramble
  const { ref, replay } = useScramble({
    text: currentText, // Use the managed state instead of static text
    speed,
    tick,
    step,
    scramble,
    seed,
    chance,
    overflow,
    range,
    overdrive,
    // Don't auto-play on mount, we'll control this
    playOnMount: false,
    ignore,
    onAnimationStart,
    onAnimationFrame,
    onAnimationEnd,
  })

  // Animation trigger effect
  useEffect(() => {
    if (shouldAnimate) {
      replay();
      setShouldAnimate(false);
    }
  }, [shouldAnimate, replay]);

  // Initial animation
  useEffect(() => {
    // Skip the initial animation on first mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      
      // For the initial state, start with the first text
      if (playOnMount) {
        setShouldAnimate(true);
      }
    } else {
      // For subsequent text changes, add a delay then play the animation
      const animationTimeout = setTimeout(() => {
        setShouldAnimate(true);
      }, pauseBeforeScramble);
      
      return () => clearTimeout(animationTimeout);
    }
  }, [currentText, playOnMount, pauseBeforeScramble]);

  // Setup alternating text switching
  useEffect(() => {
    if (!alternateText) return;
    
    // Initial effect after specified delay - switch to alternateText
    const initialTimeout = setTimeout(() => {
      setCurrentText(alternateText);
    }, initialDelay);
    
    // Set up interval for alternate switching
    const mainInterval = setInterval(() => {
      setCurrentText(prev => 
        prev === text ? alternateText : text
      );
    }, switchInterval);
    
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(mainInterval);
    };
  }, [text, alternateText, initialDelay, switchInterval]);

  return (
    <span ref={ref} className={className}>
      {currentText}
    </span>
  )
}

