import { useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useAnalytics } from '@/lib/analytics';
import { privacySettingsHeaders } from '@/lib/privacy/privacy-settings';
import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';
import type { AIHabitChatProps, HabitOption, ScreenshotPreview } from './ai-habit-chat.types';

export type UseAiHabitScreenshotOptions = {
  habits: Array<{ id?: string; name: string; unit_type?: string }>;
  getToken: ReturnType<typeof useAuth>['getToken'];
  onHabitUpdate?: AIHabitChatProps['onHabitUpdate'];
  trackHabitLogged: ReturnType<typeof useAnalytics>['trackHabitLogged'];
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
};

export function useAiHabitScreenshot({
  habits,
  getToken,
  onHabitUpdate,
  trackHabitLogged,
  setError,
  setInput,
}: UseAiHabitScreenshotOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  
  // Screenshot confirmation flow state
  const [screenshotPreview, setScreenshotPreview] = useState<ScreenshotPreview | null>(null);
  const [editedValue, setEditedValue] = useState<string>('');
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showHabitPicker, setShowHabitPicker] = useState(false);
  
  const screenshotHabitOptions = useMemo<HabitOption[]>(() => {
    if (!screenshotPreview) return [];

    const optionMap = new Map<string, HabitOption>();

    screenshotPreview.available_habits.forEach((habit) => {
      if (!habit.id) return;
      optionMap.set(habit.id, {
        id: habit.id,
        name: habit.name,
        unit_type: habit.unit_type || '',
      });
    });

    habits.forEach((habit) => {
      if (!habit.id) return;
      if (optionMap.has(habit.id)) return;
      optionMap.set(habit.id, {
        id: habit.id,
        name: habit.name,
        unit_type: habit.unit_type || '',
      });
    });

    return Array.from(optionMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [screenshotPreview, habits]);

  const selectedScreenshotHabit = useMemo(() => {
    if (!selectedHabitId) return null;
    return screenshotHabitOptions.find((habit) => habit.id === selectedHabitId) ?? null;
  }, [selectedHabitId, screenshotHabitOptions]);
  // Screen Time screenshot upload handlers
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Compress image before upload to reduce size and speed up AI analysis
  const compressImage = async (file: File, maxWidth = 1200, quality = 0.8): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions while maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to blob with compression
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Could not compress image'));
              return;
            }
            
            // Create new file from blob
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            
            console.log(`📸 Image compressed: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB`);
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, etc.)');
      e.target.value = '';
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be under 10MB');
      e.target.value = '';
      return;
    }

    setIsUploadingScreenshot(true);
    setError(null);
    
    // Store filename for display (no image preview needed)
    setUploadedFileName(file.name);

    try {
      const startTime = performance.now();
      
      // Compress image before upload - smaller = faster OpenAI processing
      // 800px width + 70% quality is enough for text recognition
      const compressedFile = await compressImage(file, 800, 0.7);
      console.log(`⏱️ Compression: ${(performance.now() - startTime).toFixed(0)}ms`);
      
      const uploadStart = performance.now();
      const sessionToken = await getToken();
      const formData = new FormData();
      formData.append('file', compressedFile);

      const res = await fetch('/api/screenshot/preview', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': sessionToken ? `Bearer ${sessionToken}` : '',
          ...privacySettingsHeaders(),
        },
      });
      console.log(`⏱️ API call (upload + OpenAI): ${(performance.now() - uploadStart).toFixed(0)}ms`);
      console.log(`⏱️ Total time: ${(performance.now() - startTime).toFixed(0)}ms`);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.detail || 'Failed to process screenshot';
        setError(errorMessage);
        setUploadedFileName(null);
        return;
      }

      const data: ScreenshotPreview = await res.json();
      
      // Set preview data for confirmation
      setScreenshotPreview(data);
      setEditedValue(String(data.value));
      setSelectedHabitId(data.habit_id);
      setShowHabitPicker(false);
      
      // Clear any existing input
      setInput('');

    } catch (err: any) {
      console.error('Screenshot upload error:', err);
      setError(err.message || 'Failed to upload screenshot. Please try again.');
      setUploadedFileName(null);
    } finally {
      setIsUploadingScreenshot(false);
      // Reset input so the same file can be selected again if needed
      e.target.value = '';
    }
  };

  // Confirm and log the screenshot data
  const handleConfirmScreenshot = async () => {
    if (!screenshotPreview) return;
    
    setIsConfirming(true);
    setError(null);

    try {
      const habitName = selectedScreenshotHabit?.name || screenshotPreview.habit_name;
      const habitUnit = selectedScreenshotHabit?.unit_type || screenshotPreview.unit;
      const data = await apiOperationWithAuth(
        'confirm_screenshot_log_api_screenshot_confirm_post',
        getToken,
        {
          body: {
            habit_id: selectedHabitId,
            habit_name: habitName,
            value: parseFloat(editedValue) || screenshotPreview.value,
            unit: habitUnit,
            detected_type: screenshotPreview.detected_type,
            description: screenshotPreview.description,
            create_new_habit: screenshotPreview.is_new_habit && !selectedHabitId,
          },
        },
      ) as { message?: string; value?: number; unit?: string; habit_name?: string; habit_id?: string };

      setUploadedFileName(null);
      setScreenshotPreview(null);
      setEditedValue('');
      setSelectedHabitId(null);

      if (onHabitUpdate) {
        onHabitUpdate({
          success: true,
          refreshNeeded: true,
          playSound: true,
          message: data.message || `Logged ${data.value} ${data.unit} of ${data.habit_name}.`,
        });
      }

      trackHabitLogged({
        habitId: data.habit_id || selectedHabitId || '',
        habitName: data.habit_name || habitName,
        value: data.value,
        unit: data.unit,
        source: 'screenshot',
      });
    } catch (err: any) {
      console.error('Screenshot confirm error:', err);
      if (err instanceof BackendClientError) {
        try {
          const parsed = JSON.parse(err.responseBody) as { detail?: string };
          setError(parsed.detail || 'Failed to log screenshot data');
          return;
        } catch {
          setError('Failed to log screenshot data');
          return;
        }
      }
      setError(err.message || 'Failed to confirm. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  // Cancel the screenshot preview
  const handleCancelScreenshot = () => {
    setUploadedFileName(null);
    setScreenshotPreview(null);
    setEditedValue('');
    setSelectedHabitId(null);
    setShowHabitPicker(false);
    setIsUploadingScreenshot(false);
    setError(null);
  };

  const adjustEditedValue = (delta: number) => {
    const parsed = Number.parseFloat(editedValue);
    const fallback = screenshotPreview?.value ?? 0;
    const base = Number.isFinite(parsed) ? parsed : fallback;
    const next = Math.max(0, Math.round((base + delta) * 10) / 10);
    setEditedValue(next.toString());
  };

  return {
    fileInputRef,
    screenshotPreview,
    uploadedFileName,
    editedValue,
    setEditedValue,
    selectedHabitId,
    setSelectedHabitId,
    showHabitPicker,
    setShowHabitPicker,
    isConfirming,
    isUploadingScreenshot,
    screenshotHabitOptions,
    selectedScreenshotHabit,
    handleUploadClick,
    handleFileChange,
    handleConfirmScreenshot,
    handleCancelScreenshot,
    adjustEditedValue,
  };
}
