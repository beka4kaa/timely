// Значки интерфейса одним спрайтом: страница ссылается на них через <use>.
// Лежат строкой, потому что внутри только статичные контуры.

const SPRITE = `<defs><symbol id="i-now" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/></symbol><symbol id="i-diary" viewBox="0 0 24 24"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></symbol><symbol id="i-plan" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></symbol><symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></symbol><symbol id="i-chat" viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></symbol><symbol id="i-board" viewBox="0 0 24 24"><path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/></symbol><symbol id="i-book" viewBox="0 0 24 24"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></symbol><symbol id="i-flag" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></symbol><symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol><symbol id="i-medal" viewBox="0 0 24 24"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></symbol><symbol id="i-grades" viewBox="0 0 24 24"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></symbol><symbol id="i-timer" viewBox="0 0 24 24"><path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/></symbol><symbol id="i-trophy" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></symbol><symbol id="i-panel" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></symbol><symbol id="i-moon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></symbol><symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></symbol><symbol id="i-undo" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></symbol><symbol id="i-user" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></symbol><symbol id="i-chev-l" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol><symbol id="i-chev-r" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol><symbol id="i-chev-d" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol><symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></symbol><symbol id="i-cursor" viewBox="0 0 24 24"><path d="M12.586 12.586 19 19"/><path d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"/></symbol><symbol id="i-pencil" viewBox="0 0 24 24"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></symbol><symbol id="i-type" viewBox="0 0 24 24"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></symbol><symbol id="i-eraser" viewBox="0 0 24 24"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></symbol><symbol id="i-camera" viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></symbol><symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol><symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></symbol><symbol id="i-more" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></symbol><symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol><symbol id="i-sliders" viewBox="0 0 24 24"><path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/></symbol><symbol id="i-compose" viewBox="0 0 24 24"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.9.5l-2.9.8a.5.5 0 0 1-.6-.6l.8-2.9a2 2 0 0 1 .5-.9z"/></symbol><symbol id="i-mountain" viewBox="0 0 24 24"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></symbol><symbol id="i-flame" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></symbol><symbol id="i-star" viewBox="0 0 24 24"><path d="M11.5 2.8a.6.6 0 0 1 1 0l2.7 5.5 6.1.9a.6.6 0 0 1 .3 1l-4.4 4.3 1 6.1a.6.6 0 0 1-.8.6L12 18.3l-5.4 2.9a.6.6 0 0 1-.8-.6l1-6.1-4.4-4.3a.6.6 0 0 1 .3-1l6.1-.9z"/></symbol><symbol id="i-sigma" viewBox="0 0 24 24"><path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/></symbol><symbol id="i-languages" viewBox="0 0 24 24"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></symbol><symbol id="i-dumbbell" viewBox="0 0 24 24"><path d="M6.5 6.5v11"/><path d="M17.5 6.5v11"/><path d="M3 9.5v5"/><path d="M21 9.5v5"/><path d="M6.5 12h11"/></symbol><symbol id="i-zap" viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></symbol><symbol id="i-compass" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/></symbol><symbol id="i-bulb" viewBox="0 0 24 24"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></symbol><symbol id="i-return" viewBox="0 0 24 24"><path d="M20 5v6a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/></symbol><symbol id="i-wave" viewBox="0 0 24 24"><path d="M3 10.5v3"/><path d="M7.5 7v10"/><path d="M12 4v16"/><path d="M16.5 8v8"/><path d="M21 10.5v3"/></symbol><symbol id="art-slime" viewBox="34 80 172 122"><path d="M199.7 160.0C199.6 155.9 199.1 149.1 198.1 144.1C197.1 139.1 195.6 134.4 193.7 130.0C191.8 125.6 189.4 121.3 186.7 117.4C184.0 113.5 180.9 109.8 177.4 106.6C174.0 103.3 170.1 100.3 166.0 97.8C161.9 95.2 157.5 93.0 152.8 91.3C148.1 89.6 143.3 88.2 137.8 87.3C132.4 86.5 125.9 86.0 120.0 86.0C114.1 86.0 107.6 86.5 102.2 87.3C96.7 88.2 91.9 89.6 87.2 91.3C82.5 93.0 78.1 95.2 74.0 97.8C69.9 100.3 66.0 103.3 62.6 106.6C59.1 109.8 56.0 113.5 53.3 117.4C50.6 121.3 48.2 125.6 46.3 130.0C44.4 134.4 42.9 139.1 41.9 144.1C40.9 149.1 40.4 155.9 40.3 160.0C40.1 164.1 40.4 166.2 41.1 168.8C41.9 171.5 43.0 173.6 44.6 175.8C46.1 177.9 48.0 179.9 50.2 181.7C52.5 183.5 55.1 185.2 58.1 186.7C61.1 188.2 64.4 189.6 68.2 190.7C72.0 191.9 76.0 192.8 80.7 193.6C85.4 194.4 89.6 195.0 96.1 195.4C102.7 195.8 112.0 196.0 120.0 196.0C128.0 196.0 137.3 195.8 143.9 195.4C150.4 195.0 154.6 194.4 159.3 193.6C164.0 192.8 168.0 191.9 171.8 190.7C175.6 189.6 178.9 188.2 181.9 186.7C184.9 185.2 187.5 183.5 189.8 181.7C192.0 179.9 193.9 177.9 195.4 175.8C197.0 173.6 198.1 171.5 198.9 168.8C199.6 166.2 199.9 164.1 199.7 160.0Z" fill="#fbfcff" stroke="#c9d2ee" stroke-width="4"/><ellipse cx="66" cy="162" rx="13" ry="8" fill="#ffc2d2"/><ellipse cx="174" cy="162" rx="13" ry="8" fill="#ffc2d2"/><path d="M78 150Q93 134 108 150M132 150Q147 134 162 150" fill="none" stroke="#25263a" stroke-width="8" stroke-linecap="round"/></symbol></defs>`;

export type IconName =
  | "now"
  | "diary"
  | "plan"
  | "target"
  | "chat"
  | "board"
  | "book"
  | "flag"
  | "users"
  | "medal"
  | "grades"
  | "timer"
  | "trophy"
  | "panel"
  | "moon"
  | "sun"
  | "undo"
  | "user"
  | "chev-l"
  | "chev-r"
  | "chev-d"
  | "arrow-up"
  | "cursor"
  | "pencil"
  | "type"
  | "eraser"
  | "camera"
  | "x"
  | "plus"
  | "more"
  | "check"
  | "sliders"
  | "compose"
  | "mountain"
  | "flame"
  | "star"
  | "sigma"
  | "languages"
  | "dumbbell"
  | "zap"
  | "compass"
  | "bulb"
  | "return"
  | "wave";

export function IconSprite() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute" }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: SPRITE }}
    />
  );
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `i ${className}` : "i"} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
