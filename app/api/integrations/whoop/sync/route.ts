import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface WhoopRecoveryResponse {
  records: Array<{
    cycle_id: number;
    sleep_id: number;
    user_id: number;
    created_at: string;
    updated_at: string;
    score_state: string;
    score: {
      user_calibrating: boolean;
      recovery_score: number;
      resting_heart_rate: number;
      hrv_rmssd_milli: number;
      spo2_percentage: number;
      skin_temp_celsius: number;
    };
  }>;
}

interface WhoopSleepResponse {
  records: Array<{
    id: number;
    user_id: number;
    created_at: string;
    updated_at: string;
    start: string;
    end: string;
    score_state: string;
    score: {
      stage_summary: {
        total_in_bed_time_milli: number;
        total_awake_time_milli: number;
        total_no_data_time_milli: number;
        total_light_sleep_time_milli: number;
        total_slow_wave_sleep_time_milli: number;
        total_rem_sleep_time_milli: number;
        sleep_cycle_count: number;
        disturbance_count: number;
      };
      sleep_needed: {
        baseline_milli: number;
        need_from_sleep_debt_milli: number;
        need_from_recent_strain_milli: number;
        need_from_recent_nap_milli: number;
      };
      respiratory_rate: number;
      sleep_performance_percentage: number;
      sleep_consistency_percentage: number;
      sleep_efficiency_percentage: number;
    };
  }>;
}

interface WhoopWorkoutResponse {
  records: Array<{
    id: number;
    user_id: number;
    created_at: string;
    updated_at: string;
    start: string;
    end: string;
    timezone_offset: string;
    sport_id: number;
    score_state: string;
    score: {
      strain: number;
      average_heart_rate: number;
      max_heart_rate: number;
      kilojoule: number;
      percent_recorded: number;
      distance_meter: number;
      altitude_gain_meter: number;
      altitude_change_meter: number;
      zone_duration: {
        zone_zero_milli: number;
        zone_one_milli: number;
        zone_two_milli: number;
        zone_three_milli: number;
        zone_four_milli: number;
        zone_five_milli: number;
      };
    };
  }>;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const clientId = process.env.WHOOP_CLIENT_ID!;
    const clientSecret = process.env.WHOOP_CLIENT_SECRET!;

    console.log('🔄 Attempting to refresh Whoop token...');

