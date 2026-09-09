/**
 * Shared inline icons.
 *
 * The app deliberately ships no icon dependency, but the same glyphs were being
 * hand-rolled in every file — and the close/clear/delete action was drawn three
 * different ways (a `✕` text glyph, a 10px SVG, and a 14px SVG). Anything that
 * appears in more than one component belongs here.
 *
 * House style: feather geometry on a 24x24 viewBox, `stroke="currentColor"`,
 * `strokeWidth` 2.5, and a size from the 10 / 12 / 14 / 18 ladder.
 */

type IconProps = {
  /** 10 = inside a dense list row, 12 = inside a button, 14 = standalone. */
  size?: number;
};

function Svg({ size = 12, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Close, clear, remove — every dismissing action in the app. */
export function XIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

export function SearchIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Svg>
  );
}

export function FolderIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Svg>
  );
}
