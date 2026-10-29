// Mirrors the server rule in src/password.js so people see what is missing while they type.
export const MIN_LENGTH = 10;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty', 'qwerty123', 'qwertyuiop', 'letmein',
  'welcome', 'welcome1', 'welcome123', 'admin', 'admin123', 'admin1234', 'administrator', 'iloveyou', 'abc123',
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000', 'football', 'monkey', 'dragon',
  'sunshine', 'princess', 'trustno1', 'changeme', 'support', 'support123', 'dateheight', 'dateheight123',
]);

export interface PasswordCheck {
  label: string;
  met: boolean;
}

export function passwordChecks(pw: string, { email, name }: { email?: string | null; name?: string | null } = {}): PasswordCheck[] {
  const lower = pw.toLowerCase();
  const bare = lower.replace(/[^a-z0-9]/g, '');
  const personal = [String(email || '').split('@')[0], ...String(name || '').split(/\s+/)].map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
  return [
    { label: `At least ${MIN_LENGTH} characters`, met: pw.length >= MIN_LENGTH },
    { label: 'Upper and lowercase letters', met: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: 'A number', met: /[0-9]/.test(pw) },
    { label: 'A symbol such as ! @ # or ?', met: /[^A-Za-z0-9]/.test(pw) },
    {
      label: 'Not a common password or your name',
      met: !!pw && !COMMON.has(lower) && !COMMON.has(bare) && !COMMON.has(bare.replace(/\d+$/, '')) && !personal.some((p) => lower.includes(p)),
    },
  ];
}

export const passwordOk = (pw: string, who?: { email?: string | null; name?: string | null }) => passwordChecks(pw, who).every((c) => c.met);
