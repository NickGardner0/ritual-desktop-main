"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, AlertTriangle, ChevronDown, Check } from "lucide-react";
import { AGGREGATION_OPTIONS, CONFLICT_POLICIES, type AggregationPeriod, type ConflictPolicy } from "../data-import-modal.config";
import type { DataImportController } from "./use-data-import";

type Props = { imp: DataImportController };

export function ConfigureStep({ imp }: Props) {
  const previewData = imp.previewData;
  if (!previewData) return null;

  return (
            <div className="space-y-5">
              {/* V2: Enhanced Import Summary Card */}
              <div className="bg-gray-50 border border-gray-200 p-4 space-y-3">
                <h4 className="text-sm font-medium text-gray-900">Import Summary</h4>
                
                {/* Main counts */}
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div className="bg-white p-2 border border-gray-100">
                    <div className="text-lg font-semibold text-gray-900">{previewData.summary.total_rows}</div>
                    <div className="text-xs text-gray-500">Total rows</div>
                  </div>
                  <div className="bg-white p-2 border border-green-100">
                    <div className="text-lg font-semibold text-green-600">{previewData.dedupe_estimate.new_items}</div>
                    <div className="text-xs text-gray-500">Will create</div>
                  </div>
                  <div className="bg-white p-2 border border-blue-100">
                    <div className="text-lg font-semibold text-blue-600">{previewData.dedupe_estimate.conflicts}</div>
                    <div className="text-xs text-gray-500">Will update</div>
                  </div>
                  <div className="bg-white p-2 border border-gray-100">
                    <div className="text-lg font-semibold text-gray-400">{previewData.dedupe_estimate.duplicates}</div>
                    <div className="text-xs text-gray-500">Will skip</div>
                  </div>
                </div>

                {/* V2: Validation & Confidence Summary */}
                {(previewData.validation_summary || previewData.confidence_summary) && (
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100">
                    {/* Validation warnings */}
                    {previewData.validation_summary && (previewData.validation_summary.total_warnings > 0 || previewData.validation_summary.total_errors > 0) && (
                      <div className="flex items-center gap-3">
                        {previewData.validation_summary.total_errors > 0 && (
                          <span className="flex items-center gap-1 text-red-600">
                            <AlertCircle className="w-3 h-3" />
                            {previewData.validation_summary.total_errors} errors
                          </span>
                        )}
                        {previewData.validation_summary.total_warnings > 0 && (
                          <span className="flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="w-3 h-3" />
                            {previewData.validation_summary.total_warnings} warnings
                          </span>
                        )}
                        {previewData.validation_summary.auto_fixable_count > 0 && (
                          <button
                            onClick={async () => {
                              try {
                                const response = await fetch(`/api/import/runs/${previewData.import_run_id}/auto-fix`, {
                                  method: "POST",
                                });
                                if (response.ok) {
                                  // Refresh preview data
                                  imp.handleFetchPreview();
                                }
                              } catch (e) {
                                console.error("Auto-fix failed:", e);
                              }
                            }}
                            className="text-blue-600 hover:text-blue-800 underline"
                          >
                            Fix {previewData.validation_summary.auto_fixable_count} automatically
                          </button>
                        )}
                      </div>
                    )}
                    
                    {/* Confidence indicator */}
                    {previewData.confidence_summary && (
                      <div className="flex items-center gap-2">
                        {previewData.confidence_summary.low > 0 && (
                          <span className="text-amber-600" title="Low confidence items may need review">
                            ⚠️ {previewData.confidence_summary.low} low confidence
                          </span>
                        )}
                        {previewData.confidence_summary.high > 0 && previewData.confidence_summary.low === 0 && (
                          <span className="text-green-600">
                            ✓ High confidence match
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Conflict Policy */}
              <div>
                <Label className="text-sm font-medium text-gray-900 mb-2 block">When data already exists</Label>
                <Select value={imp.conflictPolicy} onValueChange={(v: ConflictPolicy) => imp.setConflictPolicy(v)}>
                  <SelectTrigger className="h-11 rounded-sm border-gray-300 [&>span]:text-left [&>span]:pl-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[10000] rounded-sm">
                    {CONFLICT_POLICIES.map((policy) => (
                      <SelectItem key={policy.value} value={policy.value}>
                        <div className="flex flex-col items-start">
                          <span>{policy.label}</span>
                          <span className="text-xs text-gray-500">{policy.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Aggregation */}
              <div>
                <Label className="text-sm font-medium text-gray-900 mb-2 block">Aggregate data by</Label>
                <Select value={imp.aggregation} onValueChange={(v: AggregationPeriod) => imp.setAggregation(v)}>
                  <SelectTrigger className="h-11 rounded-sm border-gray-300 [&>span]:text-left [&>span]:pl-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[10000] rounded-sm">
                    {AGGREGATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* V2: Privacy Controls */}
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <div>
                  <div className="text-sm text-gray-700">Delete file after import</div>
                  <div className="text-xs text-gray-400">File won&apos;t be stored on our servers</div>
                </div>
                <button
                  onClick={() => imp.setDeleteFileAfterParsing(!imp.deleteFileAfterParsing)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    imp.deleteFileAfterParsing ? "bg-green-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      imp.deleteFileAfterParsing ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Advanced Options - Collapsed by default */}
              {imp.selectedSource === "csv" && previewData.detected_columns && (
                <details className="group">
                  <summary className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer hover:text-gray-700 select-none">
                    <ChevronDown className="w-3 h-3 -rotate-90 group-open:rotate-0 transition-transform" />
                    <span>Advanced Options</span>
                    <span className="text-xs text-gray-400">(Column mapping usually not needed)</span>
                  </summary>
                  
                  <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                    <p className="text-xs text-gray-400 italic">
                      Smart matching will automatically map CSV columns to your existing habits. 
                      Only use these options if you need to override the automatic detection.
                    </p>
                    
                    <div>
                      <Label className="text-xs text-gray-500 mb-1 block">Date Column</Label>
                      <Select 
                        value={imp.csvMapping.dateColumn} 
                        onValueChange={(v) => imp.setCsvMapping(prev => ({ ...prev, dateColumn: v }))}
                      >
                        <SelectTrigger className="h-9 rounded-sm border-gray-300 text-sm">
                          <SelectValue placeholder="Auto-detected" />
                        </SelectTrigger>
                        <SelectContent className="z-[10000] rounded-sm">
                          {previewData.detected_columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {imp.csvMapping.valueColumns.length > 0 && imp.csvMapping.valueColumns.map((vc, i) => (
                      <div key={i} className="grid grid-cols-3 gap-2">
                        <Select 
                          value={vc.column}
                          onValueChange={(v) => {
                            const updated = [...imp.csvMapping.valueColumns];
                            updated[i] = { ...updated[i], column: v, habitName: v };
                            imp.setCsvMapping(prev => ({ ...prev, valueColumns: updated }));
                          }}
                        >
                          <SelectTrigger className="h-8 rounded-sm border-gray-300 text-sm">
                            <SelectValue placeholder="Column" />
                          </SelectTrigger>
                          <SelectContent className="z-[10000] rounded-sm">
                            {previewData.detected_columns?.map((col) => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <input
                          type="text"
                          value={vc.habitName}
                          onChange={(e) => {
                            const updated = [...imp.csvMapping.valueColumns];
                            updated[i] = { ...updated[i], habitName: e.target.value };
                            imp.setCsvMapping(prev => ({ ...prev, valueColumns: updated }));
                          }}
                          placeholder="Habit name"
                          className="px-3 py-1.5 border border-gray-300 text-sm h-8 focus:outline-none focus:border-gray-400"
                        />
                        <input
                          type="text"
                          value={vc.unit}
                          onChange={(e) => {
                            const updated = [...imp.csvMapping.valueColumns];
                            updated[i] = { ...updated[i], unit: e.target.value };
                            imp.setCsvMapping(prev => ({ ...prev, valueColumns: updated }));
                          }}
                          placeholder="Unit"
                          className="px-3 py-1.5 border border-gray-300 text-sm h-8 focus:outline-none focus:border-gray-400"
                        />
                      </div>
                    ))}
                    
                    <button
                      onClick={() => imp.setCsvMapping(prev => ({
                        ...prev,
                        valueColumns: [...prev.valueColumns, { column: "", habitName: "", unit: "" }]
                      }))}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      + Add column override
                    </button>
                  </div>
                </details>
              )}

              {/* Sample Data Preview */}
              {/* Sample Data with V2 Diff View */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium text-gray-900">Sample Data</Label>
                  {previewData.sample_items.length > 5 && (
                    <button
                      onClick={() => imp.setShowAllItems(!imp.showAllItems)}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      {imp.showAllItems ? "Show less" : `Show all ${previewData.sample_items.length}`}
                    </button>
                  )}
                </div>
                <div className="border border-gray-200 max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-white sticky top-0 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Habit</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Value</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(imp.showAllItems ? previewData.sample_items : previewData.sample_items.slice(0, 5)).map((item, i) => (
                        <tr 
                          key={i} 
                          className={`border-t border-gray-100 ${
                            item.conflict_status === "conflict" ? "bg-amber-50" : 
                            item.conflict_status === "semantic_duplicate" ? "bg-blue-50" : ""
                          }`}
                        >
                          <td className="px-3 py-2">
                            <span className="text-gray-900">{item.habit_name || item.habit_key}</span>
                            {item.confidence && item.confidence.score < 0.7 && (
                              <span className="ml-1 text-amber-500 cursor-help" title={item.confidence.reasons?.join(", ") || "Low confidence"}>⚠️</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{item.date}</td>
                          <td className="px-3 py-2 text-right">
                            {item.conflict_detail && item.conflict_status === "conflict" ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-gray-400 line-through">{item.conflict_detail.existing_value?.toLocaleString()}</span>
                                <span className="text-gray-400">→</span>
                                <span className="text-gray-900 font-medium">{item.amount?.toLocaleString()}</span>
                                {item.conflict_detail.diff_percent != null && (
                                  <span className={`text-xs ${item.conflict_detail.diff_percent > 50 ? "text-red-500" : "text-amber-500"}`}>
                                    ({item.conflict_detail.diff_percent > 0 ? "+" : ""}{item.conflict_detail.diff_percent.toFixed(1)}%)
                                  </span>
                                )}
                              </div>
                            ) : item.conflict_status === "semantic_duplicate" ? (
                              <span className="text-gray-400">≈ {item.amount?.toLocaleString()}</span>
                            ) : (
                              <span className="text-gray-900">
                                {item.amount?.toLocaleString()}{item.unit_type && <span className="text-gray-400 ml-1">{item.unit_type}</span>}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {item.conflict_status === "conflict" ? (
                              <span className="text-amber-500 text-xs font-medium">UPDATE</span>
                            ) : item.conflict_status === "duplicate" || item.conflict_status === "semantic_duplicate" ? (
                              <span className="text-gray-400 text-xs">SKIP</span>
                            ) : item.validation_status === "ok" ? (
                              <Check className="w-3.5 h-3.5 text-green-500 mx-auto" />
                            ) : item.validation_status === "warning" ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mx-auto" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Validation Issues */}
              {previewData.validation_issues.length > 0 && (
                <div className="bg-red-50 border border-red-200 p-3 rounded-none">
                  <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    {previewData.validation_issues.length} items have issues
                  </div>
                  <ul className="text-xs text-red-600 space-y-1">
                    {previewData.validation_issues.slice(0, 3).map((item, i) => (
                      <li key={i}>
                        Row {item.row_index}: {item.validation_messages?.[0]?.message || "Invalid data"}
                      </li>
                    ))}
                    {previewData.validation_issues.length > 3 && (
                      <li className="text-red-500">...and {previewData.validation_issues.length - 3} more</li>
                    )}
                  </ul>
                </div>
              )}

              {imp.error && (
                <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 p-3 border border-red-200">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{imp.error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={imp.handleClose}
                  className="px-4 py-2 text-sm font-normal text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={imp.handleStartImport}
                  disabled={imp.isLoading || previewData.dedupe_estimate.new_items === 0}
                  className="px-5 py-2 text-sm font-normal text-white bg-black rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Import {previewData.dedupe_estimate.new_items.toLocaleString()} Records
                </button>
              </div>
            </div>

  );
}
