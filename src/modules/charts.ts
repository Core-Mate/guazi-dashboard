import { Chart } from 'chart.js'

function getCNCurrentHour(): number {
  try {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      hour: 'numeric'
    });
    var h = parseInt(fmt.format(new Date()), 10);
    if (isNaN(h)) return new Date().getHours();
    if (h === 24) h = 0;
    return h;
  } catch {
    return new Date().getHours();
  }
}

const futureHourMaskPlugin = {
  id: 'futureHourMask',
  afterDatasetsDraw(chart: any) {
    if (!chart.$futureMaskEnabled) return;
    const state = chart.$futureHourMask;
    if (!state || !state.enabled) return;
    const cutoffIdx: number = state.cutoffIndex;
    if (typeof cutoffIdx !== 'number') return;
    const ctx: CanvasRenderingContext2D = chart.ctx;
    const xScale = chart.scales && chart.scales.x;
    const area = chart.chartArea;
    if (!xScale || !area) return;
    let startX: number = xScale.getPixelForValue(cutoffIdx + 0.5);
    if (startX < area.left) startX = area.left;
    if (startX >= area.right) return;
    ctx.save();
    ctx.fillStyle = 'rgba(148,163,184,0.18)';
    ctx.fillRect(startX, area.top, area.right - startX, area.bottom - area.top);
    ctx.restore();
  }
};

Chart.register(futureHourMaskPlugin);

import { ttOpts, lineBase, axBase, chartBase, INTERACTION_BREAKDOWN } from '../data/charts'
import { SPARK_COLORS, formatValue } from '../data/highlights'
import { PLATFORM_BREAKDOWN } from '../data/platforms'
import { renderAchievements } from './achievements'
import { downloadCSV } from './export-utils'
import { animateNumber } from './animate'
import type { HighlightCard } from './api-integration'
import { formatCompareText, getContentClampBounds } from './utils'

let costChart, opsExecChart;
let donutChartInstance = null;
let interactionDonutInstance = null;
let currentRange = '7d';
let _popoutChart = null;
let _highlightFloatingPopout: HTMLElement | null = null;
let _activeHighlightPopoutIdx = -1;
let _highlightPopoutViewportBound = false;
let lastOpsData: any = null;
let rawSeries: Record<string, number[]> = {};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTrendLabel(value) {
  if (typeof value !== 'string') return String(value || '');
  if (/^\d{2}:\d{2}$/.test(value) || /^\d{1,2}\/\d{1,2}$/.test(value)) return value;
  return value.length > 10
    ? value.substring(11, 13) + ':00'
    : value.slice(5).replace('-', '/');
}

function getTrendSeries(source, key, fallback = []) {
  var series = source && Array.isArray(source[key]) ? source[key] : null;
  return series && series.length ? series : fallback;
}

function getTaskSeries(source, fallback = []) {
  return getTrendSeries(source, 'success', fallback);
}

function getOpsChartData(range, opsData?): any {
  var emptySource: any = {
    labels: [],
    data: [],
    success: [],
    failed: [],
    total: [],
    comments: [],
    likes: [],
    dms: [],
    reach: [],
    runtime: [],
    saves: [],
    favorites: [],
    credits: [],
    cost: [],
    costAvg: '',
    trendDesc: '',
  };
  var liveSource = opsData || lastOpsData;
  var labelSource = liveSource && Array.isArray(liveSource.labels) && liveSource.labels.length
    ? liveSource.labels
    : (liveSource && Array.isArray(liveSource.dates) && liveSource.dates.length ? liveSource.dates : []);
  var labels = labelSource.length
    ? labelSource.map(formatTrendLabel)
    : (emptySource.labels || []);
  return Object.assign({}, emptySource, {
    labels: labels,
    data: getTaskSeries(liveSource, emptySource.success || []),
    success: getTaskSeries(liveSource, emptySource.success || []),
    failed: getTrendSeries(liveSource, 'failed', emptySource.failed || []),
    total: getTrendSeries(liveSource, 'total', emptySource.total || emptySource.data || []),
    comments: getTrendSeries(liveSource, 'comments', emptySource.comments || []),
    likes: getTrendSeries(liveSource, 'likes', emptySource.likes || []),
    dms: getTrendSeries(liveSource, 'dms', emptySource.dms || []),
    reach: getTrendSeries(liveSource, 'reach', emptySource.reach || []),
    runtime: getTrendSeries(liveSource, 'runtime', emptySource.runtime || []),
    saves: getTrendSeries(liveSource, 'saves', getTrendSeries(liveSource, 'favorites', emptySource.saves || emptySource.favorites || [])),
    credits: getTrendSeries(liveSource, 'credits', getTrendSeries(liveSource, 'cost', emptySource.credits || emptySource.cost || [])),
  });
}

