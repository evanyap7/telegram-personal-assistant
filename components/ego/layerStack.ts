/**
 * Crossfade controller for a stack of always-mounted image layers.
 *
 * Rule that prevents any dip to the background: the incoming layer fades in on top while
 * every layer beneath it stays fully opaque; layers beneath are dropped only once the
 * incoming one is completely opaque. A `null` target fades the whole stack out, which
 * reveals the (always opaque) layer below the stack, never the page background.
 * Opacity is written straight to the DOM from the caller's rAF loop, so a fade costs no
 * React renders.
 */

const ease = (p: number) => p * p * (3 - 2 * p);

interface Layer {
  el: HTMLElement | null;
  p: number;
  shown: number;
  z: number;
}

export class LayerStack {
  private layers = new Map<string, Layer>();
  /** Bottom to top. Only layers with p > 0 (or the target) are in here. */
  private order: string[] = [];
  private target: string | null;
  private ms: number;
  private zBase: number;

  /** `zBase` keeps stacks in separate z bands (mood bases below, eye/mouth regions above). */
  constructor(names: readonly string[], ms: number, initial: string | null = null, zBase = 1) {
    this.zBase = zBase;
    this.ms = ms;
    this.target = initial;
    for (const n of names) this.layers.set(n, { el: null, p: n === initial ? 1 : 0, shown: -1, z: -1 });
    if (initial) this.order = [initial];
  }

  register(name: string, el: HTMLElement | null) {
    const layer = this.layers.get(name);
    if (!layer) return;
    layer.el = el;
    layer.shown = -1;
    layer.z = -1;
  }

  setDuration(ms: number) {
    this.ms = ms;
  }

  getTarget() {
    return this.target;
  }

  setTarget(name: string | null) {
    if (name === this.target) return;
    this.target = name;
    if (name === null) return;
    const layer = this.layers.get(name);
    if (!layer) return;
    // Already fully opaque (beneath a half-faded layer): keep its place and let tick() fade
    // the layers above it out, so nothing vanishes instantly. Otherwise re-stack it on top,
    // continuing from its current opacity.
    if (layer.p < 1) {
      this.order = this.order.filter((n) => n !== name);
      this.order.push(name);
    }
    if (this.ms <= 0) this.settle();
  }

  private settle() {
    const top = this.target;
    for (const [n, l] of this.layers) l.p = n === top ? 1 : 0;
    this.order = top ? [top] : [];
  }

  tick(dtMs: number) {
    const step = this.ms > 0 ? dtMs / this.ms : 1;
    if (this.target === null) {
      for (const n of this.order) {
        const l = this.layers.get(n)!;
        l.p = Math.max(0, l.p - step);
      }
      this.order = this.order.filter((n) => this.layers.get(n)!.p > 0);
    } else {
      const top = this.layers.get(this.target)!;
      top.p = Math.min(1, top.p + step);
      if (top.p >= 1) {
        // Opaque: everything beneath is hidden, drop it; anything above fades out.
        const idx = this.order.indexOf(this.target);
        for (const n of this.order.slice(0, idx)) this.layers.get(n)!.p = 0;
        for (const n of this.order.slice(idx + 1)) {
          const l = this.layers.get(n)!;
          l.p = Math.max(0, l.p - step);
        }
        this.order = this.order.slice(idx).filter((n) => n === this.target || this.layers.get(n)!.p > 0);
      }
    }
    this.apply();
  }

  private apply() {
    let z = this.zBase;
    const inOrder = new Set(this.order);
    for (const n of this.order) this.write(this.layers.get(n)!, ease(this.layers.get(n)!.p), z++);
    for (const [n, l] of this.layers) if (!inOrder.has(n)) this.write(l, 0, 0);
  }

  private write(l: Layer, opacity: number, z: number) {
    if (!l.el) return;
    if (l.shown !== opacity) {
      l.el.style.opacity = String(opacity);
      l.shown = opacity;
    }
    if (l.z !== z) {
      l.el.style.zIndex = String(z);
      l.z = z;
    }
  }
}
