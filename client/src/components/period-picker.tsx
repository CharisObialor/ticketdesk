import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useIsMobile } from '@/hooks/use-mobile';

// A reporting period: a preset number of days, or a custom from-to range (YYYY-MM-DD, inclusive).
export type Period = { days: string } | { from: string; to: string };

const PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

// Calendar dates are local; the API takes plain YYYY-MM-DD strings.
const toKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const periodQuery = (p: Period) => ('days' in p ? `days=${p.days}` : `from=${p.from}&to=${p.to}`);
export const periodKey = (p: Period) => ('days' in p ? p.days : `${p.from}_${p.to}`);

const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const periodLabel = (p: Period) =>
  'days' in p ? (PRESETS.find((x) => x.value === p.days)?.label ?? `Last ${p.days} days`) : `${fmt.format(fromKey(p.from))} to ${fmt.format(fromKey(p.to))}`;

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const isMobile = useIsMobile();
  const custom = !('days' in value);
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(() => {
    if (custom) return { from: fromKey(value.from), to: fromKey(value.to) };
    const to = startOfToday();
    return { from: new Date(to.getTime() - 29 * 864e5), to };
  });
  const valid = !!range?.from && !!range?.to;

  function apply() {
    if (!range?.from || !range.to) return;
    onChange({ from: toKey(range.from), to: toKey(range.to) });
    setOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={custom || open ? 'custom' : value.days}
        onValueChange={(v) => {
          if (v === 'custom') setOpen(true);
          else onChange({ days: v });
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className={custom ? 'font-normal' : 'font-normal text-muted-foreground'}>
            <CalendarRange />
            {custom ? periodLabel(value) : 'Pick dates'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={range}
            onSelect={setRange}
            numberOfMonths={isMobile ? 1 : 2}
            defaultMonth={range?.from}
            disabled={{ after: startOfToday() }}
            captionLayout="dropdown"
            startMonth={new Date(2020, 0)}
            endMonth={startOfToday()}
          />
          <div className="flex items-center justify-between gap-3 border-t p-3">
            <span className="text-sm text-muted-foreground">
              {range?.from ? fmt.format(range.from) : 'Start date'} to {range?.to ? fmt.format(range.to) : 'end date'}
            </span>
            <Button size="sm" onClick={apply} disabled={!valid}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
