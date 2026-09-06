'use client';

import { useState } from 'react';
import { ShieldX } from 'lucide-react';

import {
  EXTERNAL_ERASURE_TARGET_LABELS,
  SUPPORTED_EXTERNAL_ERASURE_TARGETS,
  executeExternalErasure,
  planExternalErasure,
  type ExternalErasurePlan,
  type ExternalErasureResult,
  type ExternalErasureTarget,
} from '@/lib/privacy/external-erasure';
import {
  vaultSync,
  type DesktopVaultStatus,
} from '@/lib/privacy/vault-sync';
import {
  SettingsGroup,
  SettingsRow,
} from '@/components/ui/ritual-system';
import { cn } from '@/lib/utils';

type Props = {
  userId?: string | null;
  onVaultStatus: (status: DesktopVaultStatus | null) => void;
};

export function PrivacyExternalErasureSection({ userId, onVaultStatus }: Props) {
  const [selectedTargets, setSelectedTargets] = useState<ExternalErasureTarget[]>([
    'private_sync_envelopes',
    'tinybird',
    'openpanel',
    'sentry',
    'external_providers',
  ]);
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState<ExternalErasurePlan | null>(null);
  const [result, setResult] = useState<ExternalErasureResult | null>(null);

  const toggleTarget = (target: ExternalErasureTarget) => {
    setSelectedTargets((current) => (
      current.includes(target)
        ? current.filter((item) => item !== target)
        : [...current, target]
    ));
  };

  const runPlan = async () => {
    try {
      setMessage('Planning external erasure...');
      const response = await planExternalErasure({ targets: selectedTargets });
      setPlan(response);
      const manualCount = response.targets.filter((target) => target.status === 'manual_required').length;
      setMessage(`${response.targets.length} targets planned; ${manualCount} require provider follow-up.`);
    } catch {
      setMessage('External erasure plan could not be loaded.');
    }
  };

  const runErasure = async () => {
    if (!userId) return;
    try {
      setMessage('Running external erasure...');
      const response = await executeExternalErasure({
        userId,
        targets: selectedTargets,
      });
      setResult(response);
      onVaultStatus(await vaultSync.getStatus(userId));
      setMessage(
        `External erasure completed with ${response.response.deleted_count} API deletions and ${response.response.manual_required_count} manual targets.`,
      );
    } catch {
      setMessage('External erasure could not be completed.');
    }
  };

  return (
    <section>
      <h2 className="mb-2.5 text-[13px] font-semibold leading-none text-[#2b2b2b]">External erasure</h2>
      <SettingsGroup>
        <SettingsRow>
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#9f2d20]/10 text-[#9f2d20]">
                <ShieldX className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium leading-tight text-[var(--text-primary)]">
                  Processor and index erasure receipts
                </p>
                <p className="mt-0.5 max-w-[390px] text-[11px] leading-snug text-[var(--text-muted)]">
                  API-backed targets are erased directly. Targets without a trusted API are saved as manual-required receipt items.
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUPPORTED_EXTERNAL_ERASURE_TARGETS.map((target) => {
                const selected = selectedTargets.includes(target);
                return (
                  <button
                    key={target}
                    type="button"
                    onClick={() => toggleTarget(target)}
                    className={cn(
                      'h-6 rounded-[7px] border px-2 text-[11px] font-medium transition-colors',
                      selected
                        ? 'border-[#9f2d20] bg-[#9f2d20] text-white'
                        : 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]',
                    )}
                  >
                    {EXTERNAL_ERASURE_TARGET_LABELS[target]}
                  </button>
                );
              })}
            </div>
            {message ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{message}</p>
            ) : null}
            {plan ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Last plan: {plan.targets.filter((target) => target.status === 'supported_by_api').length} API targets, {plan.targets.filter((target) => target.status === 'manual_required').length} manual targets.
              </p>
            ) : null}
            {result ? (
              <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                Last erasure receipt: {result.response.deleted_count} deleted, {result.erasureId.slice(0, 24)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={runPlan}
              disabled={selectedTargets.length === 0}
              className={cn(
                'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                selectedTargets.length > 0
                  ? 'border-black/10 bg-white text-[#3f3f3f] hover:bg-[#f3f3f1]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              Plan
            </button>
            <button
              type="button"
              onClick={runErasure}
              disabled={!userId || selectedTargets.length === 0}
              className={cn(
                'h-7 rounded-[7px] border px-3 text-[12px] font-medium transition-colors',
                userId && selectedTargets.length > 0
                  ? 'border-[#9f2d20] bg-[#9f2d20] text-white hover:bg-[#8b271c]'
                  : 'border-black/10 bg-black/5 text-[#9a9a96]',
              )}
            >
              Erase
            </button>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </section>
  );
}
