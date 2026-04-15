import { mockData, INTERACTION_BREAKDOWN } from '../data/charts'
import { HIGHLIGHT_DATA, computeChange, formatValue } from '../data/highlights'
import { PLATFORM_BREAKDOWN } from '../data/platforms'
import { computeAchievements } from './achievements'
import { ACHIEVEMENT_CONTEXTS } from '../data/achievements'
import { skillData } from '../data/scenarios'
import { Chart } from 'chart.js'
import { calcROI, calcROIPlatforms } from '../data/roi'
import { platformColors } from '../data/platforms'

let currentReportBlob = null
let currentReportDim = 'week'
let roiPlatformChart = null

export function initROICard(range?) {
  var r = calcROI(range || '7d');
  var numEl = document.getElementById('roiNumber');
  var descEl = document.getElementById('roiDesc');
  var valueEl = document.getElementById('roiValue');
  var costEl = document.getElementById('roiCost');
  var savedEl = document.getElementById('roiSaved');
  var bdEl = document.getElementById('roiBreakdown');
  if (numEl) numEl.textContent = r.roi.toFixed(1) + 'x';
  if (descEl) descEl.textContent = '每投入 1 元算力豆，产出 ' + r.roi.toFixed(1) + ' 元人工价值';
  if (valueEl) valueEl.textContent = '¥' + Math.round(r.value).toLocaleString();
  if (costEl) costEl.textContent = '¥' + Math.round(r.cost).toLocaleString();
  if (savedEl) savedEl.textContent = '¥' + Math.round(r.saved).toLocaleString() + ' (' + r.savedPct + '%)';
  if (bdEl) {
    bdEl.innerHTML = r.breakdown.filter(function(b) { return b.count > 0; }).map(function(b) {
      return '<div class="roi-breakdown-item"><strong>' + b.label + '</strong> ' + b.count + b.unit + ' → ¥' + Math.round(b.subtotal) + '</div>';
    }).join('');
  }
}

function svgDonut(data: {name:string, value:number, color:string}[], size: number, centerLabel: string): string {
  var total = data.reduce(function(a, d) { return a + d.value; }, 0);
  if (!total) return '';
  var cx = size / 2, cy = size / 2, r = size * 0.36;
  var strokeWidth = size * 0.16;
  var circumference = 2 * Math.PI * r;
  var offset = 0;
  var paths = data.map(function(d) {
    var pct = d.value / total;
    var dashLen = pct * circumference;
    var gap = circumference - dashLen;
    var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + d.color + '" stroke-width="' + strokeWidth + '" stroke-dasharray="' + dashLen.toFixed(2) + ' ' + gap.toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
    offset += dashLen;
    return s;
  }).join('');
  var centerText = '<text x="' + cx + '" y="' + (cy - 6) + '" text-anchor="middle" font-size="22" font-weight="700" fill="#09090b" font-family="-apple-system,PingFang SC,sans-serif">' + total + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" font-size="11" fill="#a1a1aa" font-family="-apple-system,PingFang SC,sans-serif">' + centerLabel + '</text>';
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' + paths + centerText + '</svg>';
}

function svgDonutLegend(data: {name:string, value:number, color:string}[]): string {
  return data.map(function(d) {
    return '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#52525b;">' +
      '<span style="width:10px;height:10px;border-radius:50%;background:' + d.color + ';flex-shrink:0;display:inline-block;"></span>' +
      d.name +
      '<span style="font-weight:600;color:#09090b;margin-left:auto;">' + d.value + '</span>' +
    '</div>';
  }).join('');
}

function smoothSvgPath(xs: number[], ys: number[], tension: number): string {
  if (xs.length < 2) return 'M' + xs[0].toFixed(1) + ',' + ys[0].toFixed(1);
  var d = 'M' + xs[0].toFixed(1) + ',' + ys[0].toFixed(1);
  for (var i = 0; i < xs.length - 1; i++) {
    var p0x = i > 0 ? xs[i-1] : xs[0];
    var p0y = i > 0 ? ys[i-1] : ys[0];
    var p1x = xs[i], p1y = ys[i];
    var p2x = xs[i+1], p2y = ys[i+1];
    var p3x = i+2 < xs.length ? xs[i+2] : p2x;
    var p3y = i+2 < xs.length ? ys[i+2] : p2y;
    var cp1x = p1x + (p2x - p0x) * tension / 3;
    var cp1y = p1y + (p2y - p0y) * tension / 3;
    var cp2x = p2x - (p3x - p1x) * tension / 3;
    var cp2y = p2y - (p3y - p1y) * tension / 3;
    d += ' C' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) +
         ' ' + cp2x.toFixed(1) + ',' + cp2y.toFixed(1) +
         ' ' + p2x.toFixed(1) + ',' + p2y.toFixed(1);
  }
  return d;
}

