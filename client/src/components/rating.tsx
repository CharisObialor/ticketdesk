import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Rating, Ticket } from '@/lib/types';

const LABELS = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];

export function Stars({ value, size = 'size-4', className }: { value: number; size?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn(size, n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
      ))}
    </span>
  );
}

// Client-facing card asking for a 1-5 rating once the ticket is resolved. Links in the
// "resolved" email open the ticket with ?rate=N, which pre-selects that score.
export function RatingCard({ ticket, rating }: { ticket: Ticket; rating: Rating | null }) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const fromEmail = Number(params.get('rate'));
  const [value, setValue] = useState(rating?.rating ?? (fromEmail >= 1 && fromEmail <= 5 ? fromEmail : 0));
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(rating?.comment ?? '');
  const [editing, setEditing] = useState(!rating);

  useEffect(() => {
    if (params.has('rate')) {
      const next = new URLSearchParams(params);
      next.delete('rate');
      setParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.post<{ rating: Rating }>(`/tickets/${ticket.id}/rating`, { rating: value, comment }),
    onSuccess: () => {
      toast.success('Thank you for your feedback');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['ticket', ticket.id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (rating && !editing) {
    return (
      <Card className="gap-2 border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/5">
        <CardContent className="flex flex-wrap items-center gap-3">
          <Stars value={rating.rating} />
          <span className="text-sm">
            You rated this ticket <span className="font-medium">{LABELS[rating.rating].toLowerCase()}</span>
            {rating.comment && <span className="text-muted-foreground"> - "{rating.comment}"</span>}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
            Change rating
          </Button>
        </CardContent>
      </Card>
    );
  }

  const shown = hover || value;
  return (
    <Card className="gap-4 border-primary/30">
      <CardHeader>
        <CardTitle>How did we do?</CardTitle>
        <CardDescription>Rate the support you received on this ticket. Your feedback helps us improve.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                aria-label={`${n} - ${LABELS[n]}`}
                onMouseEnter={() => setHover(n)}
                onClick={() => setValue(n)}
                className="rounded-md p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Star className={cn('size-7 transition-colors', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
              </button>
            ))}
          </div>
          <span className="text-sm font-medium text-muted-foreground">{shown ? LABELS[shown] : 'Select a rating'}</span>
        </div>
        {value > 0 && (
          <Textarea
            rows={3}
            maxLength={2000}
            placeholder={value <= 3 ? 'What could we have done better? (optional)' : 'Anything you would like to add? (optional)'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
        <div className="flex gap-2">
          <Button disabled={!value || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Submit feedback
          </Button>
          {rating && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StaffRatingCard({ rating }: { rating: Rating }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="type-h5">Client rating</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Stars value={rating.rating} />
          <span className="font-medium">{LABELS[rating.rating]}</span>
        </div>
        {rating.comment && <p className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground">"{rating.comment}"</p>}
        <p className="text-xs text-muted-foreground">
          {rating.user_name ?? 'Client'} · {timeAgo(rating.updated_at)}
        </p>
      </CardContent>
    </Card>
  );
}
