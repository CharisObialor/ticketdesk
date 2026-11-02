// @mentions in chat messages. The message box writes a tagged person as "@Full Name"; this finds which of the
// people in the conversation a message names. Longer names are matched first, so "@Ada Obi" is not also "@Ada".
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentioned(body, people) {
  let text = String(body || '');
  if (!text.includes('@')) return [];
  const found = [];
  const byLength = people.filter((p) => p && String(p.name || '').trim()).sort((a, b) => b.name.trim().length - a.name.trim().length);
  for (const p of byLength) {
    const re = new RegExp(`(^|[^\\w@])@${escape(p.name.trim())}(?!\\w)`, 'gi');
    if (!re.test(text)) continue;
    found.push(p);
    text = text.replace(re, '$1');
  }
  return found;
}

// People named in the new text who were not named before (for edits), never the author.
function newlyMentioned(before, after, people, authorId) {
  const had = new Set(mentioned(before, people).map((p) => Number(p.id)));
  return mentioned(after, people).filter((p) => Number(p.id) !== Number(authorId) && !had.has(Number(p.id)));
}

module.exports = { mentioned, newlyMentioned };
