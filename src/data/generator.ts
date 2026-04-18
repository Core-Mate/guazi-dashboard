export * from './seed'
export * from './helpers'
export * from './derived'
export * from './transactions'

export var chartColors = {
  primary: '#2563eb', primaryBg: 'rgba(37,99,235,0.12)',
  orange: '#f97316', orangeBg: 'rgba(249,115,22,0.12)',
  green: '#22c55e',
};
export var ttOpts = { backgroundColor: '#fff', titleColor: '#09090b', bodyColor: '#52525b', borderColor: '#e4e4e7', borderWidth: 1, padding: 12, cornerRadius: 8, titleFont: { weight: 600 }, displayColors: true, boxPadding: 4 };
export var lineBase = { tension: 0.3, pointRadius: 0, pointHoverRadius: 6, borderWidth: 2.5 };
export var axBase: any = { x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#a1a1aa', maxTicksLimit: 10, autoSkip: true, maxRotation: 0 } }, y: { grid: { color: '#f4f4f5' }, ticks: { font: { size: 11 }, color: '#a1a1aa' }, min: 0, beginAtZero: true } };
export var chartBase = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, animation: { duration: 600, easing: 'easeOutQuart' } };

export var platformMap: Record<string, string> = {
  '小红书': 'tag-xhs', '抖音': 'tag-dy', '快手': 'tag-ks',
  '微博': 'tag-wb', '微信': 'tag-wx', '大众点评': 'tag-dzdp',
};
export var platformList = ['小红书', '抖音', '快手', '微信', '微博', '大众点评'];
export var platformColors: Record<string, string> = {
  '小红书': '#e11d48', '抖音': '#333', '快手': '#ea580c',
  '微博': '#dc2626', '微信': '#16a34a', '大众点评': '#ca8a04',
};

export { computeChange } from '../modules/utils';

export function formatValue(item: any) {
  var v = item.value;
  if (typeof v === 'number' && v >= 10000) return Math.round(v).toLocaleString();
  if (typeof v === 'number' && v % 1 !== 0) return v.toFixed(1) + (item.unit || '');
  return String(Math.round(v)) + (item.unit || '');
}

export var SPARK_COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#6366f1'];
