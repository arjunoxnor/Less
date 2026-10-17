/* Small line icons for the desk, drawn to match components/home/homeParts. */

export const StackGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="2.5" y="5" width="8.5" height="8.5" rx="1.5" />
    <path d="M5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v7" strokeLinecap="round" />
  </svg>
);

export const CoversGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="2" y="2" width="5" height="6.5" rx="1" />
    <rect x="9" y="2" width="5" height="6.5" rx="1" />
    <path d="M2 11.5h5M9 11.5h5M2 14h3.5M9 14h3.5" strokeLinecap="round" />
  </svg>
);

export const ListGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" strokeLinecap="round" />
    <circle cx="2.5" cy="4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="2.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="2.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const CloseGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
);

export const SparkGlyph = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 1.5l1.6 4.2 4.4 1.3-4.4 1.3L8 12.5 6.4 8.3 2 7l4.4-1.3z" />
    <circle cx="13" cy="12.5" r="1.3" />
  </svg>
);