function svgLine(labels: string[], data: number[], color: string, width: number, height: number): string {
  if (!data || !data.length) return '';
  var padL = 45, padR = 15, padT = 15, padB = 35;
  var plotW = width - padL - padR;
  var plotH = height - padT - padB;
  var max = Math.max.apply(null, data);
  var min = Math.min.apply(null, data);
  var range = max - min || 1;
  function xPos(i: number) { return padL + (i / (data.length - 1)) * plotW; }
  function yPos(v: number) { return padT + plotH - ((v - min) / range) * plotH; }
  var grid = '';
  for (var j = 0; j <= 4; j++) {
    var yy = padT + (j / 4) * plotH;
    var val = Math.round(max - (j / 4) * range);
    grid += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (width - padR) + '" y2="' + yy.toFixed(1) + '" stroke="#dbeafe" stroke-width="1"/>';
    grid += '<text x="' + (padL - 6) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="#a1a1aa" font-family="-apple-system,PingFang SC,sans-serif">' + val + '</text>';
  }
  var skip = Math.max(1, Math.floor(labels.length / 7));
  var xLabels = '';
  for (var i = 0; i < labels.length; i++) {
    if (i % skip === 0 || i === labels.length - 1) {
      xLabels += '<text x="' + xPos(i).toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle" font-size="10" fill="#a1a1aa" font-family="-apple-system,PingFang SC,sans-serif">' + labels[i] + '</text>';
    }
  }
  var xs = data.map(function(_v, i) { return xPos(i); });
  var ys = data.map(function(v) { return yPos(v); });
  var curvePath = smoothSvgPath(xs, ys, 0.3);
  var fillPath = curvePath + ' L' + xs[xs.length-1].toFixed(1) + ',' + (padT + plotH) + ' L' + padL + ',' + (padT + plotH) + ' Z';
  var dots = '';
  for (var i = 0; i < data.length; i++) {
    dots += '<circle cx="' + xs[i].toFixed(1) + '" cy="' + ys[i].toFixed(1) + '" r="3" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>';
  }
  return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
    grid + xLabels +
    '<path d="' + fillPath + '" fill="' + color + '" opacity="0.08"/>' +
    '<path d="' + curvePath + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots +
  '</svg>';
}

function getReportDateRange(dim) {
  var now = new Date();
  var fmt = function(d) { return d.toISOString().slice(0, 10).replace(/-/g, '.'); };
  if (dim === 'day') {
    var yesterday = new Date(now.getTime() - 86400000);
    return fmt(yesterday);
  }
  if (dim === 'week') {
    var dayOfWeek = now.getDay() || 7;
    var lastSunday = new Date(now.getTime() - dayOfWeek * 86400000);
    var lastMonday = new Date(lastSunday.getTime() - 6 * 86400000);
    return fmt(lastMonday) + ' - ' + fmt(lastSunday);
  }
  // month: 上个完整自然月
  var lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  var lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
  return fmt(lastMonthStart) + ' - ' + fmt(lastMonthEnd);
}

