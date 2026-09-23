/**
 * The icon set: drawn, one stroke weight, currentColor.
 *
 * The menu used to be Unicode shapes (◍ ▥ ◆ ☷) that meant nothing and,
 * at 16px, looked alike. Each icon here is a picture of the thing: a
 * hard hat for the site, a warehouse for the store, a lorry for what is
 * on the road. An icon never stands alone as the only label — it sits
 * beside words, and on its own it carries an accessible name.
 */
const P = {
  // departments
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z" /></>,
  clipboard: <><rect x="5.5" y="4" width="13" height="17" rx="2" /><path d="M9 4V2.8h6V4" /><path d="M9 10h6M9 14h6M9 18h3" /></>,
  helmet: <><path d="M2.5 17.5h19" /><path d="M4 17.5V15a8 8 0 0 1 16 0v2.5" /><path d="M10 7.2V4.5h4v2.7" /><path d="M9 17.5v-5M15 17.5v-5" /></>,
  store: <><path d="M3 21V9l9-5 9 5v12" /><path d="M7 21v-8h10v8" /><path d="M7 17h10" /></>,
  cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h2.6l2.4 11.2a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 1.9-1.5L21.5 7H6" /></>,
  receipt: <><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  chart: <><path d="M4 4v16h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18.2 14.4A6.5 6.5 0 0 1 21.5 20" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9" /><path d="M12 17.5h.01" /></>,
  wallet: <><path d="M19 7V4H5a2 2 0 0 0 0 4h15v12H5a2 2 0 0 1-2-2V6" /><path d="M16 14h.01" /></>,
  // status
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M10.3 3.9 1.8 18.5a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  stop: <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>,
  draft: <circle cx="12" cy="12" r="8.5" strokeDasharray="3.2 2.6" />,
  truck: <><path d="M2.5 6.5h11.5v9.5H2.5z" /><path d="M14 9.5h4l3.5 3.5v3H14" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></>,
  pin: <><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></>,
  person: <><circle cx="12" cy="7" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  rupee: <path d="M6 4h12M6 9h12M13.5 20 6 13h3a4.5 4.5 0 0 0 0-9" />,
  // interface
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrowRight: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="m10 17-5-5 5-5" /><path d="M5 12h11" /></>,
  key: <><circle cx="7.5" cy="15.5" r="3.5" /><path d="m10 13 9-9" /><path d="m16 7 3 3" /><path d="m14 9 2 2" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5Z" /><path d="M4 20a2 2 0 0 0 2 1.5h13" /><path d="M8 7.5h7" /></>,
  flow: <><rect x="3" y="3.5" width="7" height="5.5" rx="1.2" /><rect x="14" y="15" width="7" height="5.5" rx="1.2" /><path d="M6.5 9v4a2.5 2.5 0 0 0 2.5 2.5h5" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5" /><path d="M20 3.5v5h-5" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  edit: <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  print: <><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
};

export function Icon({ name, size = 16, className = '', label, style }) {
  const body = P[name];
  if (!body) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      className={`ico ${className}`} style={style}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}
      focusable="false">
      {body}
    </svg>
  );
}

export default Icon;
