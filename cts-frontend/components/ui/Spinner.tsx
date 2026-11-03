// Small spinning ring in the current text colour. Buttons don't need this: give the button
// aria-busy={true} and globals.css draws the same ring before its label.
export default function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spinner ${className}`} aria-hidden />
}
