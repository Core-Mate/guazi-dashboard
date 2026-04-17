import { Chart } from 'chart.js'
import { fetchDashboardData } from './api-integration'
import { formatCompareText } from './utils'

let currentReportBlob = null
let currentReportDim = 'week'
let roiPlatformChart = null

export function initROICard(_range?) {
  var numEl = document.getElementById('roiNumber');
  var descEl = document.getElementById('roiDesc');
  var valueEl = document.getElementById('roiValue');
  var costEl = document.getElementById('roiCost');
  var savedEl = document.getElementById('roiSaved');
  var bdEl = document.getElementById('roiBreakdown');
  if (numEl) numEl.textContent = '0.0x';
  if (descEl) descEl.textContent = '每投入 1 元算力豆，产出 0.0 元人工价值';
  if (valueEl) valueEl.textContent = '¥0';
  if (costEl) costEl.textContent = '¥0';
  if (savedEl) savedEl.textContent = '¥0 (0%)';
  if (bdEl) bdEl.innerHTML = '';
}

function roiNumber(value: any) {
  var num = typeof value === 'number' ? value : parseFloat(String(value || '').replace(/[^\d.-]/g, ''))
  return isNaN(num) ? 0 : num
}

export function renderRoiFromCharts(roi: any) {
  if (!roi) return
  var hero = document.getElementById('roiHero')
  if (hero) {
    hero.classList.remove('beta-overlay-wrap')
    hero.querySelectorAll('.beta-overlay').forEach(function(node) { node.remove() })
  }
  var roiValue = roiNumber(roi.roi)
  var value = roiNumber(roi.value)
  var cost = roiNumber(roi.cost)
  var saved = roiNumber(roi.saved)
  var savedPct = roiNumber(roi.saved_pct ?? roi.savedPct)
  var numEl = document.getElementById('roiNumber')
  var descEl = document.getElementById('roiDesc')
  var valueEl = document.getElementById('roiValue')
  var costEl = document.getElementById('roiCost')
  var savedEl = document.getElementById('roiSaved')
  var bdEl = document.getElementById('roiBreakdown')
  if (numEl) numEl.textContent = roiValue.toFixed(1) + 'x'
  if (descEl) descEl.textContent = roi.desc || ('每投入 1 元算力豆，产出 ' + roiValue.toFixed(1) + ' 元人工价值')
  if (valueEl) valueEl.textContent = '¥' + Math.round(value).toLocaleString()
  if (costEl) costEl.textContent = '¥' + Math.round(cost).toLocaleString()
  if (savedEl) savedEl.textContent = '¥' + Math.round(saved).toLocaleString() + ' (' + Math.round(savedPct) + '%)'
  if (bdEl) {
    var breakdown = Array.isArray(roi.breakdown) ? roi.breakdown : []
    bdEl.innerHTML = breakdown.map(function(item) {
      return '<div class="roi-breakdown-item"><strong>' + (item.label || item.name || '项目') + '</strong> ' +
        roiNumber(item.count).toLocaleString() + (item.unit || '') + ' → ¥' + Math.round(roiNumber(item.subtotal)).toLocaleString() + '</div>'
    }).join('')
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

function betaOverlayHTML(badge?: string, sub?: string) {
  return '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.75);display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:16px;z-index:2;">' +
    '<div style="padding:6px 16px;background:#2563eb;color:#fff;font-size:13px;font-weight:700;border-radius:20px;letter-spacing:1px;">' + (badge || 'Beta') + '</div>' +
    '<div style="font-size:12px;color:#64748b;margin-top:8px;">' + (sub || '数据即将上线') + '</div>' +
  '</div>';
}

async function buildReportHTML(dim) {
  var dimLabels = { day:'日报', week:'周报', month:'月报' };
  var dimData = { day:'today', week:'7d', month:'30d' };
  var compareLabels = { day:'较昨日', week:'较上周', month:'较上月' };
  var range = dimData[dim] || '7d';
  var dateLabel = getReportDateRange(dim);
  var fallbackHighlights = [];
  var fallbackAchievements = [];
  var fallbackPlatformData = [];
  var fallbackInteractionData = [];
  var fallbackTrendData: any = {
    labels: [],
    data: [],
    exec: [],
    success: [],
    failed: [],
    total: [],
    comments: [],
    likes: [],
    dms: [],
    reach: [],
    runtime: [],
    saves: [],
    cost: [],
    statRuntime: null,
    execChange: null,
    costWow: null,
    reachChange: null,
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asNumber(value) {
    if (typeof value === 'number') return isNaN(value) ? null : value;
    if (typeof value === 'string') {
      var cleaned = value.replace(/,/g, '').replace(/[^\d.+-]/g, '');
      if (!cleaned) return null;
      var parsed = parseFloat(cleaned);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  function toCount(value) {
    var num = asNumber(value);
    return num == null ? null : Math.max(0, Math.round(num));
  }

  function formatInteger(value) {
    var num = toCount(value);
    return num == null ? '—' : num.toLocaleString();
  }

  function formatRuntime(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'number' && !isNaN(value)) return Math.round(value) + 'h';
    return String(value);
  }

  function normalizeCompareText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function achievementCompareMeta(item) {
    var hasRawCompare = !!(item && item.current !== undefined && item.prev !== undefined);
    if (hasRawCompare) {
      var rawCompare = formatCompareText(asNumber(item.current) ?? 0, asNumber(item.prev) ?? 0, item && item.label || '', 'achievement');
      return { cls: rawCompare.cls, text: normalizeCompareText(rawCompare.text) };
    }

    var hasBestCompare = !!(item && item.bestCurrent !== undefined && item.bestPrev !== undefined);
    if (hasBestCompare) {
      var bestCompare = formatCompareText(asNumber(item.bestCurrent) ?? 0, asNumber(item.bestPrev) ?? 0, item && item.label || '', 'achievement');
      return { cls: bestCompare.cls, text: normalizeCompareText(bestCompare.text) };
    }

    var current = asNumber(item && item.value);
    var prev = asNumber(item && item.prev);
    if (current == null || prev == null) {
      return {
        cls: item && item.change_cls ? item.change_cls : 'flat',
        text: normalizeCompareText(item && item.text ? item.text : ''),
      };
    }
    var compare = formatCompareText(current == null ? 0 : current, prev, '', 'achievement');
    return { cls: compare.cls, text: normalizeCompareText(compare.text) };
  }

  function cardMatches(card, keys) {
    if (!card) return false;
    var key = String(card.key || '').toLowerCase();
    var label = String(card.label || '').toLowerCase();
    for (var i = 0; i < keys.length; i++) {
      var token = String(keys[i] || '').toLowerCase();
      if (!token) continue;
      if (key === token || key.indexOf(token) >= 0 || label.indexOf(token) >= 0) return true;
    }
    return false;
  }

  function cardHasSeries(card) {
    return !!(card && card.series && safeArray(card.series.values).length);
  }

  function findCard(cards, keys, requireSeries) {
    var list = safeArray(cards);
    for (var i = 0; i < list.length; i++) {
      if (cardMatches(list[i], keys) && (!requireSeries || cardHasSeries(list[i]))) return list[i];
    }
    if (!requireSeries) return null;
    for (var j = 0; j < list.length; j++) {
      if (cardHasSeries(list[j])) return list[j];
    }
    return null;
  }

  function renderTrendMeta(curValue, prevValue) {
    var compare = formatCompareText(curValue ?? 0, prevValue, compareLabel);
    if (compare.cls === 'up') return { arrow: '↗', color: '#16a34a', text: compare.text };
    if (compare.cls === 'down') return { arrow: '↘', color: '#dc2626', text: compare.text };
    return {
      arrow: '→',
      color: compare.text.indexOf('暂无对比') >= 0 ? '#94a3b8' : '#64748b',
      text: compare.text,
    };
  }

  function renderTrendText(card) {
    var meta = renderTrendMeta(asNumber(card && card.value), asNumber(card && card.prev));
    return '<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:' + meta.color + ';"><span>' + meta.arrow + '</span><span>' + esc(meta.text) + '</span></div>';
  }

  function normalizeBreakdown(items, palette) {
    return safeArray(items).map(function(item, index) {
      return {
        name: item && (item.name || item.label || ('项目' + (index + 1))),
        value: Math.max(0, Math.round(asNumber(item && (item.value ?? item.count ?? item.total ?? item.amount)) || 0)),
        color: item && item.color || palette[index % palette.length],
      };
    }).filter(function(item) {
      return item.value > 0;
    }).sort(function(a, b) {
      return b.value - a.value;
    });
  }

  function legendHTML(items) {
    var total = safeArray(items).reduce(function(sum, item) { return sum + item.value; }, 0) || 1;
    return safeArray(items).map(function(item) {
      var pct = Math.round(item.value / total * 100);
      return '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;">' +
        '<span style="width:10px;height:10px;border-radius:999px;background:' + item.color + ';flex-shrink:0;display:inline-block;"></span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(item.name) + '</span>' +
        '<span style="margin-left:auto;font-weight:700;color:#0f172a;">' + pct + '%</span>' +
      '</div>';
    }).join('');
  }

  function placeholderHTML(text) {
    return '<div style="height:220px;display:flex;align-items:center;justify-content:center;font-size:14px;color:#94a3b8;">' + esc(text || '暂无数据') + '</div>';
  }

  function lineChartHTML(labels, values) {
    if (!safeArray(values).length) return placeholderHTML('暂无数据');
    var chartLabels = safeArray(labels).slice();
    var chartValues = safeArray(values).map(function(value) {
      var num = asNumber(value);
      return num == null ? 0 : num;
    });
    if (chartValues.length === 1) {
      chartValues.push(chartValues[0]);
      chartLabels.push(chartLabels[0] || '');
    }
    var width = 640;
    var height = 220;
    var padL = 42;
    var padR = 16;
    var padT = 16;
    var padB = 32;
    var plotW = width - padL - padR;
    var plotH = height - padT - padB;
    var max = Math.max.apply(null, chartValues);
    var min = Math.min.apply(null, chartValues);
    if (max === min) {
      max += 1;
      min = Math.max(0, min - 1);
    }
    var grid = '';
    for (var i = 0; i <= 4; i++) {
      var y = padT + plotH * (i / 4);
      var val = Math.round(max - (max - min) * (i / 4));
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (width - padR) + '" y2="' + y.toFixed(1) + '" stroke="#e2e8f0" stroke-width="1"/>';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,PingFang SC,Segoe UI,sans-serif">' + val + '</text>';
    }
    var points = chartValues.map(function(value, index) {
      var x = padL + (plotW * index / Math.max(1, chartValues.length - 1));
      var y = padT + plotH - ((value - min) / (max - min)) * plotH;
      return { x: x, y: y, value: value };
    });
    var polyline = points.map(function(point) {
      return point.x.toFixed(1) + ',' + point.y.toFixed(1);
    }).join(' ');
    var skip = Math.max(1, Math.ceil(chartLabels.length / 6));
    var xLabels = '';
    for (var j = 0; j < chartLabels.length; j++) {
      if (j % skip === 0 || j === chartLabels.length - 1) {
        var labelX = padL + (plotW * j / Math.max(1, chartLabels.length - 1));
        xLabels += '<text x="' + labelX.toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle" font-size="10" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,PingFang SC,Segoe UI,sans-serif">' + esc(chartLabels[j] || '') + '</text>';
      }
    }
    var dots = points.map(function(point, index) {
      var r = index === points.length - 1 ? 4 : 3;
      var fill = index === points.length - 1 ? '#1d4ed8' : '#60a5fa';
      return '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="' + r + '" fill="' + fill + '" stroke="#ffffff" stroke-width="2"/>';
    }).join('');
    return '<svg width="100%" height="220" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      grid +
      xLabels +
      '<polyline points="' + polyline + '" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      dots +
    '</svg>';
  }

  function sectionHeading(title) {
    return '<div style="display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#1e293b;">' +
      '<span style="width:3px;height:18px;border-radius:999px;background:#3b82f6;display:inline-block;"></span>' +
      '<span>' + esc(title) + '</span>' +
    '</div>';
  }

  function miniSparklineHTML(values, color) {
    var arr = safeArray(values).map(function(v){ var n = asNumber(v); return n == null ? 0 : n; });
    if (!arr.length) {
      return '<div style="height:48px;background:#f1f5f9;border-radius:8px;"></div>';
    }
    if (arr.length === 1) arr.push(arr[0]);
    var w = 220, h = 48, pad = 4;
    var plotW = w - pad * 2, plotH = h - pad * 2;
    var max = Math.max.apply(null, arr);
    var min = Math.min.apply(null, arr);
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    var coords = arr.map(function(v, i) {
      var x = pad + (plotW * i / Math.max(1, arr.length - 1));
      var y = pad + plotH - ((v - min) / (max - min)) * plotH;
      return { x: x, y: y };
    });
    var polyline = coords.map(function(p){ return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var last = coords[coords.length - 1];
    var areaPoints = pad + ',' + (h - pad) + ' ' + polyline + ' ' + (w - pad) + ',' + (h - pad);
    var gradId = 'spark-grad-' + Math.round(Math.random() * 1e9);
    return '<svg width="100%" height="48" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.28"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<polygon points="' + areaPoints + '" fill="url(#' + gradId + ')"/>' +
      '<polyline points="' + polyline + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3" fill="' + color + '"/>' +
    '</svg>';
  }

  function keyMetricCardHTML(card, accent) {
    var label = card && card.label || '—';
    var rawValue = card && card.value;
    var value = rawValue == null || rawValue === '' ? '—' : formatInteger(rawValue);
    var seriesValues = card && card.series && safeArray(card.series.values).length
      ? card.series.values
      : safeArray(card && card.sparkline);
    return '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;box-shadow:0 10px 24px rgba(15,23,42,0.05);display:flex;flex-direction:column;gap:12px;min-height:176px;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span style="width:6px;height:6px;border-radius:999px;background:' + accent + ';display:inline-block;"></span>' +
        '<span style="font-size:13px;font-weight:600;color:#475569;">' + esc(label) + '</span>' +
      '</div>' +
      '<div style="font-size:34px;line-height:1.05;font-weight:800;color:#0f172a;letter-spacing:-0.02em;">' + esc(value) + '</div>' +
      '<div>' + renderTrendText(card) + '</div>' +
      '<div style="margin-top:auto;">' + miniSparklineHTML(seriesValues, accent) + '</div>' +
    '</div>';
  }

  function opsSummaryRowHTML(items) {
    var cells = safeArray(items).map(function(item, idx) {
      var border = idx === 0 ? 'none' : '1px solid #e2e8f0';
      var current = asNumber(item && item.current);
      var compare = formatCompareText(current == null ? 0 : current, item && item.prev, item && item.label || '');
      var changeHTML = '<div class="hl-change-inline ' + compare.cls + '" style="margin-top:4px;font-size:13px;font-weight:600;">' + esc(normalizeCompareText(compare.text)) + '</div>';
      return '<div style="min-width:0;padding:0 24px;display:flex;flex-direction:column;gap:8px;border-left:' + border + ';">' +
        '<span style="font-size:12px;font-weight:600;color:#64748b;letter-spacing:0.02em;">' + esc(item && item.label || '') + '</span>' +
        '<div style="display:flex;align-items:baseline;gap:8px;min-width:0;">' +
          '<span style="font-size:24px;font-weight:800;color:#0f172a;line-height:1.1;">' + esc(item && item.value != null && item.value !== '' ? item.value : '—') + '</span>' +
        '</div>' +
        changeHTML +
      '</div>';
    }).join('');
    return '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:22px 4px;box-shadow:0 10px 24px rgba(15,23,42,0.04);display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;">' + cells + '</div>';
  }

  function findByKey(cards, keyName) {
    var list = safeArray(cards);
    var wanted = String(keyName || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].key || '').toLowerCase() === wanted) return list[i];
    }
    return null;
  }

  function renderBreakdownPanel(title, data, centerLabel, caption) {
    return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;min-height:320px;">' +
      '<div style="font-size:15px;font-weight:700;color:#0f172a;">' + esc(title) + '</div>' +
      (safeArray(data).length
        ? '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;flex:1;">' +
            svgDonut(data, 160, centerLabel) +
            '<div style="width:100%;display:flex;flex-direction:column;gap:8px;">' + legendHTML(data) + '</div>' +
          '</div>'
        : placeholderHTML('暂无数据')) +
      '<div style="font-size:13px;color:#64748b;line-height:1.5;">' + esc(caption) + '</div>' +
    '</div>';
  }

  var snap = null;
  try {
    snap = await fetchDashboardData(range);
  } catch (_err) {
    snap = null;
  }

  var compareLabel = snap && snap.highlights && snap.highlights.compare_label
    ? snap.highlights.compare_label
    : (compareLabels[dim] || compareLabels.week);
  var highlightCards = snap && snap.highlights && safeArray(snap.highlights.cards).length
    ? snap.highlights.cards
    : fallbackHighlights;
  var achievements = snap && snap.achievements && safeArray(snap.achievements.achievements).length
    ? snap.achievements.achievements
    : fallbackAchievements;
  var platformBreakdown = snap && snap.charts && safeArray(snap.charts.platform_breakdown).length
    ? snap.charts.platform_breakdown
    : fallbackPlatformData;
  var interactionBreakdown = snap && snap.charts && safeArray(snap.charts.interaction_breakdown).length
    ? snap.charts.interaction_breakdown
    : fallbackInteractionData;
  var miniStats = snap && snap.charts && snap.charts.mini_stats ? snap.charts.mini_stats : {};
  var accountTotals = snap && ((snap as any).account_totals || (snap.aggs && snap.aggs.account_totals)) ? ((snap as any).account_totals || snap.aggs.account_totals) : {};

  var execCard = findByKey(highlightCards, 'successCount') || findCard(highlightCards, ['successcount'], false);
  var runtimeCard = findCard(highlightCards, ['runtime', 'duration', 'hours', '时长'], false);
  var costCard = findCard(highlightCards, ['credit', 'credits', 'cost', 'token', '豆'], false);
  var reachCard = findCard(highlightCards, ['reach', 'impression', 'impressions', '触达'], false);
  var trendCard = findByKey(highlightCards, 'successCount');
  if (!trendCard || !cardHasSeries(trendCard)) trendCard = findCard(highlightCards, ['successcount'], true);
  if (!trendCard) trendCard = findCard(highlightCards, ['reach', 'impression', '触达'], true);
  if (!trendCard) trendCard = findCard(highlightCards, [], true);

  var execValue = miniStats && (miniStats.successCount ?? miniStats.success_count);
  if (execValue == null) execValue = execCard && execCard.value;
  if (execValue == null) execValue = accountTotals && (accountTotals.successCount ?? accountTotals.success_count);

  var runtimeValue = miniStats && (miniStats.runtime ?? miniStats.total_duration ?? miniStats.total_duration_hours);
  if (runtimeValue == null) runtimeValue = runtimeCard && runtimeCard.value;
  if (runtimeValue == null && fallbackTrendData && fallbackTrendData.statRuntime) runtimeValue = fallbackTrendData.statRuntime;

  var costValue = miniStats && (miniStats.cost ?? miniStats.credits ?? miniStats.token_used);
  if (costValue == null) costValue = costCard && costCard.value;
  if (costValue == null) costValue = accountTotals && (accountTotals.token_used ?? accountTotals.credits);

  var execPrev = miniStats && (miniStats.successCountPrev ?? miniStats.success_count_prev);
  if (execPrev == null) execPrev = execCard ? asNumber(execCard.prev) : null;
  var runtimePrev = miniStats && (miniStats.runtimePrev ?? miniStats.runtime_prev);
  if (runtimePrev == null) runtimePrev = runtimeCard ? asNumber(runtimeCard.prev) : null;
  var costPrev = miniStats && (miniStats.costPrev ?? miniStats.cost_prev);
  if (costPrev == null) costPrev = costCard ? asNumber(costCard.prev) : null;

  var trendLabels = trendCard && trendCard.series && safeArray(trendCard.series.labels).length
    ? safeArray(trendCard.series.labels)
    : safeArray(fallbackTrendData.labels);
  var trendValues = trendCard && trendCard.series && safeArray(trendCard.series.values).length
    ? safeArray(trendCard.series.values)
    : safeArray(fallbackTrendData.success);
  if (!safeArray(trendValues).length && reachCard && reachCard.series && safeArray(reachCard.series.values).length) {
    trendLabels = safeArray(reachCard.series.labels);
    trendValues = safeArray(reachCard.series.values);
  }
  if (!safeArray(trendValues).length) {
    trendLabels = [];
    trendValues = [];
  }

  var platformPalette = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#1d4ed8'];
  var interactionPalette = ['#0f172a', '#2563eb', '#3b82f6', '#60a5fa', '#94a3b8'];
  var platformDonutData = normalizeBreakdown(platformBreakdown, platformPalette);
  var interactionDonutData = normalizeBreakdown(interactionBreakdown, interactionPalette);

  var platformCaption = '暂无数据';
  if (platformDonutData.length) {
    var platformTotal = platformDonutData.reduce(function(sum, item) { return sum + item.value; }, 0) || 1;
    platformCaption = platformDonutData[0].name + ' 占 ' + Math.round(platformDonutData[0].value / platformTotal * 100) + '%';
  }
  var interactionCaption = '暂无数据';
  if (interactionDonutData.length) {
    var interactionTotal = interactionDonutData.reduce(function(sum, item) { return sum + item.value; }, 0) || 1;
    interactionCaption = interactionDonutData[0].name + ' 占 ' + Math.round(interactionDonutData[0].value / interactionTotal * 100) + '%';
  }

  var achievementCards = safeArray(achievements).slice(0, 3);
  var achievementHTML = achievementCards.map(function(item) {
    var compare = achievementCompareMeta(item);
    var headline = item && (item.headline || item.text) || '本周有亮点';
    var showCompare = !!compare.text && compare.text !== headline;
    var theme = item && item.theme || (compare.cls === 'up' ? 'green' : compare.cls === 'down' ? 'orange' : 'blue');
    return '<div class="achievement-tag achieve-' + esc(theme) + '">' +
      '<div class="achieve-row1">' +
        '<span class="achieve-emoji">' + esc(item && item.emoji || '✨') + '</span>' +
        '<span class="achieve-headline">' + esc(headline) + '</span>' +
        (showCompare ? '<span class="achieve-change hl-change-inline ' + compare.cls + '" style="margin:0;">' + esc(compare.text) + '</span>' : '') +
        '<span class="achieve-detail">' + esc(item && (item.detail || item.compare || item.copy) || compareLabel + ' 表现平稳。') + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
  if (!achievementHTML) {
    achievementHTML = '<div class="achievement-tag achieve-gold"><div class="achieve-row1"><span class="achieve-emoji">✨</span><span class="achieve-headline">暂无亮点数据</span></div></div>';
  }

  var trendCaption = renderTrendMeta(asNumber(trendCard && trendCard.value), asNumber(trendCard && trendCard.prev)).text;

  // 5 核心互动指标（顺序与调色板和效果总览里的 highlightGrid 对齐）
  var keyMetricDefs = [
    { key: 'comments', fallbackLabel: '评论数',  color: '#2563eb' },
    { key: 'likes',    fallbackLabel: '点赞数',  color: '#3b82f6' },
    { key: 'saves',    fallbackLabel: '收藏数',  color: '#60a5fa' },
    { key: 'dms',      fallbackLabel: '私信数',  color: '#6366f1' },
    { key: 'reach',    fallbackLabel: '触达量',  color: '#8b5cf6' },
  ];
  var keyMetricsHTML = keyMetricDefs.map(function(def) {
    var card = findByKey(highlightCards, def.key);
    if (!card) card = findCard(highlightCards, [def.key, def.fallbackLabel], false);
    if (!card) card = { label: def.fallbackLabel, value: null, series: { values: [] } };
    return keyMetricCardHTML(card, def.color);
  }).join('');

  var opsRowHTML = opsSummaryRowHTML([
    { label: '完成',          value: formatInteger(execValue),    current: execValue,    prev: execPrev },
    { label: '累计运行时长',  value: formatRuntime(runtimeValue), current: runtimeValue, prev: runtimePrev },
    { label: '消耗算力豆',    value: formatInteger(costValue),    current: costValue,    prev: costPrev },
  ]);

  var container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
  container.innerHTML =
    '<div style="width:1280px;background:#ffffff;padding:32px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,PingFang SC,Segoe UI,sans-serif;color:#0f172a;">' +
      '<div style="display:flex;flex-direction:column;gap:32px;">' +
        '<section>' +
          '<div style="background:linear-gradient(135deg,#020617 0%,#111827 100%);border-radius:24px;padding:28px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px;">' +
            '<div style="display:flex;align-items:center;gap:16px;">' +
              '<div style="width:56px;height:56px;border-radius:18px;background:rgba(59,130,246,0.18);border:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#ffffff;">好</div>' +
              '<div>' +
                '<div style="font-size:13px;font-weight:700;color:#93c5fd;letter-spacing:0.08em;">好麦 AI · ' + esc(dimLabels[dim] || dimLabels.week) + '</div>' +
                '<div style="font-size:32px;line-height:1.15;font-weight:800;color:#ffffff;margin-top:6px;">经营效果总览</div>' +
              '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<div style="font-size:13px;color:rgba(255,255,255,0.58);">统计周期</div>' +
              '<div style="font-size:18px;font-weight:700;color:#ffffff;margin-top:6px;">' + esc(dateLabel) + '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section style="display:flex;flex-direction:column;gap:18px;">' +
          sectionHeading('关键指标') +
          '<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;">' + keyMetricsHTML + '</div>' +
        '</section>' +

        '<section style="display:flex;flex-direction:column;gap:18px;">' +
          sectionHeading(dim === 'day' ? '今日亮点' : dim === 'month' ? '本月亮点' : '本周亮点') +
          '<div class="achievement-bar" style="margin-bottom:0;padding:0;">' + achievementHTML + '</div>' +
        '</section>' +

        '<section style="display:flex;flex-direction:column;gap:18px;">' +
          sectionHeading('运营概览') +
          opsRowHTML +
        '</section>' +

        '<section style="display:flex;flex-direction:column;gap:18px;">' +
          sectionHeading('数据趋势') +
          '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;padding:24px;box-shadow:0 12px 28px rgba(15,23,42,0.05);">' +
            '<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:24px;align-items:stretch;">' +
              '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px;min-height:320px;">' +
                '<div style="font-size:15px;font-weight:700;color:#0f172a;">完成趋势</div>' +
                '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:10px;flex:1;display:flex;align-items:center;justify-content:center;">' +
                  (safeArray(trendValues).length ? lineChartHTML(trendLabels, trendValues) : placeholderHTML('暂无数据')) +
                '</div>' +
                '<div style="font-size:13px;color:#64748b;line-height:1.5;">' + esc(trendCaption) + '</div>' +
              '</div>' +
              renderBreakdownPanel('平台分布', platformDonutData, '平台', platformCaption) +
              renderBreakdownPanel('互动类型分布', interactionDonutData, '互动', interactionCaption) +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section style="display:flex;flex-direction:column;gap:18px;">' +
          sectionHeading('ROI') +
          '<div style="background:linear-gradient(135deg, #f8fafc, #e2e8f0);opacity:0.75;border-radius:16px;padding:48px 32px;text-align:center;display:flex;align-items:center;justify-content:center;min-height:180px;">' +
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;">' +
              '<div style="font-size:2.5rem;line-height:1;">🔒</div>' +
              '<div style="font-size:24px;font-weight:800;color:#64748b;">ROI 即将到来</div>' +
              '<div style="font-size:14px;color:#94a3b8;">人工价值 vs 算力豆支出对比，敬请期待</div>' +
            '</div>' +
          '</div>' +
        '</section>' +
      '</div>' +
    '</div>';
  return container;
}

export async function generateReport() {
  var btn = document.getElementById('reportFab') as HTMLButtonElement | null;
  if (!btn) return;
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    var container = await buildReportHTML(currentReportDim);
    document.body.appendChild(container);
    var canvas;
    try {
      canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: null, logging: false });
    } finally {
      container.remove();
    }
    var blob = await new Promise<Blob>(function(resolve, reject) {
      canvas.toBlob(function(nextBlob) {
        if (nextBlob) {
          resolve(nextBlob);
          return;
        }
        reject(new Error('生成图片失败'));
      }, 'image/png');
    });
    currentReportBlob = blob;
    var url = URL.createObjectURL(blob);
    var previewImg = document.getElementById('reportPreviewImg') as HTMLImageElement | null;
    if (previewImg) previewImg.src = url;
    var overlay = document.getElementById('reportOverlay');
    if (overlay) overlay.classList.add('open');
    var panel = document.querySelector('#reportOverlay .report-container') as HTMLElement | null;
    if (panel) {
      panel.classList.remove('report-panel');
      void panel.offsetHeight;
      panel.classList.add('report-panel');
    }
    var wrap = document.querySelector('#reportOverlay .report-body') as HTMLElement | null;
    if (wrap && wrap.id !== 'reportContent') wrap.id = 'reportContent';
  } catch(e) {
    var message = e instanceof Error ? e.message : String(e);
    alert('生成失败：' + message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
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

export function renderROIPlatformCard(_range?) {
  var container = document.getElementById('roiPlatformCard');
  if (!container) return;
  if (roiPlatformChart) {
    roiPlatformChart.destroy();
    roiPlatformChart = null;
  }
  container.style.display = 'none';
}

export async function switchReportDim(dim, btn) {
  currentReportDim = dim;
  btn.parentElement.querySelectorAll('.report-dim-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var saveBtn = document.getElementById('reportSaveBtn') as HTMLButtonElement | null;
  if (!saveBtn) return;
  saveBtn.textContent = '生成中...';
  saveBtn.disabled = true;
  try {
    var container = await buildReportHTML(dim);
    document.body.appendChild(container);
    var canvas;
    try {
      canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: null, logging: false });
    } finally {
      container.remove();
    }
    var blob = await new Promise<Blob>(function(resolve, reject) {
      canvas.toBlob(function(nextBlob) {
        if (nextBlob) {
          resolve(nextBlob);
          return;
        }
        reject(new Error('生成图片失败'));
      }, 'image/png');
    });
    currentReportBlob = blob;
    var url = URL.createObjectURL(currentReportBlob);
    var previewImg = document.getElementById('reportPreviewImg') as HTMLImageElement | null;
    if (previewImg) previewImg.src = url;
    saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 保存图片';
    var wrap = document.querySelector('#reportOverlay .report-body') as HTMLElement | null;
    if (wrap && wrap.id !== 'reportContent') wrap.id = 'reportContent';
    wrap = document.getElementById('reportContent');
    if (wrap) {
      wrap.classList.remove('report-content-enter');
      void wrap.offsetHeight;
      wrap.classList.add('report-content-enter');
    }
  } catch(e) {
    saveBtn.textContent = '生成失败';
  } finally {
    saveBtn.disabled = false;
  }
}
