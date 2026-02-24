'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  RefreshCw,
  Smartphone,
  Activity,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

interface DeviceSyncStatus {
  device_id: string;
  device_name: string;
  platform: string;
  is_connected: boolean;
  last_successful_sync: string | null;
  last_sync_attempt: string | null;
  last_error: string | null;
  last_error_time: string | null;
  metrics_synced_today: number;
  background_sync_enabled: boolean;
  offline_queue_count: number;
}

interface AppleHealthSyncStatusProps {
  /** Compact mode for sidebar/header display */
  compact?: boolean;
  /** Show detailed device list */
  showDevices?: boolean;
  /** Class name for styling */
  className?: string;
}

export function AppleHealthSyncStatus({ 
  compact = false, 
  showDevices = true,
  className = '' 
}: AppleHealthSyncStatusProps) {
  const { getToken } = useAuth();
  const [devices, setDevices] = useState<DeviceSyncStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSyncStatus = async () => {
    try {
      const token = await getToken();
      if (!token) {
        setDevices([]);
        setLoading(false);
        return;
      }

      const response = await fetch('http://127.0.0.1:8000/api/wearables/apple/sync-status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch sync status');
      }

      const data = await response.json();
      setDevices(data.devices || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching sync status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSyncStatus();
    // Refresh every 60 seconds
    const interval = setInterval(fetchSyncStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchSyncStatus();
  };

  // Calculate overall status
  const overallStatus = React.useMemo(() => {
    if (loading) return 'loading';
    if (devices.length === 0) return 'not_connected';
    
    const hasError = devices.some(d => d.last_error);
    const allHealthy = devices.every(d => {
      if (!d.last_successful_sync) return false;
      const lastSync = new Date(d.last_successful_sync);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return lastSync > hourAgo && !d.last_error;
    });

    if (allHealthy) return 'healthy';
    if (hasError) return 'error';
    return 'stale';
  }, [devices, loading]);

  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getStatusIcon = () => {
    switch (overallStatus) {
      case 'healthy':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'stale':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'not_connected':
        return <WifiOff className="w-4 h-4 text-gray-400" />;
      default:
        return <BrailleSpinner className="text-sm text-gray-400" />;
    }
  };

  const getStatusText = () => {
    switch (overallStatus) {
      case 'healthy':
        return 'Syncing';
      case 'error':
        return 'Error';
      case 'stale':
        return 'Stale';
      case 'not_connected':
        return 'Not Connected';
      default:
        return 'Loading...';
    }
  };

  // Compact mode - just show icon and status
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {getStatusIcon()}
        <span className="text-sm text-gray-600">{getStatusText()}</span>
      </div>
    );
  }

  // Full mode with device details
  return (
    <div className={`bg-white border border-gray-200 rounded-lg ${className}`}>
      {/* Header */}
      <div 
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-100 rounded-lg">
            <Activity className="w-5 h-5 text-gray-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">Apple Health</span>
              {getStatusIcon()}
            </div>
            <span className="text-sm text-gray-500">
              {devices.length} device{devices.length !== 1 ? 's' : ''} connected
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRefresh();
            }}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={refreshing}
          >
            {refreshing ? (
              <BrailleSpinner className="text-sm text-gray-500" />
            ) : (
              <RefreshCw className="w-4 h-4 text-gray-500" />
            )}
          </button>
          {showDevices && (
            expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Expanded device list */}
      {showDevices && expanded && (
        <div className="border-t border-gray-200">
          {loading ? (
            <div className="p-4 text-center text-gray-500">
              Loading sync status...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-red-500">
              {error}
            </div>
          ) : devices.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <p>No Apple Health devices connected.</p>
              <p className="text-sm mt-1">Install the Ritual Companion app on your iPhone to sync Apple Watch data.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {devices.map((device) => (
                <div key={device.device_id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Smartphone className="w-5 h-5 text-gray-400" />
                      <div>
                        <div className="font-medium text-gray-900">{device.device_name}</div>
                        <div className="text-sm text-gray-500 capitalize">{device.platform}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {device.is_connected ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded">
                          <Wifi className="w-3 h-3" />
                          Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded">
                          <WifiOff className="w-3 h-3" />
                          Offline
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Last sync:</span>
                      <span className="ml-2 text-gray-900">
                        {formatRelativeTime(device.last_successful_sync)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Today:</span>
                      <span className="ml-2 text-gray-900">
                        {device.metrics_synced_today} metrics
                      </span>
                    </div>
                  </div>
                  
                  {device.last_error && (
                    <div className="mt-3 p-2 bg-red-50 rounded text-sm text-red-700">
                      <span className="font-medium">Error:</span> {device.last_error}
                    </div>
                  )}
                  
                  {device.offline_queue_count > 0 && (
                    <div className="mt-3 p-2 bg-yellow-50 rounded text-sm text-yellow-700">
                      {device.offline_queue_count} metrics queued for sync
                    </div>
                  )}
                  
                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                    <span>Background sync: {device.background_sync_enabled ? 'On' : 'Off'}</span>
                    {device.last_sync_attempt && (
                      <span>Last attempt: {formatRelativeTime(device.last_sync_attempt)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AppleHealthSyncStatus;