    const response = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to refresh Whoop token:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('✅ Token refreshed successfully');
    return data.access_token;
  } catch (error) {
    console.error('❌ Error refreshing token:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey);
    
    // Get user from request
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // Get the user's Whoop connection
    const { data: connection, error: connError } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (connError || !connection) {
      return NextResponse.json({ error: 'No active Whoop connection found' }, { status: 404 });
    }

    let accessToken = connection.access_token;

    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(connection.token_expires_at);
    
    if (now >= expiresAt) {
      console.log('🔄 Access token expired, refreshing...');
      const newToken = await refreshAccessToken(connection.refresh_token);
      
      if (!newToken) {
        return NextResponse.json({ 
          error: 'Whoop token expired. Please disconnect and reconnect your Whoop account.',
          reconnect_required: true 
        }, { status: 401 });
      }
      
      accessToken = newToken;
      
      // Update the token in database
      await supabase
        .from('whoop_connections')
        .update({
          access_token: newToken,
          token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        })
        .eq('id', connection.id);
    }

    // Get or create Sleep Duration habit only
    const { data: existingHabits } = await supabase
      .from('habits')
      .select('id, name')
      .eq('user_id', userId)
      .eq('name', 'Sleep Duration');

    const habitMap = new Map(existingHabits?.map(h => [h.name, h.id]) || []);

    // Create Sleep Duration habit if it doesn't exist
    if (!habitMap.has('Sleep Duration')) {
      const { data: newHabit } = await supabase
        .from('habits')
        .insert({
          user_id: userId,
          name: 'Sleep Duration',
          type: 'good',
          unit_type: 'Hours',
          is_custom: false,
        })
        .select('id, name')
        .single();

      if (newHabit) {
        habitMap.set(newHabit.name, newHabit.id);
      }
    } else {
      // Update existing habit to ensure it has the correct unit_type
      const sleepHabitId = habitMap.get('Sleep Duration');
      if (sleepHabitId) {
        await supabase
          .from('habits')
          .update({ unit_type: 'Hours' })
          .eq('id', sleepHabitId);
      }
    }

    // Fetch data from Whoop API (last 7 days)
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
    };

    let sleepCount = 0;

    // Fetch Sleep Data (only sleep duration - hours slept)
    console.log('😴 Fetching Whoop sleep data...');
    const sleepResponse = await fetch(
      `https://api.prod.whoop.com/developer/v1/activity/sleep?start=${startDate}&end=${endDate}`,
      { headers }
    );

    if (sleepResponse.ok) {
      const sleepData: WhoopSleepResponse = await sleepResponse.json();
      console.log(`📊 Found ${sleepData.records.length} sleep records from Whoop API`);
      console.log('🔍 Raw sleep records:', JSON.stringify(sleepData.records, null, 2));
      
      for (const record of sleepData.records) {
        if (record.score_state === 'SCORED' && habitMap.has('Sleep Duration')) {
          const stageSummary = record.score.stage_summary;
          const sleepDate = new Date(record.start).toISOString().split('T')[0];
          
          // Calculate actual sleep time (excluding awake time and no data time)
          const totalSleepMilli = stageSummary.total_light_sleep_time_milli + 
                                   stageSummary.total_slow_wave_sleep_time_milli + 
                                   stageSummary.total_rem_sleep_time_milli;
          const totalSleepHours = Math.round(totalSleepMilli / 3600000 * 100) / 100; // 2 decimal places
          
          console.log(`💤 Logging sleep for ${sleepDate}:`);
          console.log(`   - Total in bed: ${Math.round(stageSummary.total_in_bed_time_milli / 3600000 * 100) / 100} hours`);
          console.log(`   - Light sleep: ${Math.round(stageSummary.total_light_sleep_time_milli / 3600000 * 100) / 100} hours`);
          console.log(`   - Deep sleep: ${Math.round(stageSummary.total_slow_wave_sleep_time_milli / 3600000 * 100) / 100} hours`);
          console.log(`   - REM sleep: ${Math.round(stageSummary.total_rem_sleep_time_milli / 3600000 * 100) / 100} hours`);
          console.log(`   - ACTUAL SLEEP: ${totalSleepHours} hours`);
          
          // Check if log already exists
          const { data: existingLogs } = await supabase
            .from('habit_logs')
            .select('id, amount')
            .eq('user_id', userId)
            .eq('habit_id', habitMap.get('Sleep Duration')!)
            .eq('date', sleepDate);
          
          const existingLog = existingLogs && existingLogs.length > 0 ? existingLogs[0] : null;
          
          // Log if duplicates found
          if (existingLogs && existingLogs.length > 1) {
            console.warn(`⚠️ Found ${existingLogs.length} duplicate logs for ${sleepDate}. Updating the first one and ignoring duplicates.`);
          }
          
          if (existingLog) {
            // Update existing log
            const { error: updateError } = await supabase
              .from('habit_logs')
              .update({
                duration: Math.round(totalSleepMilli / 60000), // Store in minutes
                amount: totalSleepHours,
                unit: 'hours',
                status: 'completed',
                source: 'whoop',
                integration_id: connection.id,
                whoop_metric_type: 'sleep_duration',
                metadata: {
                  sleep_id: record.id,
                  sleep_onset: record.start,
                  sleep_end: record.end,
                },
              })
              .eq('id', existingLog.id);
            
            if (updateError) {
              console.error(`❌ Error updating sleep log for ${sleepDate}:`, updateError);
            } else {
              console.log(`✅ Updated existing sleep log for ${sleepDate}`);
              sleepCount++;
            }
          } else {
            // Insert new log
            const { data: insertedLog, error: insertError } = await supabase
              .from('habit_logs')
              .insert({
                user_id: userId,
                habit_id: habitMap.get('Sleep Duration')!,
                habit_name: 'Sleep Duration',
                date: sleepDate,
                status: 'completed',
                duration: Math.round(totalSleepMilli / 60000), // Store in minutes
                amount: totalSleepHours,
                unit: 'hours',
                source: 'whoop',
                integration_id: connection.id,
                whoop_metric_type: 'sleep_duration',
                metadata: {
                  sleep_id: record.id,
                  sleep_onset: record.start,
                  sleep_end: record.end,
                },
              })
              .select();
            
            if (insertError) {
              console.error(`❌ Error inserting sleep log for ${sleepDate}:`, insertError);
            } else {
              console.log(`✅ Successfully inserted sleep log for ${sleepDate}`);
              sleepCount++;
            }
          }
        }
      }
      console.log(`✅ Synced ${sleepCount} sleep duration records to habit_logs`);
    }

    // Update last synced timestamp
    await supabase
      .from('whoop_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', connection.id);

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${sleepCount} sleep record(s)`,
      counts: {
        sleep: sleepCount,
      },
    });
  } catch (error) {
    console.error('❌ Whoop sync error:', error);
    return NextResponse.json(
      { error: 'Failed to sync Whoop data' },
      { status: 500 }
    );
  }
}
