/**
 * Zarsip brand mark — a compact "Z" fused with a call/signal motif.
 * Mirrors the desktop app icon so in-window branding stays consistent.
 */
export default function Logo({ size = 18 }: { size?: number }) {
  const id = 'zarsipLogoGrad'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Zarsip"
      role="img"
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0A84FF" />
          <stop offset="100%" stopColor="#0051D5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      {/* Signal wave */}
      <path
        d="M 49 21 Q 54 25 49 29"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* Bold Z (round caps read like handset terminals) */}
      <polyline
        points="19,23 45,23 19,43 45,43"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