export function buildReportHTML(dim) {
  var dimLabels = { day:'日报', week:'周报', month:'月报' };
  var dimData = { day:'today', week:'7d', month:'30d' };
  var range = dimData[dim] || '7d';
  var hl = HIGHLIGHT_DATA[range] || HIGHLIGHT_DATA['7d'];
  var roiResult = calcROI(range);
  var roiPlatforms = calcROIPlatforms(range).filter(function(p) { return p.comments + p.dms + p.likes + p.saves > 0; });
  var dateLabel = getReportDateRange(dim);
  var achCtx = ACHIEVEMENT_CONTEXTS[range] || ACHIEVEMENT_CONTEXTS['7d'];
  var achievements = computeAchievements(achCtx);
  var platformData = PLATFORM_BREAKDOWN[range] || PLATFORM_BREAKDOWN['7d'];
  var interactionData = INTERACTION_BREAKDOWN[range] || INTERACTION_BREAKDOWN['7d'];
  var chartData = mockData[range] || mockData['7d'];
  var genTime = new Date().toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });

  var container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;background:#f8fafc;padding:0;box-sizing:border-box;font-family:-apple-system,PingFang SC,sans-serif;color:#09090b;';

  // -- SVG bar chart for platforms --
  function svgPlatformBars() {
    if (!roiPlatforms.length) return '';
    var w = 1080;
    var leftColW = 120, rightColW = 60, padX = 20;
    var headerH = 50, rowH = 60, barH = 24;
    var h = headerH + roiPlatforms.length * rowH;
    var barAreaW = w - leftColW - rightColW - padX * 2;
    var maxBarW = barAreaW * 0.75;
    var barX = padX + leftColW;
    var roiX = w - padX;
    var maxVal = Math.max.apply(null, roiPlatforms.map(function(p) { return Math.max(0, Number(p.value) || 0); }));
    if (!maxVal) maxVal = 1;
    function formatMoney(amount) { return '¥' + Math.round(Math.max(0, Number(amount) || 0)); }
    function clamp(num, mn, mx) { return Math.min(mx, Math.max(mn, num)); }
    var rows = '';
    roiPlatforms.forEach(function(p, i) {
      var color = platformColors[p.name] || '#2563eb';
      var value = Math.max(0, Number(p.value) || 0);
      var cost = Math.max(0, Number(p.cost) || 0);
      var roi = Math.max(0, Number(p.roi) || 0);
      var barWidth = (value / maxVal) * maxBarW;
      var costWidth = barWidth * (value > 0 ? clamp(cost / value, 0, 1) : 0);
      var rowCenterY = headerH + i * rowH + rowH / 2;
      var barY = rowCenterY - barH / 2;
      var costText = formatMoney(cost);
      var valueText = formatMoney(value);
      var costFitsInside = costWidth >= costText.length * 7 + 16;
      var costLabelX = costFitsInside ? barX + 10 : barX + costWidth + 8;
      var costLabelFill = costFitsInside ? '#ffffff' : '#475569';
      rows += '<text x="' + padX + '" y="' + rowCenterY + '" font-size="14" font-weight="600" fill="#111827" dominant-baseline="middle" font-family="-apple-system,PingFang SC,sans-serif">' + p.name + '</text>';
      rows += '<rect x="' + barX.toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + barH + '" rx="6" fill="' + color + '" opacity="0.4"/>';
      rows += '<rect x="' + barX.toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + costWidth.toFixed(1) + '" height="' + barH + '" rx="6" fill="' + color + '" opacity="0.95"/>';
      if (cost > 0) {
        rows += '<text x="' + costLabelX.toFixed(1) + '" y="' + rowCenterY + '" font-size="12" font-weight="600" fill="' + costLabelFill + '" dominant-baseline="middle" font-family="-apple-system,PingFang SC,sans-serif">' + costText + '</text>';
      }
      rows += '<text x="' + (barX + barWidth + 10).toFixed(1) + '" y="' + rowCenterY + '" font-size="12" font-weight="600" fill="#0f172a" dominant-baseline="middle" font-family="-apple-system,PingFang SC,sans-serif">' + valueText + '</text>';
      rows += '<text x="' + roiX + '" y="' + rowCenterY + '" text-anchor="end" font-size="15" font-weight="700" fill="#2563eb" dominant-baseline="middle" font-family="-apple-system,PingFang SC,sans-serif">' + roi.toFixed(1) + 'x</text>';
    });
    var legend = '<text x="' + (w - padX) + '" y="20" text-anchor="end" font-size="12" fill="#475569" font-family="-apple-system,PingFang SC,sans-serif"><tspan fill="#64748b">■</tspan> 人工价值</text>' +
      '<text x="' + (w - padX) + '" y="38" text-anchor="end" font-size="12" fill="#475569" font-family="-apple-system,PingFang SC,sans-serif"><tspan fill="#94a3b8">□</tspan> 算力豆支出</text>';
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      legend + rows + '</svg>';
  }

  // -- Donut with percentages --
  function svgDonutPro(data, size, centerLabel) {
    var total = data.reduce(function(a, d) { return a + d.value; }, 0);
    if (!total) return '';
    var cx = size / 2, cy = size / 2, r = size * 0.36, sw = size * 0.15;
    var circ = 2 * Math.PI * r;
    var offset = 0;
    var paths = data.map(function(d) {
      var pct = d.value / total;
      var dashLen = pct * circ;
      var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + d.color + '" stroke-width="' + sw + '" stroke-dasharray="' + dashLen.toFixed(2) + ' ' + (circ - dashLen).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      offset += dashLen;
      return s;
    }).join('');
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' + paths +
      '<text x="' + cx + '" y="' + (cy - 8) + '" text-anchor="middle" font-size="26" font-weight="800" fill="#09090b" font-family="-apple-system,PingFang SC,sans-serif">' + total + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" font-size="12" fill="#a1a1aa" font-family="-apple-system,PingFang SC,sans-serif">' + centerLabel + '</text></svg>';
  }

  function legendPro(data) {
    var total = data.reduce(function(a, d) { return a + d.value; }, 0);
    return data.map(function(d) {
      var pct = total > 0 ? Math.round(d.value / total * 100) : 0;
      return '<div style="display:flex;align-items:center;gap:10px;font-size:13px;padding:6px 0;border-bottom:1px solid #f4f4f5;">' +
        '<span style="width:10px;height:10px;border-radius:3px;background:' + d.color + ';flex-shrink:0;"></span>' +
        '<span style="color:#52525b;flex:1;">' + d.name + '</span>' +
        '<span style="font-weight:700;color:#09090b;min-width:36px;text-align:right;">' + d.value + '</span>' +
        '<span style="font-size:11px;color:#a1a1aa;min-width:36px;text-align:right;">' + pct + '%</span>' +
      '</div>';
    }).join('');
  }

  var s = function(css) { return css; }; // readability helper

  // ──────────── Section styles ────────────
  var sectionCard = 'background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 32px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04);';
  var sectionTitle = 'font-size:15px;font-weight:700;color:#0f172a;margin-bottom:16px;display:flex;align-items:center;gap:8px;';
  var sectionDot = 'width:4px;height:16px;border-radius:2px;background:#2563eb;';

  container.innerHTML =
    // ══════ HEADER ══════
    '<div style="background:linear-gradient(135deg,#0c1929 0%,#172554 35%,#1e3a8a 100%);padding:48px 56px 44px;position:relative;overflow:hidden;">' +
      // decorative elements
      '<div style="position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(59,130,246,0.12);"></div>' +
      '<div style="position:absolute;bottom:-60px;right:120px;width:160px;height:160px;border-radius:50%;background:rgba(96,165,250,0.08);"></div>' +
      '<div style="position:absolute;top:30px;right:200px;width:80px;height:80px;border-radius:50%;border:1px solid rgba(255,255,255,0.06);"></div>' +
      '<div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="display:flex;align-items:center;gap:16px;">' +
          '<div style="width:52px;height:52px;background:linear-gradient(135deg,#2563eb,#60a5fa);border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:#fff;box-shadow:0 8px 24px rgba(37,99,235,0.5);">好</div>' +
          '<div>' +
            '<div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:0.5px;">好麦 AI</div>' +
            '<div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:3px;">自动化获客效果报告</div>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="display:inline-block;padding:6px 18px;border-radius:20px;background:rgba(255,255,255,0.1);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.1);">' +
            '<span style="font-size:18px;font-weight:700;color:#fff;">' + dimLabels[dim] + '</span>' +
          '</div>' +
          '<div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:8px;">' + dateLabel + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div style="padding:28px 48px 40px;">' +

    // ══════ ROI HERO ══════
    '<div style="' + sectionCard + 'background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 60%,#bfdbfe 100%);border:1px solid #93c5fd;padding:36px 40px;">' +
      '<div style="display:flex;align-items:flex-start;gap:40px;">' +
        '<div style="flex-shrink:0;">' +
          '<div style="font-size:15px;font-weight:600;color:#475569;display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="display:inline-block;width:3px;height:16px;background:#2563eb;border-radius:2px;"></span>投入产出比</div>' +
          '<div style="font-size:72px;font-weight:900;line-height:1;color:#0f172a;">' + roiResult.roi.toFixed(1) + 'x</div>' +
          '<div style="font-size:13px;color:#64748b;margin-top:8px;">每 1 元算力豆 → ' + roiResult.roi.toFixed(1) + ' 元人工价值</div>' +
        '</div>' +
        '<div style="flex:1;display:flex;gap:16px;">' +
          // metric cards
          '<div style="flex:1;background:#fff;border-radius:12px;padding:18px 20px;border-left:3px solid #2563eb;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
            '<div style="font-size:11px;color:#94a3b8;font-weight:500;margin-bottom:6px;">人工价值</div>' +
            '<div style="font-size:26px;font-weight:800;color:#0f172a;">¥' + Math.round(roiResult.value).toLocaleString() + '</div>' +
          '</div>' +
          '<div style="flex:1;background:#fff;border-radius:12px;padding:18px 20px;border-left:3px solid #f59e0b;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
            '<div style="font-size:11px;color:#94a3b8;font-weight:500;margin-bottom:6px;">算力豆支出</div>' +
            '<div style="font-size:26px;font-weight:800;color:#0f172a;">¥' + Math.round(roiResult.cost).toLocaleString() + '</div>' +
          '</div>' +
          '<div style="flex:1;background:#fff;border-radius:12px;padding:18px 20px;border-left:3px solid #16a34a;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
            '<div style="font-size:11px;color:#94a3b8;font-weight:500;margin-bottom:6px;">净节省</div>' +
            '<div style="font-size:26px;font-weight:800;color:#16a34a;">¥' + Math.round(roiResult.saved).toLocaleString() + '</div>' +
            '<div style="font-size:11px;color:#16a34a;margin-top:2px;">节省 ' + roiResult.savedPct + '%</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // breakdown pills
      '<div style="display:flex;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid rgba(147,197,253,0.4);">' +
        roiResult.breakdown.filter(function(b){ return b.count > 0; }).map(function(b) {
          return '<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;background:#fff;font-size:12px;color:#475569;box-shadow:0 1px 2px rgba(0,0,0,0.04);">' +
            '<strong style="color:#0f172a;">' + b.label + '</strong>' + b.count + b.unit + ' × ¥' + b.unitPrice + ' = <strong style="color:#0f172a;">¥' + Math.round(b.subtotal) + '</strong></div>';
        }).join('') +
      '</div>' +
    '</div>' +

    // ══════ PLATFORM ROI BARS ══════
    (roiPlatforms.length > 0 ?
    '<div style="' + sectionCard + '">' +
      '<div style="' + sectionTitle + '"><div style="' + sectionDot + '"></div>各平台投入产出</div>' +
      svgPlatformBars() +
    '</div>' : '') +

    // ══════ HIGHLIGHT METRICS ══════
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">' +
      hl.slice(0,3).map(function(h, idx) {
        var ch = computeChange(h.value, h.prev);
        var dv = formatValue(h);
        var icons = ['<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'];
        var borderColors = ['#2563eb','#3b82f6','#60a5fa'];
        return '<div style="' + sectionCard + 'padding:22px 24px;border-left:3px solid ' + borderColors[idx] + ';">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' + icons[idx] + '<span style="font-size:12px;color:#64748b;font-weight:500;">' + h.label + '</span></div>' +
          '<div style="font-size:36px;font-weight:800;line-height:1.1;color:#0f172a;">' + dv + '</div>' +
          (ch.text ? '<div style="font-size:12px;color:' + (ch.up ? '#16a34a' : '#ef4444') + ';margin-top:8px;font-weight:600;">' + (ch.up ? '↑' : '↓') + ' ' + ch.text + ' 环比</div>' : '') +
        '</div>';
      }).join('') +
    '</div>' +

    // ══════ DONUTS SIDE BY SIDE ══════
    '<div style="display:flex;gap:16px;margin-bottom:20px;">' +
      '<div style="flex:1;' + sectionCard + '">' +
        '<div style="' + sectionTitle + '"><div style="' + sectionDot + '"></div>平台触达分布</div>' +
        '<div style="display:flex;align-items:center;gap:24px;">' +
          svgDonutPro(platformData, 200, '总触达') +
          '<div style="flex:1;">' + legendPro(platformData) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;' + sectionCard + '">' +
        '<div style="' + sectionTitle + '"><div style="' + sectionDot + '"></div>互动类型分布</div>' +
        '<div style="display:flex;align-items:center;gap:24px;">' +
          svgDonutPro(interactionData, 200, '总互动') +
          '<div style="flex:1;">' + legendPro(interactionData) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ══════ TREND LINE CHART ══════
    '<div style="' + sectionCard + '">' +
      '<div style="' + sectionTitle + '"><div style="' + sectionDot + '"></div>任务完成趋势</div>' +
      svgLine(chartData.labels, chartData.data || chartData.success, '#1d4ed8', 1100, 220) +
    '</div>' +

    // ══════ ACHIEVEMENTS ══════
    (achievements.length > 0 ?
    '<div style="' + sectionCard + '">' +
      '<div style="' + sectionTitle + '"><div style="' + sectionDot + '"></div>成果亮点</div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        achievements.map(function(a) {
          var bgMap = { gold:'#fffbeb', green:'#f0fdf4', purple:'#eff6ff', blue:'#eff6ff', orange:'#fff7ed' };
          var borderMap = { gold:'#fbbf24', green:'#22c55e', purple:'#3b82f6', blue:'#3b82f6', orange:'#f97316' };
          var colorMap = { gold:'#92400e', green:'#166534', purple:'#1e40af', blue:'#1e40af', orange:'#c2410c' };
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-radius:12px;background:' + (bgMap[a.theme]||bgMap.blue) + ';border:1px solid ' + (borderMap[a.theme]||borderMap.blue) + '22;font-size:13px;font-weight:600;color:' + (colorMap[a.theme]||colorMap.blue) + ';">' +
            '<span style="font-size:18px;">' + a.emoji + '</span>' + a.text +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>' : '') +

    // ══════ FOOTER ══════
    '<div style="margin-top:8px;padding-top:20px;border-top:1px solid #e2e8f0;">' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;">' +
        '<div style="width:24px;height:24px;background:linear-gradient(135deg,#2563eb,#60a5fa);border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;color:#fff;">好</div>' +
        '<span style="font-size:13px;font-weight:600;color:#64748b;">好麦 AI · ' + dimLabels[dim] + '</span>' +
      '</div>' +
      '<div style="text-align:center;font-size:11px;color:#94a3b8;">报告生成于 ' + genTime + ' · 数据仅供参考，以实际结算为准</div>' +
    '</div>' +

    '</div>';
  return container;
}

