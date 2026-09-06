'use client';

import {
  canonicalEntityType,
  formatEntityMentionToken,
  insertEntityMentionToken,
  type EntitySummary,
} from '@ritual/shared-contracts';
import { EntityMentionTypeahead, mentionQueryFromInput } from '@/components/entities/entity-link-picker';
import { LiveEntityPill } from '@/components/entities/live-entity-pill';
import { entityProtocolEnabled } from '@/lib/entities/feature-flag';
import { rememberEntitySummary } from '@/lib/entities/resolve';

export type ChatComposerEntityRef = { type: string; id: string; title?: string };

export function applyEntityMention(input: string, summary: EntitySummary): string {
  return insertEntityMentionToken(input, summary.ref);
}

function removeMentionToken(input: string, type: string, id: string): string {
  const canonical = canonicalEntityType(type);
  if (!canonical) return input;
  const token = formatEntityMentionToken({ type: canonical, id });
  return input.split(token).join('').replace(/[ \t]{2,}/g, ' ');
}

export function ChatComposerEntityExtras({
  input,
  attached,
  onAttachedChange,
  onInputChange,
}: {
  input: string;
  attached: ChatComposerEntityRef[];
  onAttachedChange: (next: ChatComposerEntityRef[]) => void;
  onInputChange: (value: string) => void;
}) {
  if (!entityProtocolEnabled()) return null;
  const mentionQuery = mentionQueryFromInput(input);

  return (
    <div className="px-4 pb-1">
      {attached.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attached.map((ref) => {
            const type = canonicalEntityType(ref.type);
            if (!type) return null;
            return (
              <button
                key={`${type}:${ref.id}`}
                type="button"
                onClick={() => {
                  onAttachedChange(attached.filter((item) => item.type !== ref.type || item.id !== ref.id));
                  onInputChange(removeMentionToken(input, type, ref.id));
                }}
                aria-label={`Remove ${ref.title || ref.type}`}
              >
                <LiveEntityPill entityRef={{ type, id: ref.id }} disableLink />
              </button>
            );
          })}
        </div>
      ) : null}
      {mentionQuery !== null ? (
        <EntityMentionTypeahead
          query={mentionQuery}
          onSelect={(summary) => {
            rememberEntitySummary(summary);
            onAttachedChange([
              ...attached.filter((item) => item.type !== summary.ref.type || item.id !== summary.ref.id),
              { type: summary.ref.type, id: summary.ref.id, title: summary.title },
            ]);
            onInputChange(applyEntityMention(input, summary));
          }}
        />
      ) : null}
    </div>
  );
}
