"use client"

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useUser } from '@clerk/nextjs';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const { user } = useUser();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setSubmitting(true);

    try {
      // Here you would send the feedback to your backend
      // For now, we'll just log it
      console.log('Feedback submitted:', {
        user_id: user?.id,
        email: user?.primaryEmailAddress?.emailAddress,
        message: message,
        timestamp: new Date().toISOString(),
      });

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      setSubmitted(true);
      setTimeout(() => {
        setMessage('');
        setSubmitted(false);
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Error submitting feedback:', error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop - beige overlay */}
      <div 
        className="absolute inset-0 bg-[#e8e5df]/70"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white w-full max-w-lg p-6 border border-gray-300 z-10">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {submitted ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">✓</div>
            <h2 className="text-xl font-medium text-gray-900 mb-2">
              Thank you!
            </h2>
            <p className="text-sm text-gray-600">
              Your feedback has been received.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 className="text-2xl font-medium text-gray-900 mb-2">
              Send us Feedback
            </h2>
            <p className="text-sm text-gray-400 mb-5">
              Help improve Ritual, a real human will respond within 24 hours.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Message <span className="text-red-500">*</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us about your experience, bugs you've found, or features you'd like to see..."
                className="w-full h-32 px-3 py-2 border border-gray-300 rounded-none focus:outline-none focus:border-gray-400 resize-none text-sm text-gray-900 placeholder-gray-400"
                required
              />
            </div>

            <p className="text-xs text-gray-500 mb-5">
              Something else on your mind? Email us at{' '}
              <a href="mailto:support@ritual.app" className="text-gray-700 hover:text-gray-900">
                support@ritual.app
              </a>
            </p>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !message.trim()}
                className="px-4 py-2 bg-black text-white rounded-none text-sm font-normal hover:bg-gray-800 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Sending...' : 'Send Feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