var keyToSeries: Record<string, any> = {
  tasks: {
    label: '完成',
    color: '#2563eb',
    fill: 'rgba(37,99,235,0.08)',
    unit: '次',
    keys: ['data', 'success']
  },
  runtime: {
    label: '运行任务时长',
    color: '#0891b2',
    fill: 'rgba(8,145,178,0.08)',
    unit: '小时',
    keys: ['runtime']
  },
  comments: {
    label: '评论',
    color: '#16a34a',
    fill: 'rgba(22,163,74,0.08)',
    unit: '条',
    keys: ['comments']
  },
  likes: {
    label: '点赞',
    color: '#f59e0b',
    fill: 'rgba(245,158,11,0.08)',
    unit: '次',
    keys: ['likes']
  },
  saves: {
    label: '收藏',
    color: '#db2777',
    fill: 'rgba(219,39,119,0.08)',
    unit: '次',
    keys: ['saves', 'favorites']
  },
  dms: {
    label: '私信',
    color: '#7c3aed',
    fill: 'rgba(124,58,237,0.08)',
    unit: '条',
    keys: ['dms']
  },
  reach: {
    label: '触达量',
    color: '#0ea5e9',
    fill: 'rgba(14,165,233,0.08)',
    unit: '人',
    keys: ['reach']
  },
  credits: {
    label: '算力豆',
    color: '#ea580c',
    fill: 'rgba(234,88,12,0.08)',
    unit: '颗',
    keys: ['credits', 'cost']
  }
};

function normalizeTrendKey(key) {
  return key === 'success' ? 'tasks' : key;
}

function getTrendToggleGroup() {
  var chartEl = document.getElementById('opsTaskChart');
  var parent = chartEl && chartEl.closest ? chartEl.closest('.card-body') : null;
  return parent ? parent.querySelector('.chart-toggles') : document.querySelector('.chart-toggles');
}

function getTrendToggles() {
  var group = getTrendToggleGroup();
  if (!group) return [];
  return Array.prototype.slice.call(group.querySelectorAll('.chart-toggle'));
}

function getTrendValues(source, keys) {
  if (!source || !Array.isArray(keys)) return [];
  for (var i = 0; i < keys.length; i++) {
    var values = source[keys[i]];
    if (Array.isArray(values) && values.length) return values;
  }
  return [];
}

function buildTrendAxisTitle(text) {
  return {
    display: true,
    text: text,
    color: '#a1a1aa',
    font: { size: 11 }
  };
}

function sanitizeTrendValues(values) {
  return (values || []).map(function(value) {
    var num = Number(value);
    return isFinite(num) ? num : 0;
  });
}

function rebuildRawSeries(source) {
  rawSeries = {};
  Object.keys(keyToSeries).forEach(function(key) {
    rawSeries[key] = sanitizeTrendValues(getTrendValues(source, keyToSeries[key].keys));
  });
}

function buildTrendDatasets() {
  return Object.keys(keyToSeries).map(function(key) {
    var cur = keyToSeries[key];
    var dataset: any = {
      _key: key,
      label: cur.label,
      data: (rawSeries[key] || []).slice(),
      borderColor: cur.color,
      backgroundColor: cur.fill,
      fill: false,
      hidden: true,
      ...lineBase
    };
    return dataset;
  });
}

