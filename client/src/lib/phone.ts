// Phone number for wa.me, sms: and tel: links. Nigerian local numbers (0803...) get the 234 country code.
export function international(phone: string) {
  let d = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+')) return d;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0') && d.length === 11) d = `234${d.slice(1)}`;
  return d;
}
