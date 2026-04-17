export function animateNumber(el: HTMLElement | null, target: number, opts?: {
  duration?: number;
  format?: (v: number) => string;
  from?: number;
}) {
  if (!el) return;
  var duration = (opts && opts.duration) || 500;
  var format = (opts && opts.format) || function(v: number) { return Math.round(v).toLocaleString(); };
  var from = (opts && typeof opts.from === 'number') ? opts.from : (parseFloat((el.textContent || '0').replace(/[^\d.-]/g, '')) || 0);
  el.textContent = format(target);
  if (from === target) return;
  var start: number | null = null;
  function step(now: number) {
    if (start === null) {
      start = now;
      requestAnimationFrame(step);
      return;
    }
    var p = Math.min((now - start) / duration, 1);
    var eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function formatDuration(minutes: number): string {
  var h = Math.floor(minutes / 60);
  var m = Math.round(minutes % 60);
  return h > 0 ? (h + 'h' + (m > 0 ? ' ' + m + 'min' : '')) : (m + 'min');
}