function getActiveTrendKeys() {
  var seen = {};
  return getTrendToggles()
    .filter(function(toggle) {
      return toggle.classList.contains('active');
    })
    .map(function(toggle) {
      return normalizeTrendKey(toggle.dataset.key || '');
    })
    .filter(function(key) {
      if (!keyToSeries[key] || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

function getTrendKeyFromDataset(dataset) {
  var key = normalizeTrendKey((dataset && dataset._key) || '');
  if (keyToSeries[key]) return key;
  var label = dataset && dataset.label;
  var matchedKey = Object.keys(keyToSeries).find(function(itemKey) {
    return keyToSeries[itemKey].label === label;
  });
  return matchedKey || 'tasks';
}

function getTrendTooltipLabel(context) {
  var dataset: any = context && context.dataset ? context.dataset : {};
  var key = getTrendKeyFromDataset(dataset);
  var cur = keyToSeries[key];
  var rawValue = Number((rawSeries[key] || [])[context.dataIndex] || 0);
  return cur.label + ': ' + rawValue.toLocaleString() + ' ' + cur.unit;
}

export function applyTrendDisplayMode(range?: string) {
  if (!costChart) return;
  var trendRange = range || currentRange;
  var activeKeys = getActiveTrendKeys();
  var activeCount = activeKeys.length;
  var activeMap = {};
  activeKeys.forEach(function(key) {
    activeMap[key] = true;
  });

  (costChart.data.datasets || []).forEach(function(dataset: any) {
    var key = getTrendKeyFromDataset(dataset);
    var values = (rawSeries[key] || []).slice();
    dataset.hidden = !activeMap[key];
    if (dataset.hidden || activeCount <= 1) {
      dataset.data = values;
      return;
    }
    var max = values.reduce(function(currentMax, value) {
      return Math.max(currentMax, Number(value) || 0);
    }, 0);
    dataset.data = values.map(function(value) {
      return max > 0 ? Number(value) / max * 100 : 0;
    });
  });

  var yAxis = costChart.options && costChart.options.scales ? costChart.options.scales.y : null;
  if (yAxis) {
    delete yAxis.min;
    delete yAxis.max;
    if (activeCount === 0) {
      yAxis.title = buildTrendAxisTitle('请选择指标');
    } else if (activeCount === 1) {
      var activeKey = activeKeys[0];
      var cur = keyToSeries[activeKey];
      yAxis.title = buildTrendAxisTitle(cur.label + ' (' + cur.unit + ')');
    } else {
      yAxis.title = buildTrendAxisTitle('相对趋势 (%)');
      yAxis.min = 0;
      yAxis.max = 100;
    }
  }

  applyFutureHourMask(costChart, { labels: costChart.data.labels }, trendRange);
  costChart.update();
}

function applyFutureHourMask(chart: any, d: any, range?: string): void {
  if (!chart) return;
  chart.$futureMaskEnabled = (range === 'today');
  if (!chart.$futureMaskEnabled) {
    chart.$cutoffIndex = -1;
    chart.$futureHourMask = { enabled: false };
    return;
  }
  var labels = d && d.labels;
  var isTodayHourly = Array.isArray(labels)
    && labels.length === 24
    && labels.every(function(label) {
      return typeof label === 'string' && /^\d{2}:00$/.test(label);
    });

  if (isTodayHourly) {
    var currentHour = getCNCurrentHour();
    (chart.data.datasets || []).forEach(function(dataset) {
      if (!Array.isArray(dataset.data)) return;
      var nextData = dataset.data.slice();
      for (var i = currentHour + 1; i < nextData.length; i++) {
        nextData[i] = null;
      }
      dataset.data = nextData;
    });
    chart.$cutoffIndex = currentHour;
    chart.$futureHourMask = { enabled: true, cutoffIndex: currentHour };
  } else {
    chart.$cutoffIndex = -1;
    chart.$futureHourMask = { enabled: false };
  }
}

export function drawSparkline(canvas, data, color) {
  if (!data || data.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.offsetWidth || 120;
  const cssH = canvas.offsetHeight || 30;
  // Only set drawing buffer; CSS controls visual size
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const strokeColor = color || 'rgba(59,130,246,0.9)';
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  if (max === min) {
    ctx.beginPath();
    ctx.moveTo(0, cssH / 2);
    ctx.lineTo(cssW, cssH / 2);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  const padTop = 3, padBottom = 4;
  const drawH = cssH - padTop - padBottom;
  const step = cssW / (data.length - 1);
  const baseline = cssH;
  const fillGradient = ctx.createLinearGradient(0, 0, 0, cssH);
  fillGradient.addColorStop(0, 'rgba(59,130,246,0.18)');
  fillGradient.addColorStop(1, 'rgba(59,130,246,0)');
  function getY(v) { return padTop + drawH - ((v - min) / range) * drawH; }
  // 填充区域
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step, y = getY(v);
    if (i === 0) { ctx.moveTo(x, y); }
    else {
      const px = (i - 1) * step, py = getY(data[i - 1]);
      const cpx = (px + x) / 2;
      ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
    }
  });
  ctx.lineTo((data.length - 1) * step, baseline);
  ctx.lineTo(0, baseline);
  ctx.closePath();
  ctx.fillStyle = fillGradient;
  ctx.fill();
  // 折线
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * step, y = getY(v);
    if (i === 0) { ctx.moveTo(x, y); }
    else {
      const px = (i - 1) * step, py = getY(data[i - 1]);
      const cpx = (px + x) / 2;
      ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
    }
  });
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function getCompareLabel(range, customLen?) {
  if (range === 'today') return '同比昨日';
  if (range === 'yesterday') return '同比前日';
  if (range === '7d') return '同比上周';
  if (range === '30d') return '同比上月';
  if (range === 'custom' && customLen) return '同比前 ' + customLen + ' 天';
  return '同比';
}

export function setHighlightLoading() {
  document.querySelectorAll('#highlightGrid .highlight-card').forEach(function(card) {
    card.classList.add('skeleton');
  });
}

function countUpValue(el, item, duration) {
  var target = typeof item.value === 'number' ? item.value : parseFloat(String(item.value).replace(/[^\d.-]/g, ''));
  if (isNaN(target)) target = 0;
  var unit = item.unit || '';
  var from = parseFloat((el.textContent || '0').replace(/[^\d.-]/g, '')) || 0;
  var targetText = formatValue({ value: target, unit: unit });
  el.textContent = targetText;
  if (from === target) return;
  var startTime;
  function step(ts) {
    if (!startTime) {
      startTime = ts;
      requestAnimationFrame(step);
      return;
    }
    var progress = Math.min((ts - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = from + (target - from) * eased;
    el.textContent = formatValue({ value: current, unit: unit });
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function buildPopoutStats(c: HighlightCard, compare) {
  var avg = c && c.stats && typeof c.stats.avg === 'number' ? c.stats.avg : 0;
  var peak = c && c.stats && typeof c.stats.peak === 'number' ? c.stats.peak : 0;
  return '<div class="highlight-popout-stats">' +
    '<div class="hl-change ' + compare.cls + '">' + escapeHtml(compare.text) + '</div>' +
    '<div class="popout-stat"><span class="popout-stat-val">' + avg + '</span>日均</div>' +
    '<div class="popout-stat"><span class="popout-stat-val">' + peak + '</span>峰值</div>' +
  '</div>';
}

function buildDetailHtml(compare) {
  return '<div class="hl-detail"><div class="hl-change-inline ' + compare.cls + '">' + escapeHtml(compare.text) + '</div></div>';
}

function buildPopoutChart(canvas, card: HighlightCard, color) {
  if (!card || !card.series || !card.series.values || !card.series.values.length) return;
  var data = card.series.values;
  var labels = card.series.labels && card.series.labels.length ? card.series.labels : data.map(function(_value, index) { return String(index + 1); });
  var popoutStrokeColor = 'rgba(59,130,246,0.9)';
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        borderColor: popoutStrokeColor,
        backgroundColor: color + '15',
        fill: true,
        tension: 0.4,
        cubicInterpolationMode: 'monotone',
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: popoutStrokeColor,
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...ttOpts, displayColors: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#a1a1aa', maxTicksLimit: 7, autoSkip: true, maxRotation: 0 } },
        y: { grid: { color: 'rgba(15,23,42,0.04)' }, ticks: { font: { size: 10 }, color: '#a1a1aa' }, beginAtZero: false, grace: '8%' }
      },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 250 },
    }
  });
}

function createPopoutChart(canvas, card: HighlightCard, color) {
  if (_popoutChart) { _popoutChart.destroy(); _popoutChart = null; }
  _popoutChart = buildPopoutChart(canvas, card, color);
  return _popoutChart;
}

function destroyPopoutChart() {
  if (_popoutChart) { _popoutChart.destroy(); _popoutChart = null; }
}

function ensureHighlightPopoutViewportListeners() {
  if (_highlightPopoutViewportBound) return;
  window.addEventListener('scroll', hideHighlightPopout, true);
  window.addEventListener('resize', hideHighlightPopout);
  _highlightPopoutViewportBound = true;
}

function hideHighlightPopout() {
  if (_highlightFloatingPopout) {
    _highlightFloatingPopout.classList.remove('visible');
  }
  _activeHighlightPopoutIdx = -1;
  destroyPopoutChart();
}

function positionFloatingPopout(popout: HTMLElement, card: HTMLElement) {
  const r = card.getBoundingClientRect();
  const W = popout.offsetWidth || 320;
  const bounds = getContentClampBounds();
  let left = r.left + r.width / 2 - W / 2;
  left = Math.max(bounds.left, Math.min(left, bounds.right - W));
  popout.style.left = left + 'px';
  popout.style.top = (r.bottom + 8) + 'px';
}

export function renderHighlightCards(cards: HighlightCard[], range?, customLen?) {
  const grid = document.getElementById('highlightGrid');
  if (!grid) return;
  var compareLabel = getCompareLabel(range || currentRange || '7d', customLen);

  var existingCards = grid.querySelectorAll('.highlight-card');

  if (existingCards.length === cards.length) {
    cards.forEach((c, i) => {
      var compare = formatCompareText(c.value, c.prev, compareLabel);
      var card = existingCards[i] as HTMLElement;
      var wasSkeleton = card.classList.contains('skeleton');
      card.classList.remove('skeleton');
      card.dataset.key = c.key || '';
      var labelEl = card.querySelector('.highlight-label');
      if (labelEl) labelEl.textContent = c.label;
      var valueEl = card.querySelector('.highlight-value') as HTMLElement;
      if (valueEl) {
        if (wasSkeleton) { countUpValue(valueEl, c, 600); }
        else {
          var displayNum = typeof c.value === 'number' ? c.value : parseFloat(String(c.value).replace(/[^\d.-]/g, ''));
          if (isNaN(displayNum)) displayNum = 0;
          animateNumber(valueEl, displayNum, {
            format: function(v) { return formatValue({ value: v, unit: c.unit || '' }); }
          });
        }
      }
      var canvas = card.querySelector('.highlight-sparkline') as HTMLCanvasElement;
      if (canvas) canvas.id = 'spark-' + i;
      var detailEl = card.querySelector('.hl-detail');
      if (detailEl) detailEl.remove();
      var legacyStats = card.querySelector('.highlight-card-stats-grid');
      if (legacyStats) legacyStats.remove();
      var changeEl = card.querySelector('.hl-change-inline') as HTMLElement | null;
      var compareHtml = '<div class="hl-change-inline ' + compare.cls + '">' + escapeHtml(compare.text) + '</div>';
      if (changeEl) {
        changeEl.outerHTML = compareHtml;
      } else {
        var valueEl2 = card.querySelector('.highlight-value');
        if (valueEl2) valueEl2.insertAdjacentHTML('afterend', compareHtml);
      }
      // update popout stats
      var popoutStats = card.querySelector('.highlight-popout-stats');
      if (popoutStats) popoutStats.outerHTML = buildPopoutStats(c, compare);
    });
    destroyPopoutChart();
    requestAnimationFrame(() => {
      cards.forEach((c, i) => {
        var canvas = document.getElementById('spark-' + i) as HTMLCanvasElement;
        var values = c && c.series && c.series.values ? c.series.values : (c && c.sparkline || []);
        if (canvas && values && canvas.offsetWidth > 0) drawSparkline(canvas, values, SPARK_COLORS[i] || '#6366f1');
      });
    });
    bindPopoutEvents(cards);
    return;
  }

  grid.innerHTML = cards.map((c, i) => {
    var displayVal = formatValue(c);
    var compare = formatCompareText(c.value, c.prev, compareLabel);
    return `
        <div class="highlight-card" data-idx="${i}" data-key="${c.key || ''}" style="--card-accent: ${SPARK_COLORS[i] || '#6366f1'}">
        <div class="highlight-label">${c.label}</div>
        <div class="highlight-value">${displayVal}</div>
        <div class="hl-change-inline ${compare.cls}">${escapeHtml(compare.text)}</div>
        <canvas class="highlight-sparkline" id="spark-${i}"></canvas>
        <div class="highlight-popout">
          <div class="highlight-popout-chart"><canvas id="popout-canvas-${i}"></canvas></div>
          ${buildPopoutStats(c, compare)}
        </div>
      </div>`;
  }).join('');
  requestAnimationFrame(() => {
    cards.forEach((c, i) => {
      const canvas = document.getElementById('spark-' + i);
      var values = c && c.series && c.series.values ? c.series.values : (c && c.sparkline || []);
      if (canvas && values) drawSparkline(canvas, values, SPARK_COLORS[i] || '#6366f1');
    });
  });
  bindPopoutEvents(cards);
}

function bindPopoutEvents(cards: HighlightCard[]) {
  var grid = document.getElementById('highlightGrid');
  if (!grid) return;
  ensureHighlightPopoutViewportListeners();
  hideHighlightPopout();

  const show = function(card: HTMLElement, idx: number) {
    const tmpl = card.querySelector('.highlight-popout') as HTMLElement | null;
    if (!tmpl) return;

    if (!_highlightFloatingPopout) {
      _highlightFloatingPopout = tmpl.cloneNode(true) as HTMLElement;
      _highlightFloatingPopout.className = 'highlight-popout-floating';
      document.body.appendChild(_highlightFloatingPopout);
    } else if (_activeHighlightPopoutIdx !== idx) {
      destroyPopoutChart();
      _highlightFloatingPopout.innerHTML = tmpl.innerHTML;
    }

    _activeHighlightPopoutIdx = idx;

    const canvas = _highlightFloatingPopout.querySelector('canvas') as HTMLCanvasElement | null;
    const item = cards[idx];
    if (canvas && item) {
      canvas.id = 'popout-canvas-floating-' + idx;
      createPopoutChart(canvas, item, SPARK_COLORS[idx] || '#6366f1');
    }

    positionFloatingPopout(_highlightFloatingPopout, card);
    _highlightFloatingPopout.classList.add('visible');
  };

  grid.querySelectorAll('.highlight-card').forEach(function(card, idx) {
    var el = card as HTMLElement;
    var statsGrid = el.querySelector('.highlight-card-stats-grid') as HTMLElement | null;
    if (statsGrid) statsGrid.hidden = true;
    el.onmouseenter = null;
    el.onmouseleave = null;
    el.onmouseenter = function() { show(el, idx); };
    el.onmouseleave = hideHighlightPopout;
  });
}


export function setCurrentRange(range) {
  currentRange = range;
}

export function createCharts() {
  currentRange = '7d';
  PLATFORM_BREAKDOWN.today = [];
  PLATFORM_BREAKDOWN['7d'] = [];
  PLATFORM_BREAKDOWN['30d'] = [];
  PLATFORM_BREAKDOWN.custom = [];
  INTERACTION_BREAKDOWN.today = [];
  INTERACTION_BREAKDOWN['7d'] = [];
  INTERACTION_BREAKDOWN['30d'] = [];
  INTERACTION_BREAKDOWN.custom = [];
  renderHighlightCards([], '7d');
  renderAchievements([]);
  createDonutChart('7d');
  createInteractionDonut('7d');
  var setIf = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  setIf('miniExec', '0');
  setIf('miniRuntime', '');
  setIf('miniCost', '0');
}

export function ensureOpsCharts() {
  if (costChart) return;
  var key = currentRange || '7d';
  var d = getOpsChartData(key, lastOpsData);
  if (!d) return;
  rebuildRawSeries(d);
  var el = document.getElementById('opsTaskChart') as HTMLCanvasElement | null;
  if (!el) return;
  var ctx = el.getContext('2d');
  if (!ctx) return;
  costChart = new Chart(ctx, {
    type:'line',
    data:{ labels: d.labels, datasets: buildTrendDatasets() as any },
    options:{ ...chartBase,
      plugins:{
        legend:{display:false},
        tooltip:{
          ...ttOpts,
          callbacks: {
            ...(((ttOpts as any).callbacks) || {}),
            label: getTrendTooltipLabel
          }
        }
      },
      scales:{
        x: { ...axBase.x },
        y: { ...axBase.y, title: buildTrendAxisTitle('请选择指标') }
      },
    } as any
  });
  applyTrendDisplayMode(currentRange);
  getTrendToggles().forEach(function(toggle) {
    if ((toggle as any).__trendBound) return;
    (toggle as any).__trendBound = true;
    toggle.addEventListener('click', function() {
      this.classList.toggle('active');
      applyTrendDisplayMode(currentRange);
    });
  });
}

export function updateCharts(range: string, opsData?: any) {
  if (opsData) lastOpsData = opsData;
  currentRange = range || currentRange;
  var d = getOpsChartData(currentRange, opsData || lastOpsData);
  if (!d) return;
  rebuildRawSeries(d);
  var setIf = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  if (costChart) {
    costChart.data.labels = d.labels;
    costChart.data.datasets = buildTrendDatasets() as any;
    applyTrendDisplayMode(currentRange);
  }
  setIf('costAvg', d.costAvg ? d.costAvg.replace(' 算力豆','') : '');
  setIf('opsTrendDesc', d.trendDesc || '');
}

function bindDonutCenterRestore(canvas: HTMLElement | null) {
  if (!canvas) return;
  var parent = canvas.parentElement;
  if (!parent || (parent as any).__donutCenterBound) return;
  (parent as any).__donutCenterBound = true;
  var restore = function() {
    var center = parent!.querySelector('.donut-center') as HTMLElement | null;
    if (center) { center.style.transition = 'opacity .15s'; center.style.opacity = '1'; }
  };
  parent.addEventListener('mouseleave', restore);
  canvas.addEventListener('mouseleave', restore);
}

export function createDonutChart(range) {
  const data = Array.isArray(PLATFORM_BREAKDOWN[range]) ? PLATFORM_BREAKDOWN[range] : [];
  const total = data.reduce((a, d) => a + d.value, 0);
  var totalEl = document.getElementById('donutTotal');
  if (totalEl) totalEl.textContent = total;
  var canvas = document.getElementById('donutChart') as HTMLCanvasElement | null;
  if (!canvas) return;
  bindDonutCenterRestore(canvas);
  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.name),
      datasets: [{ data: data.map(d => d.value), backgroundColor: data.map(d => d.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
    },
    options: {
      cutout: '68%', responsive: true, maintainAspectRatio: true, aspectRatio: 1,
      onHover: function(_e, elements) {
        var center = canvas.parentElement && canvas.parentElement.querySelector('.donut-center') as HTMLElement | null;
        if (center) { center.style.transition = 'opacity .15s'; center.style.opacity = elements.length > 0 ? '0' : '1'; }
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...ttOpts, backgroundColor: '#ffffff', borderColor: '#d4d4d8', borderWidth: 1, callbacks: { label: ctx => ' ' + ctx.label + ': ' + ctx.parsed + ' 人 (' + (total > 0 ? Math.round(ctx.parsed / total * 100) + '%' : '0%') + ')' } }
      }
    }
  });
  var legend = document.getElementById('donutLegend');
  if (legend) {
    legend.innerHTML = data.map(d =>
      '<div class="donut-legend-item"><span class="donut-legend-dot" style="background:'+d.color+'"></span>'+d.name+'<span class="donut-legend-val">'+d.value+'</div>'
    ).join('');
  }
}

