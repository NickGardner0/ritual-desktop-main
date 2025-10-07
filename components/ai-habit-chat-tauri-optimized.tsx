// TAURI-OPTIMIZED VOICE RECOGNITION
// This replaces the browser-focused approach with desktop-optimized voice recognition

import { useEffect, useRef } from 'react';

// Tauri-optimized voice recognition hook
export function useTauriVoiceRecognition(
  isListening: boolean,
  setIsListening: (listening: boolean) => void,
  setVoiceTranscript: (transcript: string) => void,
  setError: (error: string | null) => void,
  setIsLoading: (loading: boolean) => void,
  onTranscriptReady: (transcript: string) => void
) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startVoiceRecognition = async () => {
    if (isListening) {
      // Stop current recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      setIsListening(false);
      return;
    }

    try {
      setError(null);
      setVoiceTranscript('');
      
      // Request microphone access (works in Tauri webview)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        } 
      });
      
      streamRef.current = stream;
      
      // Use the most compatible format for desktop
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm' // Simple WebM format works well in Tauri
      });
      
      mediaRecorderRef.current = mediaRecorder;
      const audioChunks: Blob[] = [];
          
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        setIsListening(false);
        
        if (audioChunks.length === 0) {
          setError('No audio recorded. Please try again.');
          return;
        }

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        
        // Show processing state
        setVoiceTranscript('Processing...');
        setIsLoading(true);
        
        try {
          // Send audio to Whisper API
          const formData = new FormData();
          formData.append('file', audioBlob, 'audio.webm');
          
          const response = await fetch('/api/whisper', {
            method: 'POST',
            body: formData,
          });
          
          if (response.ok) {
            const result = await response.json();
            const transcript = result.text?.trim();
            
            if (!transcript) {
              setError('No speech detected. Please try again.');
              setVoiceTranscript('');
              return;
            }
            
            console.log('🎤 Tauri voice transcript:', transcript);
            setVoiceTranscript(transcript);
            onTranscriptReady(transcript);
            
          } else {
            const errorText = await response.text();
            console.error('❌ Whisper API error:', response.status, errorText);
            setError('Failed to transcribe audio. Please try again.');
            setVoiceTranscript('');
          }
        } catch (err) {
          console.error('❌ Error transcribing audio:', err);
          setError('Failed to process voice input. Please try again.');
          setVoiceTranscript('');
        } finally {
          setIsLoading(false);
          // Clean up stream
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
        }
      };
      
      // Start recording
      mediaRecorder.start(100);
      setIsListening(true);
      
      // Auto-stop after 5 seconds
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 5000);
      
    } catch (err: any) {
      console.error('❌ Error accessing microphone in Tauri:', err);
      
      if (err.name === 'NotAllowedError') {
        setError('Microphone access denied. Please allow microphone access in your system settings.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect a microphone and try again.');
      } else if (err.name === 'NotReadableError') {
        setError('Microphone is being used by another application. Please close other apps and try again.');
      } else {
        setError(`Microphone error: ${err.message || 'Unknown error'}`);
      }
      
      setIsListening(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return { startVoiceRecognition };
}
