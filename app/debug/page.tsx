"use client"

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function DebugPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDebugData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch logs from debug endpoint
      const response = await fetch('/api/debug/tinybird-logs');
      const data = await response.json();
      
      if (data.rawLogs?.data) {
        setLogs(data.rawLogs.data);
      }
      
      if (data.summary?.data) {
        setMetrics(data.summary.data);
      }
      
      console.log('Debug data:', data);
    } catch (err) {
      console.error('Error fetching debug data:', err);
      setError('Failed to fetch debug data');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchSqlData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch logs from SQL endpoint
      const response = await fetch('/api/debug/tinybird-sql');
      const data = await response.json();
      
      if (data.result?.data) {
        setLogs(data.result.data);
      }
      
      console.log('SQL debug data:', data);
    } catch (err) {
      console.error('Error fetching SQL debug data:', err);
      setError('Failed to fetch SQL debug data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Tinybird Debug Page</h1>
      
      <div className="flex space-x-4 mb-4">
        <Button onClick={fetchDebugData} disabled={loading}>
          {loading ? 'Loading...' : 'Fetch Pipe Data'}
        </Button>
        
        <Button onClick={fetchSqlData} disabled={loading} variant="outline">
          {loading ? 'Loading...' : 'Fetch SQL Data'}
        </Button>
      </div>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded p-4">
          <h2 className="text-xl font-semibold mb-2">Habit Metrics</h2>
          {metrics.length > 0 ? (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2 text-left">Habit</th>
                  <th className="border p-2 text-left">Count</th>
                  <th className="border p-2 text-left">Duration</th>
                  <th className="border p-2 text-left">Amount</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : ''}>
                    <td className="border p-2">{metric.habit_name}</td>
                    <td className="border p-2">{metric.completed_count}</td>
                    <td className="border p-2">{metric.total_duration_seconds || 0}</td>
                    <td className="border p-2">{metric.total_amount || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No metrics data available</p>
          )}
        </div>
        
        <div className="border rounded p-4">
          <h2 className="text-xl font-semibold mb-2">Recent Logs</h2>
          {logs.length > 0 ? (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2 text-left">Habit</th>
                  <th className="border p-2 text-left">Date</th>
                  <th className="border p-2 text-left">Amount</th>
                  <th className="border p-2 text-left">Unit</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : ''}>
                    <td className="border p-2">{log.habit_name}</td>
                    <td className="border p-2">{log.date}</td>
                    <td className="border p-2">{log.amount || 0}</td>
                    <td className="border p-2">{log.unit || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No logs available</p>
          )}
        </div>
      </div>
    </div>
  );
}
