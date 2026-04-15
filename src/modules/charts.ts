import { Chart } from 'chart.js'
import { mockData, ttOpts, lineBase, axBase, chartBase, INTERACTION_BREAKDOWN } from '../data/charts'
import { HIGHLIGHT_DATA, SPARK_COLORS, computeChange, formatValue } from '../data/highlights'
import { PLATFORM_BREAKDOWN } from '../data/platforms'
import { renderAchievements } from './achievements'
import { downloadCSV } from './export-utils'
import { animateAllNumbers } from './utils'
import { tryLiveHighlights } from './api-integration'

let costChart, opsExecChart;
let donutChartInstance = null;
let interactionDonutInstance = null;
let currentRange = '7d';

export function drawSparkline(canvas, data, color) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.offsetWidth || 120;
  const cssH = 30;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padTop = 3, padBottom = 4;
  const drawH = cssH - padTop - padBottom;
  const step = cssW / (data.length - 1);
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
  ctx.lineTo((data.length - 1) * step, cssH);
  ctx.lineTo(0, cssH);
  ctx.closePath();
  ctx.fillStyle = color + '18';
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
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function getCompareLabel(range) {
  if (range === 'today') return '日环比';
  if (range === '30d') return '月环比';
  if (range === 'custom') return '环比';
  return '周环比';
}

export function renderHighlightCards(cards, range?) {
  const grid = document.getElementById('highlightGrid');
  if (!grid) return;
  var compareLabel = getCompareLabel(range || currentRange || '7d');
  grid.innerHTML = cards.map((c, i) => {
    var ch = computeChange(c.value, c.prev);
    var displayVal = formatValue(c);
    return `
      <div class="highlight-card">
        <div class="highlight-label">${c.label}</div>
        <div class="highlight-value">${displayVal}</div>
        <canvas class="highlight-sparkline" id="spark-${i}"></canvas>
        <div class="highlight-change ${ch.up ? 'up' : 'down'}">
          ${ch.text ? (ch.up ? '↑' : '↓') + ' ' + ch.text + ' <span style="color:#a1a1aa;">' + compareLabel + '</span>' : '—'}
        </div>
        <div class="highlight-expanded-chart"><canvas class="highlight-expand-canvas" id="expand-${i}"></canvas></div>
      </div>`;
  }).join('');
  requestAnimationFrame(() => {
    cards.forEach((c, i) => {
      const canvas = document.getElementById('spark-' + i);
      if (canvas && c.sparkline) drawSparkline(canvas, c.sparkline, SPARK_COLORS[i] || '#6366f1');
    });
    initHighlightHoverCharts(cards);
  });
}

function initHighlightHoverCharts(cards) {
  document.querySelectorAll('.highlight-card').forEach((card, i) => {
    card.addEventListener('mouseenter', function() {
      var canvas = document.getElementById('expand-' + i) as any;
      if (!canvas || !cards[i] || !cards[i].sparkline) return;
      if (canvas.__expandChart) canvas.__expandChart.destroy();
      var d = mockData[currentRange] || mockData['7d'];
      var labels = d ? d.labels : cards[i].sparkline.map((_, j) => '' + j);
      canvas.__expandChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            data: cards[i].sparkline,
            borderColor: SPARK_COLORS[i] || '#6366f1',
            backgroundColor: (SPARK_COLORS[i] || '#6366f1') + '15',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          plugins: { legend: { display: false }, tooltip: { ...ttOpts } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#a1a1aa', maxTicksLimit: 6, maxRotation: 0 } },
            y: { grid: { color: '#f4f4f5' }, ticks: { font: { size: 10 }, color: '#a1a1aa' }, beginAtZero: true }
          }
        }
      });
    });
    card.addEventListener('mouseleave', function() {
      var canvas = document.getElementById('expand-' + i) as any;
      if (canvas && canvas.__expandChart) {
        canvas.__expandChart.destroy();
        canvas.__expandChart = null;
      }
    });
  });
}

export function setCurrentRange(range) {
  currentRange = range;
}

export function createCharts() {
  currentRange = '7d';
  renderHighlightCards(HIGHLIGHT_DATA['7d'], '7d');
  renderAchievements('7d');
  createDonutChart('7d');
  createInteractionDonut('7d');
  animateAllNumbers();
  tryLiveHighlights('7d');
}

