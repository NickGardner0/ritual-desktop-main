/**
 * Biometrics tool executor.
 *
 * Extracted from orchestrator.ts (lines 4808-4848) during Phase 1 refactoring.
 */

import { fetchPythonApi } from './shared-api.js';
import { getTimezoneYmd } from './shared-api.js';

const BIOMETRICS_TIMEOUT_MS = 8000;

export async function executeGetDailyBiometrics(
  token: string,
  params: { day?: string },
  timezone?: string,
) {
  const day = params.day || getTimezoneYmd(new Date(), timezone);
  console.log('💓 getDailyBiometrics called:', { day });

  try {
    const response = await fetchPythonApi(
      '/api/v1/biometrics/heart-rate/day-summary',
      token,
      { day },
      { timeoutMs: BIOMETRICS_TIMEOUT_MS },
    );

    if (!response || response.detail) {
      return JSON.stringify({
        success: false,
        error: response?.detail || 'No heart rate data available. Heart rate tracking may not be connected.',
      });
    }

    return JSON.stringify({
      success: true,
      day: response.day || day,
      average_bpm: response.average_bpm,
      min_bpm: response.min_bpm,
      max_bpm: response.max_bpm,
      total_samples: response.total_samples,
      lowest_window: response.lowest_window,
      highest_window: response.highest_window,
      source_breakdown: response.source_breakdown,
    });
  } catch (error) {
    console.error('❌ getDailyBiometrics error:', error);
    return JSON.stringify({
      success: false,
      error: 'Heart rate data is currently unavailable. The user may not have a heart rate monitor connected.',
    });
  }
}
