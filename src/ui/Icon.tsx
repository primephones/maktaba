import type { ReactNode } from 'react';

/** Line icons drawn for Maktaba: 24px grid, 1.7 stroke, round joins. */
const PATHS: Record<string, ReactNode> = {
  home: <><path d="M4 11.2 12 4l8 7.2" /><path d="M6.5 9.8V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.8" /><path d="M10 20v-5.5h4V20" /></>,
  library: <><path d="M5 4.5h3.2v15H5z" /><path d="M10.2 4.5h3.2v15h-3.2z" /><path d="m15.6 6.2 3-.9 3.6 13.4-3 .9z" /></>,
  references: <><path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-3.8L6 21V4.5a1 1 0 0 1 1-1Z" /><path d="M9.5 8h5M9.5 11.5h5" /></>,
  search: <><circle cx="11" cy="11" r="6.3" /><path d="m20 20-4.4-4.4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  forward: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  more: <><circle cx="12" cy="5.5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="18.5" r="1.2" fill="currentColor" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  toc: <><path d="M9 6.500h11M9 12h11M9 17.500h11" /><circle cx="4.7" cy="6.5" r=".9" fill="currentColor" /><circle cx="4.7" cy="12" r=".9" fill="currentColor" /><circle cx="4.7" cy="17.5" r=".9" fill="currentColor" /></>,
  bookmark: <path d="M7 4h10a1 1 0 0 1 1 1v15.500l-6-4-6 4V5a1 1 0 0 1 1-1Z" />,
  bookmarkOn: <path d="M7 4h10a1 1 0 0 1 1 1v15.500l-6-4-6 4V5a1 1 0 0 1 1-1Z" fill="currentColor" />,
  type: <><path d="M3.5 18.5 8 6.500h1l4.5 12M5.2 14.500h6.6" /><path d="M15.5 18.5 18 11.500h.6l2.5 7M16.4 16.200h3.8" /></>,
  folder: <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.500h4l2 2.300h8a1.5 1.5 0 0 1 1.5 1.500V17.500A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.500Z" />,
  folderPlus: <><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.500h4l2 2.300h8a1.5 1.5 0 0 1 1.5 1.500V17.500A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.500Z" /><path d="M12 11v5M9.5 13.500h5" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.500h5V7M6.5 7l.8 12a1 1 0 0 0 1 1h7.400a1 1 0 0 0 1-1l.8-12" /><path d="M10 10.500v6M14 10.500v6" /></>,
  edit: <><path d="m4.5 19.5 1-4.200L16.3 4.500a1.4 1.4 0 0 1 2 0l1.2 1.200a1.4 1.4 0 0 1 0 2L8.7 18.500Z" /><path d="m14.5 6.3 3.2 3.2" /></>,
  check: <path d="m5 12.5 4.5 4.500L19 7.5" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".9" fill="currentColor" /></>,
  warn: <><path d="M12 4 21 19.500H3Z" /><path d="M12 10v4.5" /><circle cx="12" cy="17" r=".9" fill="currentColor" /></>,
  sort: <path d="M7 5v14m0 0-3-3m3 3 3-3M17 19V5m0 0-3 3m3-3 3 3" />,
  highlight: <><path d="m5 16 9.5-9.5 3 3L8 19H5Z" /><path d="M13 20h7" /></>,
  note: <><path d="M5 4.500h14v10l-5 5H5Z" /><path d="M14 19.500v-5h5M8.5 9h7M8.5 12.500h4" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M5.5 15.500h-.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9.500a1 1 0 0 1 1 1v.5" /></>,
  book: <><path d="M5 5.500A1.5 1.5 0 0 1 6.5 4H19v14H6.500A1.5 1.5 0 0 0 5 19.500Z" /><path d="M5 19.500A1.5 1.5 0 0 0 6.5 21H19v-3" /></>,
  moon: <path d="M19.5 14.500A8 8 0 0 1 9.5 4.500a8 8 0 1 0 10 10Z" />,
  download: <><path d="M12 4v11m0 0-4-4m4 4 4-4" /><path d="M5 19.500h14" /></>,
  share: <><path d="M12 15V4m0 0L8 8m4-4 4 4" /><path d="M6 12.500v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6" /></>,
  retry: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.500v4h-4" /></>,
  storage: <><ellipse cx="12" cy="6.5" rx="7.5" ry="2.8" /><path d="M4.5 6.500v5.500c0 1.5 3.4 2.8 7.5 2.800s7.5-1.3 7.5-2.800V6.500M4.5 12v5.500c0 1.5 3.4 2.8 7.5 2.800s7.5-1.3 7.5-2.800V12" /></>,
  switches: <><path d="M4 8h9M17.5 8H20M4 16h2.500M11 16h9" /><circle cx="15.2" cy="8" r="2.2" /><circle cx="8.8" cy="16" r="2.2" /></>,
  palette: <><path d="M12 3.500a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.7 1.9-1.700h2A3.8 3.8 0 0 0 20.5 10.500c0-3.9-3.8-7-8.5-7Z" /><circle cx="8" cy="10" r="1" fill="currentColor" /><circle cx="12" cy="7.5" r="1" fill="currentColor" /><circle cx="16" cy="10" r="1" fill="currentColor" /></>,
  zoom: <><circle cx="11" cy="11" r="6.3" /><path d="m20 20-4.4-4.400M11 8.500v5M8.5 11h5" /></>,
  cloud: <path d="M7.500 18.500h9.250a4.250 4.250 0 0 0 .6-8.460A5.750 5.750 0 0 0 6.300 11.200 3.750 3.750 0 0 0 7.500 18.500Z" />,
  key: <><circle cx="8" cy="15" r="4.500" /><path d="m11.300 11.700 8.200-8.200M16.500 6.500l2.500 2.500M14 9l2 2" /></>,
  original: <><path d="M6.5 3.5h7.5l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10.500A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.500Z" /><path d="M13.5 3.5V8.500h5M8.500 12.500h7M8.500 16h4.500" /></>,
  grid: <><rect x="4.5" y="4.5" width="6" height="7.5" rx="1" /><rect x="13.5" y="4.5" width="6" height="7.5" rx="1" /><rect x="4.5" y="15" width="6" height="4.5" rx="1" /><rect x="13.5" y="15" width="6" height="4.5" rx="1" /></>,
  contrast: <><circle cx="12" cy="12" r="7.5" /><path d="M12 4.5v15a7.5 7.5 0 0 0 0-15Z" fill="currentColor" /></>,
  pages: <><path d="M8 4.5h8.5a1.5 1.5 0 0 1 1.5 1.5v12" /><rect x="5" y="7.5" width="10" height="12.5" rx="1.5" /><path d="M7.5 11.5h5M7.5 14.5h5M7.5 17.5h3" /></>,
  scan: <><path d="M4 8V5.500A1.5 1.5 0 0 1 5.5 4H8M16 4h2.500A1.5 1.5 0 0 1 20 5.500V8M20 16v2.500a1.5 1.5 0 0 1-1.5 1.500H16M8 20H5.500A1.5 1.5 0 0 1 4 18.500V16" /><path d="M4 12h16" /></>,
  move: <><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.500h4l2 2.300h8a1.5 1.5 0 0 1 1.5 1.500V17.500A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.500Z" /><path d="M10 13.500h5.500m0 0-2-2m2 2-2 2" /></>,
  sparkle: <path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5ZM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z" />,
  language: <><path d="M4 5.5h9M8.5 4v1.5M6 5.5c.8 3 2.9 5.4 6 6.8M11 5.5c-.8 3.4-3.2 6.3-6.5 7.8" /><path d="m12.5 20 3.7-8.5h.6L20.5 20M13.8 17h5.4" /></>,
  speaker: <><path d="M4.5 9.5h3L12 5.5v13l-4.5-4h-3Z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" /></>,
  volumes: <><rect x="4" y="5" width="4.5" height="14" rx=".8" /><rect x="9.8" y="5" width="4.5" height="14" rx=".8" /><rect x="15.5" y="5" width="4.5" height="14" rx=".8" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