export function createInteractionDonut(range) {
  var data = Array.isArray(INTERACTION_BREAKDOWN[range]) ? INTERACTION_BREAKDOWN[range] : [];
  var total = data.reduce((a, d) => a + d.value, 0);
  var totalEl = document.getElementById('interactionTotal');
  if (totalEl) totalEl.textContent = total;
  var canvas = document.getElementById('interactionDonut') as HTMLCanvasElement | null;
  if (!canvas) return;
  bindDonutCenterRestore(canvas);
  if (interactionDonutInstance) interactionDonutInstance.destroy();
  interactionDonutInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.name),
      datasets: [{ data: data.map(d => d.value), backgroundColor: data.map(d => d.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
    },
    options: {
      cutout: '68%', responsive: true, maintainAspectRatio: true, aspectRatio: 1,
      onHover: function(_e, elements) {
        var center = canvas.parentElement && canvas.parentElement.querySelector('.donut-center') as HTMLElement | null;
        if (center) { center.style.transition = 'opacity .15s'; center.style.opacity = elements.length > 0 ? '0' : '1'; }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...ttOpts,
          backgroundColor: '#ffffff',
          borderColor: '#d4d4d8',
          borderWidth: 1,
          callbacks: {
            label: ctx => {
              var sum = typeof total === 'number'
                ? total
                : (ctx.dataset.data || []).reduce((a, b) => a + Number(b || 0), 0)
              return ' ' + ctx.label + ': ' + ctx.parsed + ' (' + (sum > 0 ? Math.round(ctx.parsed / sum * 100) : 0) + '%)'
            }
          }
        }
      }
    }
  });
  var legend = document.getElementById('interactionLegend');
  if (legend) {
    legend.innerHTML = data.map(d =>
      '<div class="donut-legend-item"><span class="donut-legend-dot" style="background:'+d.color+'"></span>'+d.name+'<span class="donut-legend-val">'+d.value+'</div>'
    ).join('');
  }
}

