/**
 * Performance tracking utility for measuring page and component load times
 */

type PerformanceMetric = {
  name: string;
  value: number;
  startTime?: number;
};

// For type safety with performance entry types
interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface FirstInputDelay extends PerformanceEntry {
  processingStart: number;
  startTime: number;
}

class PerformanceTracker {
  private static instance: PerformanceTracker;
  private metrics: Map<string, PerformanceMetric> = new Map();
  private marks: Set<string> = new Set();
  private enabled: boolean = true;

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  /**
   * Start measuring a performance metric
   */
  public startMeasure(name: string): void {
    if (!this.enabled || typeof window === 'undefined') return;
    
    const markName = `${name}_start`;
    performance.mark(markName);
    this.marks.add(markName);
  }

  /**
   * End measuring a performance metric and record the result
   */
  public endMeasure(name: string, log: boolean = true): number {
    if (!this.enabled || typeof window === 'undefined') return 0;
    
    const startMark = `${name}_start`;
    const endMark = `${name}_end`;
    
    try {
      performance.mark(endMark);
      this.marks.add(endMark);
      
      // Create the measure between start and end marks
      performance.measure(name, startMark, endMark);
      
      // Get the measure and record the value
      const entries = performance.getEntriesByName(name, 'measure');
      const duration = entries.length > 0 ? entries[0].duration : 0;
      
      this.metrics.set(name, {
        name,
        value: duration,
        startTime: performance.getEntriesByName(startMark)[0]?.startTime,
      });
      
      if (log) {
        console.log(`[Performance] ${name}: ${Math.round(duration)}ms`);
      }
      
      return duration;
    } catch (e) {
      console.error(`Error measuring ${name}:`, e);
      return 0;
    }
  }

  /**
   * Get all recorded metrics
   */
  public getMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Clear all recorded metrics and marks
   */
  public clearMetrics(): void {
    if (typeof window === 'undefined') return;
    
    // Clear all performance marks and measures
    this.marks.forEach(markName => {
      try {
        performance.clearMarks(markName);
      } catch (e) {
        // Ignore errors
      }
    });
    
    this.metrics.forEach((_, name) => {
      try {
        performance.clearMeasures(name);
      } catch (e) {
        // Ignore errors
      }
    });
    
    this.marks.clear();
    this.metrics.clear();
  }

  /**
   * Enable or disable performance tracking
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Track page load performance
   */
  public trackPageLoad(): void {
    if (!this.enabled || typeof window === 'undefined') return;
    
    // Wait for page to be fully loaded
    if (document.readyState === 'complete') {
      this.capturePageLoadMetrics();
    } else {
      window.addEventListener('load', () => this.capturePageLoadMetrics());
    }
  }

  private capturePageLoadMetrics(): void {
    try {
      // Get navigation timing data
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      
      if (navigation) {
        // Record key page load metrics
        this.metrics.set('ttfb', {
          name: 'Time to First Byte',
          value: navigation.responseStart - navigation.requestStart,
        });
        
        this.metrics.set('domLoad', {
          name: 'DOM Content Loaded',
          value: navigation.domContentLoadedEventEnd - navigation.startTime,
        });
        
        this.metrics.set('pageLoad', {
          name: 'Page Load Complete',
          value: navigation.loadEventEnd - navigation.startTime,
        });
        
        // Log the results
        console.log('[Performance] Page Load Metrics:', {
          ttfb: Math.round(this.metrics.get('ttfb')?.value || 0),
          domLoad: Math.round(this.metrics.get('domLoad')?.value || 0),
          pageLoad: Math.round(this.metrics.get('pageLoad')?.value || 0),
        });
      }
      
      // Capture Core Web Vitals if available
      this.captureWebVitals();
    } catch (e) {
      console.error('Error capturing page load metrics:', e);
    }
  }

  private captureWebVitals(): void {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;
    
    try {
      // Observe LCP (Largest Contentful Paint)
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
          this.metrics.set('lcp', {
            name: 'Largest Contentful Paint',
            value: lastEntry.startTime,
          });
          console.log(`[Performance] LCP: ${Math.round(lastEntry.startTime)}ms`);
        }
      });
      
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      
      // Observe FID (First Input Delay)
      const fidObserver = new PerformanceObserver((entryList) => {
        const entry = entryList.getEntries()[0] as FirstInputDelay;
        if (entry) {
          this.metrics.set('fid', {
            name: 'First Input Delay',
            value: entry.processingStart - entry.startTime,
          });
          console.log(`[Performance] FID: ${Math.round(entry.processingStart - entry.startTime)}ms`);
        }
      });
      
      fidObserver.observe({ type: 'first-input', buffered: true });
      
      // Observe CLS (Cumulative Layout Shift)
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (!(entry as LayoutShift).hadRecentInput) {
            clsValue += (entry as LayoutShift).value;
          }
        }
        
        this.metrics.set('cls', {
          name: 'Cumulative Layout Shift',
          value: clsValue,
        });
        console.log(`[Performance] CLS: ${clsValue.toFixed(3)}`);
      });
      
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch (e) {
      console.error('Error setting up web vitals observers:', e);
    }
  }
}

export const Performance = PerformanceTracker.getInstance(); 