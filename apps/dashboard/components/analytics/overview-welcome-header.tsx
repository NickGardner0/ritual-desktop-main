'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { useOverviewWidgetMetrics } from '@/hooks/use-overview-widget-metrics';
import {
  buildWelcomeInsights,
  getTimeBasedGreeting,
  WELCOME_TICK_DURATION_MS,
  type WelcomeInsight,
} from '@/components/analytics/overview-welcome';

const linkClass =
  'border-b border-dashed border-[color-mix(in_srgb,var(--text-muted)_32%,transparent)] transition-colors hover:text-[var(--text-primary)]';

function InsightCopy({ insight }: { insight: WelcomeInsight }) {
  return (
    <>
      {insight.before}
      {insight.link ? (
        <Link href={insight.href} className={linkClass}>
          {insight.link}
        </Link>
      ) : null}
      {insight.after}
    </>
  );
}

function SummaryTicker({ insights }: { insights: WelcomeInsight[] }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [fast, setFast] = useState(false);
  const [progress, setProgress] = useState(0);
  const hoveredRef = useRef(false);
  const startRef = useRef(Date.now());
  const elapsedOnPauseRef = useRef(0);
  const reduceMotion = useReducedMotion();

  const goTo = useCallback(
    (nextIndex: number) => {
      const next = nextIndex % insights.length;
      if (next === index) return;
      setFast(true);
      setDirection(next > index ? 1 : -1);
      setIndex(next);
      setProgress(0);
      startRef.current = Date.now();
      elapsedOnPauseRef.current = 0;
    },
    [insights.length, index],
  );

  useEffect(() => {
    if (insights.length <= 1) return;

    let raf = 0;
    const tick = () => {
      if (hoveredRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const elapsed = elapsedOnPauseRef.current + (Date.now() - startRef.current);
      const pct = Math.min(elapsed / WELCOME_TICK_DURATION_MS, 1);
      setProgress(pct);

      if (pct >= 1) {
        setFast(false);
        setDirection(1);
        setIndex((prev) => (prev + 1) % insights.length);
        setProgress(0);
        startRef.current = Date.now();
        elapsedOnPauseRef.current = 0;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [insights.length]);

  const current = insights[index % insights.length];
  if (!current) return null;

  const slideY = (fast ? 8 : 14) * direction;
  const duration = reduceMotion ? 0 : fast ? 0.12 : 0.32;

  if (insights.length <= 1) {
    return (
      <p className="mt-3 max-w-lg text-center text-sm leading-relaxed text-[var(--text-muted)]">
        <InsightCopy insight={current} />
      </p>
    );
  }

  return (
    <div
      className="mt-3 flex w-full max-w-lg flex-col items-center gap-3"
      onMouseEnter={() => {
        hoveredRef.current = true;
        elapsedOnPauseRef.current += Date.now() - startRef.current;
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        startRef.current = Date.now();
      }}
    >
      <div className="relative h-10 w-full overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={current.key}
            className="absolute inset-0 flex items-center justify-center"
            initial={reduceMotion ? { opacity: 0 } : { y: slideY, opacity: 0, filter: 'blur(4px)' }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={reduceMotion ? { opacity: 0 } : { y: -slideY, opacity: 0, filter: 'blur(4px)' }}
            transition={{ duration, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-center text-sm leading-relaxed text-[var(--text-muted)]">
              <InsightCopy insight={current} />
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-1.5">
        {insights.map((insight, insightIndex) => (
          <button
            key={insight.key}
            type="button"
            className="group/bar relative -my-2 cursor-pointer py-2"
            aria-label={insight.link || insight.after || insight.key}
            aria-current={insightIndex === index ? 'true' : undefined}
            onClick={() => goTo(insightIndex)}
            onMouseEnter={() => goTo(insightIndex)}
          >
            <div className="relative h-[2px] w-4 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]">
              <div
                className="absolute inset-0 origin-left rounded-full bg-[color-mix(in_srgb,var(--text-primary)_40%,transparent)] group-hover/bar:!scale-x-100"
                style={{
                  transform: `scaleX(${insightIndex === index ? progress : 0})`,
                }}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OverviewWelcomeGreeting() {
  const { user } = useUser();
  const [greeting, setGreeting] = useState(() => getTimeBasedGreeting());

  useEffect(() => {
    setGreeting(getTimeBasedGreeting());
    const interval = setInterval(() => {
      setGreeting(getTimeBasedGreeting());
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const firstName = user?.firstName || user?.fullName?.split(' ')[0];

  return (
    <h1
      suppressHydrationWarning
      className="ritual-index-greeting text-center text-[38px] font-normal leading-tight tracking-[-0.02em] text-[var(--text-primary)]"
    >
      {greeting}
      {firstName ? (
        <>
          , <span className="text-[var(--text-muted)]">{firstName}</span>
        </>
      ) : null}
    </h1>
  );
}

export function OverviewWelcomeSummary() {
  const metrics = useOverviewWidgetMetrics();
  const insights = useMemo(() => buildWelcomeInsights(metrics), [metrics]);
  return <SummaryTicker insights={insights} />;
}

export function OverviewWelcomeHeader() {
  return (
    <div className="flex w-full flex-col items-center pt-6 pb-10 text-center">
      <OverviewWelcomeGreeting />
      <OverviewWelcomeSummary />
    </div>
  );
}
