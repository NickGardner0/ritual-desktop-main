/**
 * Tinybird Service for Next.js
 * Handles dual-write operations: Supabase (transactional) + Tinybird (analytics)
 */

interface HabitLogData {
  id: string;
  habit_id: string;
  habit_name?: string;
  user_id: string;
  date: string;
  time?: string;
  status: 'completed' | 'skipped' | 'failed';
  duration?: number;
  amount?: number;
  unit?: string;
  notes?: string;
  source: 'manual' | 'whoop' | 'oura' | 'apple_watch' | 'garmin' | 'fitbit';
  integration_id?: string;
  whoop_metric_type?: string;
  metadata?: any;
  created_at: string;
}

interface WhoopSleepData {
  id: string;
  user_id: string;
  whoop_connection_id: string;
  sleep_id: string;
  date: string;
  sleep_performance_percentage?: number;
  total_sleep_duration_minutes?: number;
  sleep_efficiency_percentage?: number;
  rem_sleep_minutes?: number;
  slow_wave_sleep_minutes?: number;
  light_sleep_minutes?: number;
  awake_minutes?: number;
  sleep_onset?: string;
  sleep_end?: string;
  created_at: string;
}

interface TinybirdConfig {
  baseUrl: string;
  token: string;
}

class TinybirdService {
  private config: TinybirdConfig;
  
