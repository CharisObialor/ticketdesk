import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Local date and time as "YYYY-MM-DDTHH:mm" (the same shape as a datetime-local input).
const pad = (n: number) => String(n).padStart(2, '0');
const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function split(value: string) {
  const [d, t = '09:00'] = value.split('T');
  const [y, m, day] = (d || '').split('-').map(Number);
  return { date: y ? new Date(y, m - 1, day) : undefined, time: t.slice(0, 5) };
}

// shadcn date and time picker: a calendar in a popover for the day, beside a time field.
export function DateTimePicker({
  id,
  value,
  onChange,
  fromDate,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  fromDate?: Date;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { date, time } = split(value);
  const set = (d: Date | undefined, t: string) => d && onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${t}`);

  return (
    <div className={cn('flex gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="min-w-0 flex-1 justify-between font-normal">
            <span className={cn('truncate', !date && 'text-muted-foreground')}>{date ? dateLabel.format(date) : 'Select date'}</span>
            <ChevronDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            captionLayout="dropdown"
            disabled={fromDate ? { before: fromDate } : undefined}
            onSelect={(d) => {
              set(d, time);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        aria-label="Time"
        required
        value={time}
        onChange={(e) => set(date ?? new Date(), e.target.value || time)}
        className="w-28 appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
      />
    </div>
  );
}
