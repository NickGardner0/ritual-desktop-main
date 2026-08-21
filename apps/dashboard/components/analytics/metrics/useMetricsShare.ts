'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { format } from 'date-fns';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';

export function useMetricsShare({
  chartRef,
  exportCardRef,
}: {
  chartRef: RefObject<HTMLDivElement | null>;
  exportCardRef: RefObject<HTMLDivElement | null>;
}) {
  const { isDesktop } = useDesktopCapabilities();
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLabel, setShareLabel] = useState('');
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [shareImageBlob, setShareImageBlob] = useState<Blob | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [downloadState, setDownloadState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [isCapturing, setIsCapturing] = useState(false);
  const shareObjectUrlRef = useRef<string | null>(null);

  const captureExpandedChart = useCallback(async (label: string) => {
    const captureTarget = exportCardRef.current || chartRef.current;
    if (!captureTarget || isCapturing) return;

    setShareLabel(label);
    setShowShareModal(true);
    setShareImageUrl(null);
    setShareImageBlob(null);
    setCopyState('idle');
    setDownloadState('idle');
    setIsCapturing(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const scale = Math.max(2, Math.min(4, (window.devicePixelRatio || 1) * 2));
      const canvas = await html2canvas(captureTarget, {
        backgroundColor: '#FFFFFF',
        scale,
        useCORS: true,
        logging: false,
        removeContainer: true,
        onclone: (clonedDoc) => {
          clonedDoc.querySelectorAll<HTMLElement>('[data-export-title]').forEach((el) => {
            el.style.overflow = 'visible';
            el.style.textOverflow = 'clip';
            el.style.whiteSpace = 'normal';
          });
          clonedDoc.querySelectorAll<HTMLElement>('[data-export-close]').forEach((el) => {
            el.style.display = 'none';
          });
        },
      });

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/png', 1);
      });
      if (!blob) {
        throw new Error('Failed to render image blob');
      }

      const objectUrl = URL.createObjectURL(blob);
      if (shareObjectUrlRef.current) {
        URL.revokeObjectURL(shareObjectUrlRef.current);
      }
      shareObjectUrlRef.current = objectUrl;
      setShareImageUrl(objectUrl);
      setShareImageBlob(blob);
    } catch (error) {
      console.error('Failed to export chart image:', error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const closeShareModal = useCallback(() => {
    setShowShareModal(false);
    setCopyState('idle');
    setDownloadState('idle');
    setShareImageBlob(null);
    setShareImageUrl(null);
    if (shareObjectUrlRef.current) {
      URL.revokeObjectURL(shareObjectUrlRef.current);
      shareObjectUrlRef.current = null;
    }
  }, []);

  const getShareFileName = useCallback(() => {
    const fileBase = shareLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'habit-chart';
    return `${fileBase}-${format(new Date(), 'yyyyMMdd')}.png`;
  }, [shareLabel]);

  const getShareBlob = useCallback(async (): Promise<Blob | null> => {
    if (shareImageBlob) return shareImageBlob;
    if (!shareImageUrl) return null;
    const response = await fetch(shareImageUrl);
    if (!response.ok) return null;
    return response.blob();
  }, [shareImageBlob, shareImageUrl]);

  const downloadShareImage = useCallback(async () => {
    try {
      const blob = await getShareBlob();
      if (!blob) {
        setDownloadState('failed');
        return;
      }

      const fileName = getShareFileName();

      if (isDesktop) {
        const [{ save }, { writeFile }] = await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/plugin-fs'),
        ]);
        const destination = await save({
          defaultPath: fileName,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (!destination) return;

        const bytes = new Uint8Array(await blob.arrayBuffer());
        await writeFile(destination, bytes);
      } else {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = fileName;
        link.href = downloadUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 250);
      }

      setDownloadState('done');
    } catch (error) {
      console.error('Failed to download chart image:', error);
      setDownloadState('failed');
    }
  }, [getShareBlob, getShareFileName]);

  const copyShareImage = useCallback(async () => {
    try {
      const blob = await getShareBlob();
      if (!blob) {
        setCopyState('failed');
        return;
      }

      if (typeof navigator === 'undefined'
        || !navigator.clipboard?.write
        || typeof ClipboardItem === 'undefined') {
        setCopyState('failed');
        return;
      }

      const item = new ClipboardItem({
        [blob.type || 'image/png']: blob,
      });
      await navigator.clipboard.write([item]);
      setCopyState('copied');
    } catch (error) {
      console.error('Failed to copy chart image:', error);
      setCopyState('failed');
    }
  }, [getShareBlob]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (downloadState === 'idle') return;
    const timer = window.setTimeout(() => setDownloadState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [downloadState]);

  useEffect(() => {
    return () => {
      if (shareObjectUrlRef.current) {
        URL.revokeObjectURL(shareObjectUrlRef.current);
        shareObjectUrlRef.current = null;
      }
    };
  }, []);

  return {
    showShareModal,
    shareLabel,
    shareImageUrl,
    shareImageBlob,
    copyState,
    downloadState,
    isCapturing,
    captureExpandedChart,
    closeShareModal,
    downloadShareImage,
    copyShareImage,
    getShareFileName,
  };
}