  constructor() {
    // Use cloud or local based on TINYBIRD_ENV (defaults to cloud if not set)
    const useCloud = process.env.TINYBIRD_ENV !== 'local';
    
    // Get tokens from environment
    const cloudToken = process.env.TINYBIRD_TOKEN;
    const localToken = process.env.TINYBIRD_LOCAL_TOKEN || 'admin local_testing@tinybird.co';
    
    // Validate that required token is present
    if (useCloud && !cloudToken) {
      throw new Error('TINYBIRD_TOKEN environment variable is required for cloud mode. Please add it to your .env file.');
    }
    
    this.config = {
      baseUrl: useCloud 
        ? (process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co')
        : (process.env.TINYBIRD_LOCAL_URL || 'http://localhost:7181'),
      token: useCloud ? cloudToken! : localToken
    };
  }
  
  /**
   * Ingest events to Tinybird Events API
   */
  private async ingestEvents(datasource: string, events: any[]): Promise<{ success: boolean; error?: string }> {
    try {
      // Convert events to NDJSON format (newline-delimited JSON)
      const ndjson = events.map(e => JSON.stringify(e)).join('\n');
      
      const url = `${this.config.baseUrl}/v0/events?name=${datasource}`;
      
      console.log('🔍 Tinybird ingest:', {
        datasource,
        url,
        eventCount: events.length,
        firstEvent: events[0],
      });
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: ndjson,
      });
      
      const responseText = await response.text();
      
      console.log('🔍 Tinybird response:', {
        status: response.status,
        body: responseText,
      });
      
      if (response.status === 202) {
        return { success: true };
      } else {
        console.error('❌ Tinybird ingestion failed:', responseText);
        return { success: false, error: responseText };
      }
    } catch (error) {
      console.error('❌ Tinybird ingestion error:', error);
      return { success: false, error: String(error) };
    }
  }
  
  /**
   * Transform habit log for Tinybird schema
   * NOTE: Replace null with empty strings/0 to avoid quarantine
   */
  private transformHabitLog(log: HabitLogData) {
    return {
      id: log.id,
      habit_id: log.habit_id,
      habit_name: log.habit_name || '',
      user_id: log.user_id,
      date: log.date,
      timestamp: log.time || log.created_at,
      status: log.status,
      duration: log.duration ?? 0,
      amount: log.amount ?? 0,
      unit: log.unit || '',
      notes: log.notes || '',
      source: log.source,
      integration_id: log.integration_id || '',
      whoop_metric_type: log.whoop_metric_type || '',
      metadata: log.metadata ? JSON.stringify(log.metadata) : '{}',
      created_at: log.created_at,
    };
  }
  
  /**
   * Ingest habit log to Tinybird
   */
  async ingestHabitLog(log: HabitLogData): Promise<{ success: boolean; error?: string }> {
    const transformed = this.transformHabitLog(log);
    return this.ingestEvents('habit_logs', [transformed]);
  }
  
  /**
   * Ingest multiple habit logs (bulk operation)
   */
  async ingestHabitLogs(logs: HabitLogData[]): Promise<{ success: boolean; error?: string }> {
    const transformed = logs.map(log => this.transformHabitLog(log));
    return this.ingestEvents('habit_logs', transformed);
  }
  
  /**
   * Transform sleep data for Tinybird schema
   */
  private transformSleepData(sleep: WhoopSleepData) {
    return {
      id: sleep.id,
      user_id: sleep.user_id,
      whoop_connection_id: sleep.whoop_connection_id,
      sleep_id: sleep.sleep_id,
      date: sleep.date,
      sleep_performance_percentage: sleep.sleep_performance_percentage || null,
      total_sleep_duration_minutes: sleep.total_sleep_duration_minutes || null,
      sleep_efficiency_percentage: sleep.sleep_efficiency_percentage || null,
      rem_sleep_minutes: sleep.rem_sleep_minutes || null,
      slow_wave_sleep_minutes: sleep.slow_wave_sleep_minutes || null,
      light_sleep_minutes: sleep.light_sleep_minutes || null,
      awake_minutes: sleep.awake_minutes || null,
      sleep_onset: sleep.sleep_onset || null,
      sleep_end: sleep.sleep_end || null,
      created_at: sleep.created_at,
    };
  }
  
  /**
   * Ingest Whoop sleep data to Tinybird
   */
  async ingestWhoopSleep(sleep: WhoopSleepData): Promise<{ success: boolean; error?: string }> {
    const transformed = this.transformSleepData(sleep);
    return this.ingestEvents('whoop_sleep_data', [transformed]);
  }
  
  /**
   * Query a Tinybird pipe (endpoint)
   */
  async queryPipe(pipeName: string, params: Record<string, any> = {}): Promise<any> {
    try {
      const queryString = new URLSearchParams(params).toString();
      const url = `${this.config.baseUrl}/v0/pipes/${pipeName}.json?${queryString}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`Query failed: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Tinybird query error:', error);
      throw error;
    }
  }
  
  /**
   * Get user habits summary from Tinybird
   */
  async getUserHabitsSummary(userId: string, daysBack: number = 30) {
    return this.queryPipe('user_habits_summary', {
      user_id: userId,
      days_back: daysBack,
    });
  }
  
  /**
   * Get habit streaks from Tinybird
   */
  async getHabitStreaks(userId: string, habitId: string) {
    return this.queryPipe('habit_streaks', {
      user_id: userId,
      habit_id: habitId,
    });
  }
  
  /**
   * Get Whoop analytics from Tinybird
   */
  async getWhoopAnalytics(userId: string, daysBack: number = 30) {
    return this.queryPipe('whoop_analytics', {
      user_id: userId,
      days_back: daysBack,
    });
  }
  
  /**
   * Get habit trends from Tinybird
   */
  async getHabitTrends(userId: string, period: 'day' | 'week' = 'day', daysBack: number = 30, habitId?: string) {
    const params: any = {
      user_id: userId,
      period: period,
      days_back: daysBack,
    };
    
    if (habitId) {
      params.habit_id = habitId;
    }
    
    return this.queryPipe('habit_trends', params);
  }
  
  /**
   * Get recent habit logs from Tinybird
   */
  async getRecentHabitLogs(userId: string, daysBack: number = 7, limit: number = 100, habitId?: string) {
    const params: any = {
      user_id: userId,
      days_back: daysBack,
      limit: limit,
    };
    
    if (habitId) {
      params.habit_id = habitId;
    }
    
    return this.queryPipe('recent_habit_logs', params);
  }

  /**
   * Execute a direct SQL query against Tinybird
   */
  async executeSql(query: string): Promise<any> {
    try {
      console.log('🔍 Executing SQL query:', query);
      
      const url = `${this.config.baseUrl}/v0/sql`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ SQL query failed:', errorText);
        throw new Error(`SQL query failed: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('❌ Error executing SQL query:', error);
      throw error;
    }
  }
}

// Singleton instance
export const tinybirdService = new TinybirdService();

// Export types
export type { HabitLogData, WhoopSleepData };

