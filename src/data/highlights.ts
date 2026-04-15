// 模拟后端返回的指标数据：value=当期值, prev=上期值, 前端动态计算环比
export const HIGHLIGHT_DATA = {
    today: [
      { key:'tasks', label:'执行数量', value: 6, prev: 5, unit:'', sparkline:[1,1,0,1,1,1,1] },
      { key:'runtime', label:'执行时长', value: 6.7, prev: 6.2, unit:'h', sparkline:[1,1,0,1,1,1,1] },
      { key:'credits', label:'算力豆消耗', value: 120, prev: 108, unit:'', sparkline:[10,20,10,20,30,20,10] },
    ],
    '7d': [
      { key:'tasks', label:'执行数量', value: 42, prev: 38, unit:'', sparkline:[4,6,3,9,7,9,4] },
      { key:'runtime', label:'执行时长', value: 47, prev: 43, unit:'h', sparkline:[5,7,4,10,8,9,4] },
      { key:'credits', label:'算力豆消耗', value: 470, prev: 424, unit:'', sparkline:[50,70,40,100,80,90,40] },
    ],
    '30d': [
      { key:'tasks', label:'执行数量', value: 178, prev: 155, unit:'', sparkline:[18,25,15,38,30,28,24] },
      { key:'runtime', label:'执行时长', value: 201, prev: 176, unit:'h', sparkline:[20,28,18,45,38,36,30] },
      { key:'credits', label:'算力豆消耗', value: 1870, prev: 1680, unit:'', sparkline:[60,80,70,100,90,80,70] },
    ],
  };
(HIGHLIGHT_DATA as any).custom = HIGHLIGHT_DATA['7d'];

export function computeChange(value, prev) {
  if (!prev || prev === 0) return { pct: 0, up: true, text: '' };
  var pct = Math.round((value - prev) / prev * 100);
  var sign = pct >= 0 ? '+' : '';
  return { pct: pct, up: pct >= 0, text: sign + pct + '%' };
}

export function formatValue(item) {
  var v = item.value;
  if (typeof v === 'number' && v >= 10000) return Math.round(v).toLocaleString();
  if (typeof v === 'number' && v % 1 !== 0) return v.toFixed(1) + (item.unit || '');
  return String(Math.round(v)) + (item.unit || '');
}

export const SPARK_COLORS = ['#2563eb','#3b82f6','#22c55e'];
