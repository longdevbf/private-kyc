// The ambient layer. Everything here is decoration and none of it is data:
// two slow light sources in the two semantic hues, a receding grid floor, a
// drifting scanline and film grain. It sits behind the shell at low opacity
// so the interface still reads as an instrument, not a landing page.
//
// All of it is inert under `prefers-reduced-motion` (see styles.css).

export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="amb-glow pv" />
      <div className="amb-glow pb" />
      <div className="amb-glow dp" />

      <div className="amb-floor">
        <div className="amb-grid" />
      </div>

      <div className="amb-beam" />
      <div className="amb-grain" />
      <div className="amb-vignette" />
    </div>
  );
}
