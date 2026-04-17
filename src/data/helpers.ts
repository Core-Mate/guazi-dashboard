// ══════════════════════════════════════════════════════
// helpers.ts — date formatting + compatibility stubs
// ══════════════════════════════════════════════════════

export function pad2(n: number) { return n < 10 ? '0' + n : '' + n; }

export function fmtDuration(sec: number) {
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ' 分 ' + pad2(s) + ' 秒';
}

export function fmtHM(sec: number) {
  var h = Math.floor(sec / 3600);
  var m = Math.round((sec % 3600) / 60);
  return h + ':' + pad2(m);
}

export function fmtMMDD(d: Date) {
  return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
}

export function fmtFullTime(d: Date) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function filterPrev(_r: string, _customRange?: { start: Date; end: Date }) {
  return [] as any[];
}