export async function generateReport() {
  var btn = document.getElementById('reportFab');
  if (!btn) return;
  var origHTML = btn.innerHTML;
  btn.innerHTML = '⏳ 生成中...';
  btn.style.pointerEvents = 'none';
  try {
    var container = buildReportHTML(currentReportDim);
    document.body.appendChild(container);
    var canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: null, logging: false });
    container.remove();
    canvas.toBlob(function(blob) {
      currentReportBlob = blob;
      var url = URL.createObjectURL(blob);
      document.getElementById('reportPreviewImg').src = url;
      document.getElementById('reportOverlay').classList.add('open');
    }, 'image/png');
  } catch(e) {
    alert('生成失败：' + e.message);
  } finally {
    btn.innerHTML = origHTML;
    btn.style.pointerEvents = '';
  }
}

export function closeReportPreview() {
  document.getElementById('reportOverlay').classList.remove('open');
}

export function saveReportImage() {
  if (!currentReportBlob) return;
  var dimLabels = { day:'日报', week:'周报', month:'月报' };
  var today = new Date().toISOString().slice(0, 10);
  var url = URL.createObjectURL(currentReportBlob);
  var a = document.createElement('a');
  a.href = url;
  a.download = '好麦AI' + dimLabels[currentReportDim] + '_' + today + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function renderROIPlatformCard(range?) {
  var r = range || '7d';
  var platforms = calcROIPlatforms(r).filter(function(p) { return p.comments + p.dms + p.likes + p.saves > 0; });
  var container = document.getElementById('roiPlatformCard');
  if (!container) return;
  if (!platforms.length) { container.style.display = 'none'; return; }
  container.style.display = '';
  var roiTotal = calcROI(r);
  container.innerHTML =
    '<div class="card-header"><div><div class="card-title">ROI 分平台明细</div><div class="card-desc">各平台投入产出对比</div></div></div>' +
    '<div class="card-body">' +
      '<div class="roi-platform-chart"><canvas id="roiPlatformCanvas"></canvas></div>' +
      '<div class="roi-platform-summary" id="roiPlatformSummary"></div>' +
    '</div>';
  var canvas = document.getElementById('roiPlatformCanvas') as HTMLCanvasElement;
  if (!canvas) return;
  var labels = platforms.map(function(p) { return p.name; });
  var values = platforms.map(function(p) { return Math.round(p.value); });
  var costs = platforms.map(function(p) { return Math.round(p.cost); });
  var rois = platforms.map(function(p) { return p.roi; });
  var colors = platforms.map(function(p) { return platformColors[p.name] || '#2563eb'; });
  var costColors = colors.map(function(c) { return c + '55'; });
  if (roiPlatformChart) roiPlatformChart.destroy();
  roiPlatformChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: '人工价值 (¥)', data: values, backgroundColor: colors, borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.6 },
        { label: '算力豆支出 (¥)', data: costs, backgroundColor: costColors, borderRadius: 6, barPercentage: 0.7, categoryPercentage: 0.6 },
        { label: 'ROI', type: 'line', data: rois, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', pointBackgroundColor: '#2563eb', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 7, pointHoverRadius: 9, borderWidth: 2.5, fill: false, yAxisID: 'yROI', tension: 0.3 } as any,
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 16, font: { size: 12 } } },
        tooltip: {
          backgroundColor: 'rgba(9,9,11,0.9)', titleFont: { size: 13 }, bodyFont: { size: 12 }, padding: 10, cornerRadius: 8,
          callbacks: { label: function(ctx) { if (ctx.dataset.label === 'ROI') return ' ROI: ' + ctx.parsed.y.toFixed(1) + 'x'; return ' ' + ctx.dataset.label.replace(/ \(¥\)/, '') + ': ¥' + ctx.parsed.y; } }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 13, weight: '500' }, color: '#52525b' } },
        y: { position: 'left', grid: { color: '#f4f4f5' }, ticks: { font: { size: 11 }, color: '#a1a1aa', callback: function(v) { return '¥' + v; } }, beginAtZero: true },
        yROI: { position: 'right', grid: { display: false }, ticks: { font: { size: 11, weight: '600' }, color: '#2563eb', callback: function(v) { return v.toFixed(1) + 'x'; } }, beginAtZero: true, suggestedMax: 4 }
      }
    }
  });
  var summaryEl = document.getElementById('roiPlatformSummary');
  if (summaryEl) {
    summaryEl.innerHTML =
      '<div class="roi-summary-item"><span class="roi-summary-label">总人工价值</span><span class="roi-summary-value">¥' + Math.round(roiTotal.value) + '</span></div>' +
      '<div class="roi-summary-item"><span class="roi-summary-label">总算力豆支出</span><span class="roi-summary-value">¥' + Math.round(roiTotal.cost) + '</span></div>' +
      '<div class="roi-summary-item"><span class="roi-summary-label">综合 ROI</span><span class="roi-summary-value" style="color:#2563eb;font-weight:700;">' + roiTotal.roi.toFixed(1) + 'x</span></div>' +
      '<div class="roi-summary-item"><span class="roi-summary-label">净节省</span><span class="roi-summary-value" style="color:#16a34a;">¥' + Math.round(roiTotal.saved) + '</span></div>';
  }
}

export async function switchReportDim(dim, btn) {
  currentReportDim = dim;
  btn.parentElement.querySelectorAll('.report-dim-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var saveBtn = document.getElementById('reportSaveBtn');
  saveBtn.textContent = '生成中...';
  saveBtn.disabled = true;
  try {
    var container = buildReportHTML(dim);
    document.body.appendChild(container);
    var canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: null, logging: false });
    container.remove();
    canvas.toBlob(function(blob) {
      currentReportBlob = blob;
      var url = URL.createObjectURL(currentReportBlob);
      document.getElementById('reportPreviewImg').src = url;
      saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 保存图片';
      saveBtn.disabled = false;
    }, 'image/png');
  } catch(e) {
    saveBtn.textContent = '生成失败';
    saveBtn.disabled = false;
  }
}
