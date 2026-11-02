import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// Emojis offered for reactions, by group. Any emoji is accepted by the server; these are the ones listed.
const GROUPS: { name: string; emojis: string[] }[] = [
  {
    name: 'Smileys',
    emojis:
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😎 🤓 🧐 🤔 🤨 😐 😑 😶 🙄 😏 😬 😌 😔 😪 😴 😷 🤒 🤕 🥵 🥶 😵 🤯 🥳 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 🤗 🤭 🫡 🤫 🙃 🫠'.split(
        ' '
      ),
  },
  { name: 'Hands', emojis: '👍 👎 👌 🤌 ✌️ 🤞 🤝 🙏 👏 🙌 👐 🤲 👋 🤙 💪 👊 ✊ ☝️ 👆 👇 👈 👉 ✋ 🖐️ 🫶 ✍️'.split(' ') },
  { name: 'Hearts', emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💖 💯'.split(' ') },
  {
    name: 'Work',
    emojis: '✅ ☑️ ✔️ ❌ ❗ ❓ ⚠️ 🚫 ⏰ ⏳ 📌 📎 📞 📱 💻 🖥️ 🖨️ 🔧 🔨 🛠️ ⚙️ 🔌 💡 🔋 📶 📡 🗼 🚚 🚗 📦 📄 📝 📊 📈 📅 🔒 🔑 🏢 🏗️ ☕'.split(' '),
  },
  { name: 'Celebrate', emojis: '🎉 🎊 🏆 🥇 ⭐ 🌟 ✨ 🔥 ⚡ 🚀 👀 💬 🙈 🤷 🤦 👑 🎯 💰 🍾 🎂'.split(' ') },
];

const RECENT_KEY = 'reaction-recent';
const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 16) : [];
  } catch {
    return [];
  }
};
// Remembers recently used reactions on this device, shown first next time.
export function rememberEmoji(e: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter((x) => x !== e)].slice(0, 16)));
  } catch {
    // Storage unavailable (private window): nothing to remember.
  }
}

export function EmojiPicker({ onPick, selected }: { onPick: (emoji: string) => void; selected?: string | null }) {
  const [recent] = useState(readRecent);
  const scroller = useRef<HTMLDivElement>(null);
  const groups = recent.length ? [{ name: 'Recent', emojis: recent }, ...GROUPS] : GROUPS;
  const jump = (name: string) => scroller.current?.querySelector(`[data-group="${name}"]`)?.scrollIntoView({ block: 'start' });

  return (
    <div className="w-72">
      <div className="flex gap-0.5 border-b p-1" role="tablist" aria-label="Emoji groups">
        {groups.map((g) => (
          <button
            key={g.name}
            type="button"
            title={g.name}
            onClick={() => jump(g.name)}
            className="flex-1 rounded-sm px-1 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {g.name}
          </button>
        ))}
      </div>
      <div ref={scroller} className="max-h-64 overflow-y-auto p-1.5">
        {groups.map((g) => (
          <section key={g.name} data-group={g.name}>
            <h4 className="px-1 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">{g.name}</h4>
            <div className="grid grid-cols-8 gap-0.5">
              {g.emojis.map((e) => (
                <button
                  key={`${g.name}-${e}`}
                  type="button"
                  aria-label={`React ${e}`}
                  onClick={() => {
                    rememberEmoji(e);
                    onPick(e);
                  }}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md text-xl leading-none hover:bg-accent',
                    selected === e && 'bg-accent ring-1 ring-primary/40'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
