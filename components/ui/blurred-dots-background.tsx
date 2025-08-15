"use client";
import { useEffect, useRef } from "react";

const DOTS = [
  { x: 10, y: 20, size: 80, color: "#FFB4A2", blur: 32, opacity: 0.5 },
  { x: 60, y: 10, size: 100, color: "#B4C5FF", blur: 40, opacity: 0.4 },
  { x: 80, y: 60, size: 120, color: "#FFD6A5", blur: 48, opacity: 0.45 },
  { x: 30, y: 70, size: 90, color: "#B5F7CC", blur: 36, opacity: 0.5 },
  { x: 75, y: 80, size: 70, color: "#D0B4FF", blur: 28, opacity: 0.4 },
];

export function BlurredDotsBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!ref.current) return;
      if (typeof window === 'undefined') return;
      const { innerWidth, innerHeight } = window;
      const x = (e.clientX / innerWidth - 0.5) * 2; // -1 to 1
      const y = (e.clientY / innerHeight - 0.5) * 2; // -1 to 1
      ref.current.style.setProperty("--parallax-x", `${x * 30}px`);
      ref.current.style.setProperty("--parallax-y", `${y * 30}px`);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener("mousemove", handleMouseMove);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener("mousemove", handleMouseMove);
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{
        transform: "translate(var(--parallax-x, 0px), var(--parallax-y, 0px))",
        transition: "transform 0.2s cubic-bezier(.4,0,.2,1)",
      }}
    >
      {DOTS.map((dot, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${dot.x}%`,
            top: `${dot.y}%`,
            width: dot.size,
            height: dot.size,
            background: dot.color,
            opacity: dot.opacity,
            borderRadius: "50%",
            filter: `blur(${dot.blur}px)`,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  );
} 