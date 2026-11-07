export function Brand({ word = false }: { word?: boolean }) {
  return <span className={word ? "colibri-brand full" : "colibri-brand"} aria-label="EvidenceLens">
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="5" y="3" width="30" height="38" rx="7" fill="#ebce79" /><path d="M13 13h13M13 20h9M13 27h6" stroke="#69512c" strokeWidth="2" strokeLinecap="round" /><circle cx="31" cy="30" r="10" fill="#fbf8ef" stroke="#69512c" strokeWidth="2.5" /><path d="m38 37 7 7" stroke="#69512c" strokeWidth="3" strokeLinecap="round" /></svg>
    {word && <span className="colibri-word">Evidence<span>Lens</span></span>}
  </span>
}
