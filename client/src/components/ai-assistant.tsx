import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface AiInsight {
  summary: string;
  next_step: string;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  sentiment: 'positive' | 'neutral' | 'frustrated' | 'angry';
  risks: string[];
  draft_reply: string;
  created_at: string;
  model?: string;
  provider?: 'builtin' | 'ollama' | 'claude';
  stale?: boolean;
  fallback?: string;
  used_saved_reply?: string | null;
}

const URGENCY_STYLE: Record<AiInsight['urgency'], string> = {
  low: 'text-muted-foreground',
  normal: '',
  high: 'border-orange-500/50 text-orange-700 dark:text-orange-400',
  critical: 'border-red-500/50 text-red-700 dark:text-red-400',
};
const MOOD_STYLE: Record<AiInsight['sentiment'], string> = {
  positive: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400',
  neutral: '',
  frustrated: 'border-orange-500/50 text-orange-700 dark:text-orange-400',
  angry: 'border-red-500/50 text-red-700 dark:text-red-400',
};

// Sends a drafted reply to the reply box on the ticket page.
export const sendDraftToComposer = (ticketId: number, text: string) =>
  window.dispatchEvent(new CustomEvent('ticket-draft', { detail: { ticketId, text } }));

export function AiInsightPanel({ ticketId, autoRun = false, onUseDraft }: { ticketId: number; autoRun?: boolean; onUseDraft?: (text: string) => void }) {
  const qc = useQueryClient();
  const stored = useQuery({
    queryKey: ['ai', ticketId],
    queryFn: () => api.get<{ enabled: boolean; provider: AiInsight['provider']; insight: AiInsight | null }>(`/tickets/${ticketId}/ai`),
  });
  const run = useMutation({
    mutationFn: (force: boolean) => api.post<{ insight: AiInsight; cached: boolean }>(`/tickets/${ticketId}/ai`, { force }),
    onSuccess: (r, force) => {
      qc.setQueryData(['ai', ticketId], { enabled: true, provider: r.insight.provider, insight: { ...r.insight, stale: false } });
      if (force) toast.success(r.insight.provider === 'builtin' ? 'Assistant refreshed' : 'New analysis ready');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const insight = stored.data?.insight;

  // From the Actions page, analyse straight away unless a current analysis exists.
  useEffect(() => {
    if (autoRun && stored.data && (!insight || insight.stale) && !run.isPending && !run.isSuccess) run.mutate(false);
  }, [autoRun, stored.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stored.isPending) return <div className="h-16 animate-pulse rounded-md bg-muted" />;
  if (!stored.data?.enabled) return null;

  if (!insight) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-3 text-sm">
        <p className="text-muted-foreground">Get a summary of this ticket, the suggested next step, risks to watch and a drafted reply.</p>
        <Button size="sm" onClick={() => run.mutate(false)} disabled={run.isPending}>
          {run.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {run.isPending ? 'Analysing...' : 'Analyse ticket'}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3 text-sm', run.isPending && 'opacity-60')}>
      {insight.stale && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          New messages since this analysis.
          <Button size="xs" variant="outline" onClick={() => run.mutate(false)} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Update
          </Button>
        </div>
      )}
      <p>{insight.summary}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={URGENCY_STYLE[insight.urgency]}>
          Urgency: {insight.urgency}
        </Badge>
        <Badge variant="outline" className={MOOD_STYLE[insight.sentiment]}>
          Client mood: {insight.sentiment}
        </Badge>
      </div>
      <div className="rounded-md bg-primary/5 px-3 py-2">
        <div className="text-xs font-medium text-primary">Suggested next step</div>
        <p>{insight.next_step}</p>
      </div>
      {insight.risks.length > 0 && (
        <ul className="space-y-1">
          {insight.risks.map((r) => (
            <li key={r} className="flex items-start gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-orange-600" />
              {r}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Drafted reply</div>
        <p className="max-h-48 overflow-y-auto rounded-md border bg-background px-3 py-2 text-xs whitespace-pre-wrap">{insight.draft_reply}</p>
        <div className="flex flex-wrap gap-2">
          {onUseDraft && (
            <Button size="xs" onClick={() => onUseDraft(insight.draft_reply)}>
              Use this draft
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(insight.draft_reply).then(() => toast.success('Draft copied'))}
          >
            <ClipboardCopy />
            Copy
          </Button>
          <Button size="xs" variant="ghost" onClick={() => run.mutate(true)} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {run.isPending ? 'Refreshing...' : insight.provider === 'builtin' ? 'Refresh' : 'Regenerate'}
          </Button>
        </div>
      </div>
      {insight.fallback && <p className="text-[11px] text-amber-700 dark:text-amber-400">{insight.fallback}, so the built-in assistant answered instead.</p>}
      {insight.used_saved_reply && <p className="text-[11px] text-muted-foreground">Draft based on your saved reply "{insight.used_saved_reply}".</p>}
      <p className="text-[11px] text-muted-foreground">
        {insight.provider === 'builtin'
          ? `Worked out by the built-in assistant from this ticket${insight.created_at ? `, updated ${timeAgo(insight.created_at)}` : ''}. Fill in any [brackets] and check before sending.`
          : `AI suggestion (${insight.provider === 'ollama' ? 'your own model' : 'Claude'}) from ${timeAgo(insight.created_at)}. Check before sending; it can make mistakes.`}
      </p>
    </div>
  );
}

// Sidebar card on the ticket page (admins, when the AI assistant is set up).
export function AiAssistantCard({ ticketId }: { ticketId: number }) {
  return (
    <Card className="gap-3 border-primary/30">
      <CardHeader>
        <CardTitle className="type-h5 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          Assistant
        </CardTitle>
        <CardDescription className="text-xs">Admins only</CardDescription>
        <CardAction />
      </CardHeader>
      <CardContent>
        <AiInsightPanel ticketId={ticketId} onUseDraft={(text) => sendDraftToComposer(ticketId, text)} />
      </CardContent>
    </Card>
  );
}
