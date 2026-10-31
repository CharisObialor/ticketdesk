import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Clock, Headset, Loader2, MailCheck, MessagesSquare, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { BrandLogo, Footer } from '@/components/common';
import { PasswordChecklist, PasswordInput } from '@/components/password-input';
import { passwordOk } from '@/lib/password';
import { FullPageLoader } from '@/components/app-layout';
import { useSession } from '@/hooks/use-session';
import { api, errorMessage } from '@/lib/api';

type Mode = 'signin' | 'forgot' | 'sent' | 'token';

function safeNext(next: string | null) {
  // Same-site paths only: "//host" and "/\host" are both read by browsers as another website.
  return next && /^\/(?![/\\])/.test(next) && !/[\\\u0000-\u001f]/.test(next) ? next : '/';
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user, loading } = useSession();
  const [mode, setMode] = useState<Mode>(token ? 'token' : 'signin');

  if (loading) return <FullPageLoader />;
  if (user && mode !== 'token') return <Navigate to={safeNext(params.get('next'))} replace />;

  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-4 py-10">
      <LoginBackground />
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Link to="/login" className="flex flex-col items-center text-center">
          <BrandLogo className="h-16 sm:h-[4.5rem]" />
        </Link>
        <Card className="w-full border-border/60 bg-card/85 shadow-xl shadow-black/5 backdrop-blur-md dark:shadow-black/30">
          <CardContent className="px-6 sm:px-8">
            {mode === 'signin' && <SignInForm onForgot={() => setMode('forgot')} />}
            {mode === 'forgot' && <ForgotForm onBack={() => setMode('signin')} onSent={() => setMode('sent')} />}
            {mode === 'sent' && <SentNotice onBack={() => setMode('signin')} />}
            {mode === 'token' && token && <TokenForm token={token} onInvalid={() => setMode('forgot')} />}
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {[
            { icon: ShieldCheck, text: 'Secure sign-in' },
            { icon: MessagesSquare, text: 'Live support chat' },
            { icon: Headset, text: 'Dedicated support team' },
          ].map(({ icon: Icon, text }) => (
            <span key={text} className="flex items-center gap-1.5">
              <Icon className="size-3.5" />
              {text}
            </span>
          ))}
        </div>
        <Footer />
      </div>
    </div>
  );
}

// One period (600 units) of a gentle wave, repeated twice so sliding it left by 600 loops seamlessly.
const wavePath = (y: number, amp: number) => `M0 ${y} Q 150 ${y - amp} 300 ${y} T 600 ${y} T 900 ${y} T 1200 ${y}`;

// Full-page backdrop: drifting colour washes, a fading grid and slowly moving line-art shapes, all in theme colours.
// Shapes hug the edges on phones so they frame the form instead of sitting behind it. Motion stops for reduced-motion users.
function LoginBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-background to-background" />
      <div className="bg-anim-drift absolute inset-x-0 -top-32 mx-auto size-[26rem] rounded-full bg-primary/15 blur-3xl sm:-top-40 sm:size-[42rem]" />
      <div className="bg-anim-drift-alt absolute -bottom-32 -left-32 size-[20rem] rounded-full bg-chart-2/10 blur-3xl sm:-bottom-48 sm:size-[30rem]" />
      <div className="bg-anim-drift absolute -right-24 bottom-24 size-[16rem] rounded-full bg-chart-4/10 blur-3xl [animation-delay:-9s] sm:bottom-10 sm:size-[24rem]" />

      <svg className="absolute inset-0 size-full text-foreground/[0.07] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]">
        <defs>
          <pattern id="login-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#login-grid)" />
      </svg>

      {/* Concentric rings with orbiting dots, top right */}
      <svg className="absolute -top-20 -right-24 size-64 text-primary/20 sm:-top-24 sm:size-[28rem]" viewBox="0 0 400 400" fill="none">
        {[60, 100, 140, 180].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} stroke="currentColor" strokeWidth="1" />
        ))}
        <circle className="bg-anim-spin-reverse" cx="200" cy="200" r="196" stroke="currentColor" strokeWidth="1" strokeDasharray="2 8" />
        {/* The invisible circle centres the group's box on the rings so the dot orbits around them. */}
        <g className="bg-anim-spin">
          <circle cx="200" cy="200" r="185" fill="none" stroke="none" />
          <circle cx="380" cy="200" r="5" fill="currentColor" />
        </g>
        <g className="bg-anim-spin-reverse">
          <circle cx="200" cy="200" r="143.5" fill="none" stroke="none" />
          <circle cx="200" cy="60" r="3.5" fill="currentColor" />
        </g>
      </svg>

      {/* Flowing waves along the bottom edge */}
      <svg className="absolute bottom-0 left-0 h-28 w-full text-primary/20 sm:h-48 sm:w-[40rem]" viewBox="0 0 600 160" fill="none" preserveAspectRatio="none">
        <g className="bg-anim-wave">
          <path d={wavePath(70, 30)} stroke="currentColor" strokeWidth="1" />
          <path d={wavePath(95, 24)} stroke="currentColor" strokeWidth="1" />
        </g>
        <g className="bg-anim-wave-slow">
          <path d={wavePath(120, 18)} stroke="currentColor" strokeWidth="1" />
          <path d={wavePath(142, 12)} stroke="currentColor" strokeWidth="1" />
        </g>
      </svg>

      {/* Rotated rounded squares, top left */}
      <svg className="bg-anim-float absolute top-[5%] -left-4 size-20 text-primary/25 sm:top-[18%] sm:left-[8%] sm:size-28" viewBox="0 0 100 100" fill="none">
        <rect x="18" y="18" width="64" height="64" rx="14" stroke="currentColor" strokeWidth="1.2" transform="rotate(12 50 50)" />
        <rect className="bg-anim-spin" x="32" y="32" width="36" height="36" rx="8" stroke="currentColor" strokeWidth="1.2" />
      </svg>

      {/* Dot grid, bottom right */}
      <svg className="bg-anim-float-alt absolute right-[4%] bottom-[12%] size-16 text-foreground/15 sm:right-[10%] sm:bottom-[22%] sm:size-24" viewBox="0 0 100 100" fill="currentColor">
        {[0, 1, 2, 3, 4].flatMap((y) => [0, 1, 2, 3, 4].map((x) => <circle key={`${x}-${y}`} cx={10 + x * 20} cy={10 + y * 20} r="2" />))}
      </svg>

      {/* Small accents */}
      <svg className="bg-anim-twinkle absolute top-[3%] left-[45%] size-5 text-primary/50 sm:top-[12%] sm:right-[22%] sm:left-auto sm:size-6" viewBox="0 0 24 24" fill="none">
        <path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <svg className="bg-anim-twinkle absolute bottom-[20%] left-[6%] size-4 text-chart-2/70 [animation-delay:-2s] sm:bottom-[30%] sm:left-[16%] sm:size-5" viewBox="0 0 24 24" fill="none">
        <path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <svg className="bg-anim-float absolute top-[42%] right-[2%] size-7 text-chart-4/50 [animation-delay:-4s] sm:top-[60%] sm:right-[6%] sm:size-10" viewBox="0 0 40 40" fill="none">
        <path d="M20 4 36 32H4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <svg className="bg-anim-float-alt absolute top-[36%] left-[3%] size-6 text-primary/30 sm:top-[48%] sm:left-[22%] sm:size-8" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </div>
  );
}

function FormHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6 space-y-2 text-center">
      <h1 className="type-h2">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function SignInForm({ onForgot }: { onForgot: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <FormHeader title="Sign in to your account" description="Enter your email address and password to continue." />
      {!error && params.get('reason') === 'idle' && (
        <Alert>
          <Clock />
          <AlertDescription>You were signed out because there was no activity for a while. Please sign in again to continue.</AlertDescription>
        </Alert>
      )}
      {error && <ErrorAlert message={error} />}
      <div className="grid gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" type="email" autoComplete="email" placeholder="name@company.com" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <button type="button" onClick={onForgot} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
          </button>
        </div>
        <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">Accounts are created by our support team. Contact us if you need access.</p>
    </form>
  );
}

function ForgotForm({ onBack, onSent }: { onBack: () => void; onSent: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot', { email });
      onSent();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <FormHeader title="Reset your password" description="Enter the email address on your account and we will send you a reset link." />
      {error && <ErrorAlert message={error} />}
      <div className="grid gap-2">
        <Label htmlFor="forgot-email">Email address</Label>
        <Input id="forgot-email" type="email" autoComplete="email" placeholder="name@company.com" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        Send reset link
      </Button>
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft />
        Back to sign in
      </Button>
    </form>
  );
}

function SentNotice({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid gap-5 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <MailCheck className="size-5" />
      </div>
      <FormHeader
        title="Check your email"
        description="If an account exists for that address, we have sent a link to reset your password. The link expires in 1 hour."
      />
      <Button variant="outline" onClick={onBack}>
        <ArrowLeft />
        Back to sign in
      </Button>
    </div>
  );
}

function TokenForm({ token, onInvalid }: { token: string; onInvalid: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ name: string; email: string; isNew: boolean } | null>(null);
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ name: string; email: string; isNew: boolean }>(`/auth/token?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) => setLinkError(errorMessage(err)));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passwordOk(password, info ?? undefined)) return setError('Choose a password that meets all the requirements below');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset', { token, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (linkError) {
    return (
      <div className="grid gap-5">
        <FormHeader title="Link expired" description="This password link is invalid or has expired." />
        <ErrorAlert message={linkError} />
        <Button onClick={onInvalid}>Request a new link</Button>
        <Button variant="ghost" asChild>
          <Link to="/login">
            <ArrowLeft />
            Back to sign in
          </Link>
        </Button>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <FormHeader
        title={info.isNew ? 'Set up your account' : 'Choose a new password'}
        description={info.isNew ? `Welcome, ${info.name}. Create a password to activate your account.` : `Enter a new password for ${info.email}.`}
      />
      {error && <ErrorAlert message={error} />}
      <div className="grid gap-2">
        <Label htmlFor="account-email">Email address</Label>
        <Input id="account-email" value={info.email} disabled />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="new-password">New password</Label>
        <PasswordInput id="new-password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordChecklist password={password} email={info.email} name={info.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <PasswordInput id="confirm-password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {info.isNew ? 'Activate account' : 'Update password'}
      </Button>
    </form>
  );
}
