'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Calendar } from 'lucide-react';
import { categoryMap } from './constants';

export type CustomizationPanelProps = {
  selectedCategory: string | null;
  selectedHabit: any;
  customHabitName: string;
  setCustomHabitName: (v: string) => void;
  selectedMetric: string;
  setSelectedMetric: (v: string) => void;
  isMetricDropdownOpen: boolean;
  setIsMetricDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  metricDropdownRef: React.RefObject<HTMLDivElement | null>;
  metricBtnRef: React.RefObject<HTMLButtonElement | null>;
  metricStyle: React.CSSProperties;
  metricOptions: string[];
  isCreating: boolean;
  handleBack: () => void;
  handleCreateHabit: () => void;
};

export function CustomizationPanel(props: CustomizationPanelProps) {
  const {
    selectedCategory, selectedHabit, customHabitName, setCustomHabitName,
    selectedMetric, setSelectedMetric, isMetricDropdownOpen, setIsMetricDropdownOpen,
    metricDropdownRef, metricBtnRef, metricStyle, metricOptions,
    isCreating, handleBack, handleCreateHabit,
  } = props;
  const portalTarget = typeof document !== 'undefined' ? document.body : null;

  return (
            <div className="flex flex-col h-full py-2">
              {/* Title */}
              <h3 className="text-lg font-medium text-gray-900 mb-5">Configure</h3>
              
              {/* Form Fields */}
              <div className="space-y-5">
                {/* Title Input */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Title</label>
                  <input
                    type="text"
                    placeholder="Name"
                    value={selectedCategory === 'custom' ? customHabitName : (selectedHabit?.label || '')}
                    onChange={(e) => {
                      if (selectedCategory === 'custom') {
                        setCustomHabitName(e.target.value);
                      }
                    }}
                    readOnly={selectedCategory !== 'custom'}
                    className={`flex-1 px-3 py-2 border border-gray-300 rounded-sm text-sm font-normal text-gray-900 h-10 focus:outline-none focus:border-gray-400 ${
                      selectedCategory === 'custom' ? 'bg-white' : 'bg-[#F3F3F3]'
                    }`}
                  />
                </div>


                {/* Metric Type Selection */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Metric</label>
                  <div className="flex-1">
                    <div className="relative" ref={metricDropdownRef}>
                      <button
                        ref={metricBtnRef}
                        onClick={() => setIsMetricDropdownOpen((v) => !v)}
                        className="flex items-center justify-between w-full px-3 py-2 border border-gray-200 rounded-sm bg-white text-sm font-normal text-gray-700 hover:bg-[#F3F3F3] focus:outline-none h-10"
                      >
                        <span>{selectedMetric}</span>
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isMetricDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isMetricDropdownOpen &&
                        portalTarget &&
                        createPortal(
                          <div style={metricStyle} data-metric-dropdown className="dropdown z-[10000] rounded-sm">
                            <div className="py-1">
                              {metricOptions.map((metric) => (
                                <button
                                  key={metric}
                                  onClick={() => {
                                    setSelectedMetric(metric);
                                    setIsMetricDropdownOpen(false);
                                  }}
                                  className={`flex items-center w-full px-3 py-2 text-sm font-normal hover:bg-[#F3F3F3] text-left rounded-sm ${
                                    selectedMetric === metric ? 'bg-[#F3F3F3] text-gray-900' : 'text-gray-700'
                                  }`}
                                >
                                  {metric}
                                </button>
                              ))}
                            </div>
                          </div>,
                          portalTarget
                        )}
                    </div>
                  </div>
                </div>

                {/* Start Date Selection */}
                <div className="flex items-center gap-4">
                  <label className="text-sm font-normal text-gray-600 w-24 flex-shrink-0">Start Date</label>
                  <div className="flex-1">
                    <div className="flex items-center gap-2.5 px-3 py-2 border border-gray-200 rounded-sm bg-[#F3F3F3] text-sm font-normal text-gray-700 h-10 focus-within:ring-1 focus-within:ring-gray-300">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      <span>Today, {new Date().toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric' 
                      })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="flex justify-end items-center gap-3 mt-auto pt-6 border-t border-gray-100">
                <button
                  onClick={handleBack}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateHabit}
                  disabled={isCreating || (selectedCategory === 'custom' && !customHabitName.trim())}
                  className="px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreating ? 'Starting...' : 'Start Tracking'}
                </button>
              </div>
            </div>

  );
}