export function exportTrendCSV() {
  var key = currentRange || '7d';
  var d = getOpsChartData(key, lastOpsData);
  if (!d) return;
  var headers = ['日期', '完成', '运行时长(h)', '评论量', '点赞量', '收藏量', '私信量', '触达量', '算力豆量'];
  var rows = d.labels.map(function(label, i) {
    return [
      label,
      (d.data || d.success)[i] || 0,
      d.runtime ? d.runtime[i] || 0 : 0,
      d.comments ? d.comments[i] || 0 : 0,
      d.likes ? d.likes[i] || 0 : 0,
      d.saves ? d.saves[i] || 0 : 0,
      d.dms ? d.dms[i] || 0 : 0,
      d.reach ? d.reach[i] || 0 : 0,
      d.credits ? d.credits[i] || 0 : 0,
    ];
  });
  downloadCSV('完成趋势_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

export function exportTrendPNG() {
  if (!costChart) return;
  var url = costChart.toBase64Image('image/png', 1);
  var a = document.createElement('a');
  a.href = url;
  a.download = '完成趋势_' + new Date().toISOString().slice(0,10) + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function bindHighlightReflow(): void {
  const grid = document.getElementById('highlightGrid')
  if (!grid) return
  if ((grid as any).__reflowBound) return
  ;(grid as any).__reflowBound = true

  const mq1 = window.matchMedia('(min-width: 1520px)')
  const mq2 = window.matchMedia('(min-width: 820px)')

  function reflow(): void {
    const cards = grid!.querySelectorAll<HTMLElement>('.highlight-card')
    cards.forEach(function(c, i) {
      c.style.transition = 'none'
      c.style.opacity = '0.4'
      c.style.transform = 'scale(0.98)'
      void c.offsetHeight
      setTimeout(function() {
        c.style.transition = 'opacity 0.28s ease, transform 0.28s ease'
        c.style.opacity = '1'
        c.style.transform = 'scale(1)'
      }, 20 + i * 15)
    })
  }

  if (typeof mq1.addEventListener === 'function') {
    mq1.addEventListener('change', reflow)
    mq2.addEventListener('change', reflow)
  } else if (typeof (mq1 as any).addListener === 'function') {
    ;(mq1 as any).addListener(reflow)
    ;(mq2 as any).addListener(reflow)
  }
}
