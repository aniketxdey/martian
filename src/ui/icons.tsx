import React from 'react';

type IconProps = { size?: number; className?: string; strokeWidth?: number; color?: string };

const make = (children: React.ReactNode, defaults: { strokeWidth?: number } = {}) =>
  ({ size = 18, className, strokeWidth, color = 'currentColor' }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth ?? defaults.strokeWidth ?? 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );

export const IconOverview = make(<>
  <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
  <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
</>);
export const IconServer = make(<>
  <rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" />
</>);
export const IconChat = make(<path d="M4 5h16v11H9l-5 4z" />);
export const IconPlug = make(<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />);
export const IconSliders = make(<>
  <path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
</>);
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconSignOut = make(<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />, { strokeWidth: 2 });
export const IconCheck = make(<path d="M20 6L9 17l-5-5" />, { strokeWidth: 2 });
export const IconClose = make(<path d="M6 6l12 12M18 6L6 18" />, { strokeWidth: 2 });
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, { strokeWidth: 2 });
export const IconRefresh = make(<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />);
export const IconArrowUp = make(<path d="M12 19V5M5 12l7-7 7 7" />, { strokeWidth: 2 });
export const IconShield = make(<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />, { strokeWidth: 2 });
export const IconPencil = make(<path d="M4 20h4L19 9l-4-4L4 16z" />);
export const IconTrash = make(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />);
export const IconFolder = make(<path d="M3 6h6l2 2h10v11H3z" />);
export const IconFile = make(<path d="M6 3h8l4 4v14H6z" />);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>);
export const IconCode = make(<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />);
export const IconAlert = make(<><path d="M12 8v5M12 16h.01" /><circle cx="12" cy="12" r="9" /></>, { strokeWidth: 2 });

export const IconPlay = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
);

/** The Martian alien mark, cropped from the brand PNG exactly as in the design. */
export const MartianMark = ({ box = 28, img = 52, offset = -12 }: { box?: number; img?: number; offset?: number }) => (
  <span className="relative block flex-none overflow-hidden" style={{ width: box, height: box }}>
    <img src="/martian-logo.png" alt="" className="absolute max-w-none" style={{ width: img, height: img, left: offset, top: offset }} />
  </span>
);