export function ensureOpsCharts() {
  if (costChart) return;
  var key = currentRange || '7d';
  var d = mockData[key];
  if (!d) d = mockData['7d'];
  if (!d) return;
  var el = document.getElementById('opsTaskChart');
  if (!el) return;
  costChart = new Chart(el.getContext('2d'), {
    type:'line',
    data:{ labels: d.labels, datasets:[
      { label:'完成任务', data:d.data || d.success, borderColor:'#7c3aed', backgroundColor:'rgba(124,58,237,0.08)', fill:false, hidden:false, ...lineBase },
      { label:'评论量', data:d.comments, borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.08)', fill:false, hidden:true, ...lineBase },
      { label:'点赞量', data:d.likes, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.08)', fill:false, hidden:true, ...lineBase },
      { label:'私信量', data:d.dms, borderColor:'#f43f5e', backgroundColor:'rgba(244,63,94,0.08)', fill:false, hidden:true, ...lineBase },
      { label:'触达量', data:d.reach, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.08)', fill:false, hidden:true, ...lineBase },
      { label:'运行时长(h)', data:d.runtime, borderColor:'#0ea5e9', backgroundColor:'rgba(14,165,233,0.08)', fill:false, hidden:true, ...lineBase, yAxisID:'yRuntime' }
    ]},
    options:{ ...chartBase,
      plugins:{ legend:{display:false}, tooltip:ttOpts },
      scales:{ ...axBase, y:{...axBase.y, ticks:{...axBase.y.ticks, stepSize:2}}, yRuntime:{position:'right',display:false,grid:{display:false},ticks:{font:{size:11},color:'#a1a1aa'},beginAtZero:true} },
    }
  });
  costChart.update();
  var datasetKeyMap = { tasks:0, comments:1, likes:2, dms:3, reach:4, runtime:5 };
  document.querySelectorAll('.chart-toggle').forEach(function(toggle) {
    toggle.addEventListener('click', function() {
      this.classList.toggle('active');
      var idx = datasetKeyMap[this.dataset.key];
      var meta = costChart.getDatasetMeta(idx);
      meta.hidden = !this.classList.contains('active');
      if (this.dataset.key === 'runtime') {
        costChart.options.scales.yRuntime.display = this.classList.contains('active');
      }
      costChart.update();
    });
  });
}

export function updateCharts(range) {
  var d = mockData[range];
  if (!d) return;
  var setIf = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  if (costChart) {
    costChart.data.labels = d.labels;
    costChart.data.datasets[0].data = d.data || d.success;
    costChart.data.datasets[1].data = d.comments;
    costChart.data.datasets[2].data = d.likes;
    costChart.data.datasets[3].data = d.dms;
    costChart.data.datasets[4].data = d.reach;
    if (costChart.data.datasets[5]) costChart.data.datasets[5].data = d.runtime;
    costChart.update();
  }
  setIf('statExec', d.statExec.replace ? d.statExec : d.statExec);
  setIf('statCost', d.statCost);
  setIf('costAvg', d.costAvg ? d.costAvg.replace(' 算力豆','') : '');
  setIf('opsTrendDesc', d.trendDesc || '');
}

export function createDonutChart(range) {
  const data = PLATFORM_BREAKDOWN[range] || PLATFORM_BREAKDOWN['7d'];
  const total = data.reduce((a, d) => a + d.value, 0);
  var totalEl = document.getElementById('donutTotal');
  if (totalEl) totalEl.textContent = total;
  var canvas = document.getElementById('donutChart');
  if (!canvas) return;
  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.name),
      datasets: [{ data: data.map(d => d.value), backgroundColor: data.map(d => d.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
    },
    options: {
      cutout: '68%', responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...ttOpts, callbacks: { label: ctx => ' ' + ctx.label + ': ' + ctx.parsed + ' 人 (' + Math.round(ctx.parsed / total * 100) + '%)' } }
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
  var data = INTERACTION_BREAKDOWN[range] || INTERACTION_BREAKDOWN['7d'];
  if (!data) return;
  var total = data.reduce((a, d) => a + d.value, 0);
  var totalEl = document.getElementById('interactionTotal');
  if (totalEl) totalEl.textContent = total;
  var canvas = document.getElementById('interactionDonut');
  if (!canvas) return;
  if (interactionDonutInstance) interactionDonutInstance.destroy();
  interactionDonutInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.name),
      datasets: [{ data: data.map(d => d.value), backgroundColor: data.map(d => d.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
    },
    options: {
      cutout: '68%', responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...ttOpts, callbacks: { label: ctx => ' ' + ctx.label + ': ' + ctx.parsed + ' (' + Math.round(ctx.parsed / total * 100) + '%)' } }
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
  var d = mockData[key] || mockData['7d'];
  if (!d) return;
  var headers = ['日期', '完成任务', '评论量', '点赞量', '私信量', '触达量', '运行时长(h)'];
  var rows = d.labels.map(function(label, i) {
    return [
      label,
      (d.data || d.success)[i] || 0,
      d.comments ? d.comments[i] || 0 : 0,
      d.likes ? d.likes[i] || 0 : 0,
      d.dms ? d.dms[i] || 0 : 0,
      d.reach ? d.reach[i] || 0 : 0,
      d.runtime ? d.runtime[i] || 0 : 0,
    ];
  });
  downloadCSV('完成任务趋势_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows);
}

export function exportTrendPNG() {
  if (!costChart) return;
  var url = costChart.toBase64Image('image/png', 1);
  var a = document.createElement('a');
  a.href = url;
  a.download = '完成任务趋势_' + new Date().toISOString().slice(0,10) + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
