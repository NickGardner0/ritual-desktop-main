import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create a Supabase client with the Auth context of the logged in user.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get all active Whoop connections
    const { data: connections, error: connectionsError } = await supabaseClient
      .from('whoop_connections')
      .select('user_id, access_token, refresh_token, token_expires_at, whoop_user_id')
      .eq('is_active', true)

    if (connectionsError) {
      console.error('❌ Error fetching Whoop connections:', connectionsError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch connections' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🔄 Found ${connections?.length || 0} active Whoop connections to sync`)

    const results = []
    
    // Sync data for each user
    for (const connection of connections || []) {
      try {
        // Check if token needs refresh
        const expiresAt = new Date(connection.token_expires_at)
        const now = new Date()
        let accessToken = connection.access_token

        if (expiresAt <= now) {
          console.log(`🔄 Refreshing expired token for user ${connection.user_id}`)
          
          // Refresh the access token
          const tokenResponse = await fetch('https://api.prod.whoop.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'refresh_token',
              refresh_token: connection.refresh_token,
              client_id: Deno.env.get('WHOOP_CLIENT_ID'),
              client_secret: Deno.env.get('WHOOP_CLIENT_SECRET'),
            }),
          })

          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json()
            accessToken = tokenData.access_token
            
            // Update token in database
            await supabaseClient
              .from('whoop_connections')
              .update({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || connection.refresh_token,
                token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
              })
              .eq('user_id', connection.user_id)
          }
        }

        // Fetch Whoop data for the last 7 days
        const endDate = new Date()
        const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)
        
        const headers = {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }

        // Fetch recovery, sleep, and workout data
        const [recoveryRes, sleepRes, workoutRes] = await Promise.all([
          fetch(`https://api.prod.whoop.com/developer/v1/recovery?start=${startDate.toISOString()}&end=${endDate.toISOString()}`, { headers }),
          fetch(`https://api.prod.whoop.com/developer/v1/sleep?start=${startDate.toISOString()}&end=${endDate.toISOString()}`, { headers }),
          fetch(`https://api.prod.whoop.com/developer/v1/workout?start=${startDate.toISOString()}&end=${endDate.toISOString()}`, { headers }),
        ])

        // Process and store data (similar to your existing sync logic)
        const [recoveryData, sleepData, workoutData] = await Promise.all([
          recoveryRes.ok ? recoveryRes.json() : { records: [] },
          sleepRes.ok ? sleepRes.json() : { records: [] },
          workoutRes.ok ? workoutRes.json() : { records: [] },
        ])

        // Get user's Sleep Duration habit
        const { data: habits } = await supabaseClient
          .from('habits')
          .select('id, name')
          .eq('user_id', connection.user_id)
          .eq('name', 'Sleep Duration')

        if (!habits || habits.length === 0) {
          console.log(`⚠️ No Whoop habits found for user ${connection.user_id}`)
          continue
        }

        // Process data and create habit logs
        const logsToInsert = []

        // Process recovery data
        const recoveryHabit = habits.find(h => h.name === 'Recovery Score')
        if (recoveryHabit && recoveryData.records) {
          for (const record of recoveryData.records) {
            logsToInsert.push({
              habit_id: recoveryHabit.id,
              user_id: connection.user_id,
              date: new Date(record.created_at).toISOString().split('T')[0],
              amount: record.score?.recovery_score || 0,
              duration: null,
              completed: true,
              source: 'whoop',
              integration_id: connection.user_id,
              whoop_metric_type: 'recovery',
              metadata: record,
            })
          }
        }

        // Process sleep data
        const sleepDurationHabit = habits.find(h => h.name === 'Sleep Duration')
        const sleepPerformanceHabit = habits.find(h => h.name === 'Sleep Performance')
        
        if (sleepData.records) {
          for (const record of sleepData.records) {
            const durationHours = record.score?.total_in_bed_time_milli ? record.score.total_in_bed_time_milli / (1000 * 60 * 60) : 0
            
            if (sleepDurationHabit) {
              logsToInsert.push({
                habit_id: sleepDurationHabit.id,
                user_id: connection.user_id,
                date: new Date(record.created_at).toISOString().split('T')[0],
                amount: null,
                duration: Math.round(durationHours * 3600),
                completed: true,
                source: 'whoop',
                integration_id: connection.user_id,
                whoop_metric_type: 'sleep_duration',
                metadata: record,
              })
            }

            if (sleepPerformanceHabit && record.score?.sleep_performance_percentage) {
              logsToInsert.push({
                habit_id: sleepPerformanceHabit.id,
                user_id: connection.user_id,
                date: new Date(record.created_at).toISOString().split('T')[0],
                amount: record.score.sleep_performance_percentage,
                duration: null,
                completed: true,
                source: 'whoop',
                integration_id: connection.user_id,
                whoop_metric_type: 'sleep_performance',
                metadata: record,
              })
            }
          }
        }

        // Process workout data for Daily Strain
        const strainHabit = habits.find(h => h.name === 'Daily Strain')
        if (strainHabit && workoutData.records) {
          for (const record of workoutData.records) {
            logsToInsert.push({
              habit_id: strainHabit.id,
              user_id: connection.user_id,
              date: new Date(record.created_at).toISOString().split('T')[0],
              amount: record.score?.strain || 0,
              duration: null,
              completed: true,
              source: 'whoop',
              integration_id: connection.user_id,
              whoop_metric_type: 'strain',
              metadata: record,
            })
          }
        }

        // Insert logs (with conflict handling to avoid duplicates)
        if (logsToInsert.length > 0) {
          const { error: insertError } = await supabaseClient
            .from('habit_logs')
            .upsert(logsToInsert, {
              onConflict: 'habit_id,user_id,date,source',
              ignoreDuplicates: false,
            })

          if (insertError) {
            console.error(`❌ Error inserting logs for user ${connection.user_id}:`, insertError)
          } else {
            console.log(`✅ Synced ${logsToInsert.length} Whoop logs for user ${connection.user_id}`)
          }
        }

        // Update last_synced_at
        await supabaseClient
          .from('whoop_connections')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('user_id', connection.user_id)

        results.push({
          user_id: connection.user_id,
          success: true,
          logs_synced: logsToInsert.length,
        })

      } catch (error) {
        console.error(`❌ Error syncing Whoop data for user ${connection.user_id}:`, error)
        results.push({
          user_id: connection.user_id,
          success: false,
          error: error.message,
        })
      }
    }

    return new Response(
      JSON.stringify({ 
        message: 'Whoop auto-sync completed',
        results,
        total_users: connections?.length || 0,
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('❌ Whoop auto-sync error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})

