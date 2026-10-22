const svg = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const heartPath = "M12 20s-7.5-4.6-9.2-9.1C1.6 7.6 3.8 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.2 0 5.4 3.1 4.2 6.4C19.5 15.4 12 20 12 20Z";

export const icons = {
  hanger: svg('<path d="M12 8V7.5c0-1.5 2-2 2-3.5a2 2 0 1 0-4 0"/><path d="M12 8.5 3 15a1.5 1.5 0 0 0 .9 2.7h16.2A1.5 1.5 0 0 0 21 15l-9-6.5Z"/>'),
  heart: svg(`<path d="${heartPath}"/>`),
  heartFilled: svg(`<path d="${heartPath}" fill="currentColor"/>`),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  collections: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  flame: svg('<path fill="currentColor" stroke="none" d="M12 2.5c.6 3.2 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.3-4.2 2.6-5.4.3 1.6 1 2.6 2.1 3.1-.4-3.4.2-6.3.8-8.7Z"/>'),
  bolt: svg('<path fill="currentColor" stroke="none" d="M13.5 2 4.5 13.5h6L9.5 22l9-11.5h-6L13.5 2Z"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  filter: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  camera: svg('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.5"/>'),
  target: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12h.01" stroke-width="3.5"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  back: svg('<path d="M15 5 8 12l7 7"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.9-3.6 3.7-5.6 7-5.6s6.1 2 7 5.6"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>'),
  // Hangie, the Digital Closet mascot: a friendly green hanger.
  hangie: `<svg class="hangie" viewBox="0 0 120 120" aria-hidden="true">
    <path d="M60 36V27c0-6 11-6 11-14a11 11 0 0 0-22 0" fill="none" stroke="#4b4b4b" stroke-width="6" stroke-linecap="round"/>
    <path d="M60 41 101 82c4 4 1.5 11-4.5 11H23.5c-6 0-8.5-7-4.5-11Z" fill="var(--leaf-ledge)" stroke="var(--leaf-ledge)" stroke-width="8" stroke-linejoin="round"/>
    <path d="M60 35 101 76c4 4 1.5 11-4.5 11H23.5c-6 0-8.5-7-4.5-11Z" fill="var(--leaf)" stroke="var(--leaf)" stroke-width="8" stroke-linejoin="round"/>
    <ellipse cx="48" cy="63" rx="7" ry="8" fill="#fff"/><ellipse cx="72" cy="63" rx="7" ry="8" fill="#fff"/>
    <circle cx="49.5" cy="65" r="4" fill="#3c3c3c"/><circle cx="73.5" cy="65" r="4" fill="#3c3c3c"/>
    <circle cx="51" cy="63.5" r="1.4" fill="#fff"/><circle cx="75" cy="63.5" r="1.4" fill="#fff"/>
    <path d="M53 75c4 4.5 10 4.5 14 0" fill="none" stroke="#3c3c3c" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="37" cy="75" rx="5" ry="3.5" fill="#ff86a6" opacity=".55"/><ellipse cx="83" cy="75" rx="5" ry="3.5" fill="#ff86a6" opacity=".55"/>
  </svg>`
};

export type IconName = keyof typeof icons;
