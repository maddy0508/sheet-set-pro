type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function IconDashboard({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1.6" />
      <rect x="14" y="3" width="7" height="5" rx="1.6" />
      <rect x="14" y="12" width="7" height="9" rx="1.6" />
      <rect x="3" y="16" width="7" height="5" rx="1.6" />
    </svg>
  );
}

export function IconCustomers({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 6.3a3 3 0 0 1 0 5.4M18.4 20c0-2.5-.9-4.3-2.4-5.2" />
    </svg>
  );
}

export function IconJobs({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 10.5 12 3.2l9 7.3" />
      <path d="M5.6 9.4V20.5h12.8V9.4" />
      <path d="M10 20.5v-5h4v5" />
    </svg>
  );
}

export function IconCatalogue({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 4.4A1.4 1.4 0 0 1 5.9 3H19v18H5.9a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M8.4 3v18M11.8 8.2h4.2M11.8 12.2h4.2" />
    </svg>
  );
}

export function IconSettings({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.3 14.9a1.6 1.6 0 0 0 .32 1.78l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.78-.32 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.78.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.78 1.6 1.6 0 0 0-1.47-.97H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.78l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.78.32H9a1.6 1.6 0 0 0 .97-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.78-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.78V9a1.6 1.6 0 0 0 1.47.97H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.6.93z" />
    </svg>
  );
}

export function IconPlus({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconArrowLeft({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function IconArrowRight({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconCheck({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.2}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconAlert({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3.2 2.6 20h18.8z" />
      <path d="M12 9.4v4.8M12 17.2v.05" />
    </svg>
  );
}

export function IconMenu({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function IconClose({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconRuler({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 15.6 15.6 3 21 8.4 8.4 21z" />
      <path d="M7.1 11.5l1.8 1.8M10 8.6l1.8 1.8M12.9 5.7l1.8 1.8" />
    </svg>
  );
}

export function IconLayers({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3 3 7.6l9 4.6 9-4.6z" />
      <path d="M3 12.4 12 17l9-4.6M3 16.8 12 21.4l9-4.6" />
    </svg>
  );
}

export function IconDoc({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3h7.5L19 8.5V21H6z" />
      <path d="M13.2 3v5.6H19M9 13h6M9 16.6h6" />
    </svg>
  );
}

export function IconCash({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.6" y="6" width="18.8" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 10v.05M18 14v.05" />
    </svg>
  );
}

export function IconSpark({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 2 4.5 13.2H11l-1 8.8 8.5-11.2H12z" />
    </svg>
  );
}

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="ssp-steel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f4f8fb" />
          <stop offset="45%" stopColor="#c3cfda" />
          <stop offset="100%" stopColor="#7d8f9f" />
        </linearGradient>
        <linearGradient id="ssp-cyan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#63e2f2" />
          <stop offset="100%" stopColor="#1b9fb4" />
        </linearGradient>
      </defs>
      <path d="M2.5 20.4 14.6 8.2l3.2 3.2-6.1 6.1 3.6 3.6-3-1.2z" fill="url(#ssp-steel)" opacity="0.95" />
      <path d="M16.4 21.9 24 11.4l5.6 5.6-2.8 2.8-2.8-1.9-2.6 2.6z" fill="url(#ssp-cyan)" opacity="0.9" />
      <path d="M4 24.4h24" stroke="url(#ssp-steel)" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
