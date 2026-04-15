export const deviceList = [
  { id: 'MI-001', label: 'MI-001 · 小米14' },
  { id: 'MI-002', label: 'MI-002 · 红米K70' },
  { id: 'MI-003', label: 'MI-003 · 小米13' },
  { id: 'MI-004', label: 'MI-004 · 红米Note12' },
  { id: 'MI-005', label: 'MI-005 · 小米14Pro' },
];

export const heatPlatforms = ['小红书','抖音','快手','微信'];
export const deviceHeat = [
  { id:'MI-001', label:'小米14',     cells:{ '小红书':{exec:5,fail:0}, '抖音':{exec:2,fail:0}, '快手':{exec:1,fail:0}, '微信':{exec:0,fail:0} }},
  { id:'MI-002', label:'红米K70',    cells:{ '小红书':{exec:2,fail:0}, '抖音':{exec:3,fail:2}, '快手':{exec:0,fail:0}, '微信':{exec:1,fail:0} }},
  { id:'MI-003', label:'小米13',     cells:{ '小红书':{exec:3,fail:1}, '抖音':{exec:4,fail:3}, '快手':{exec:1,fail:1}, '微信':{exec:1,fail:0} }},
  { id:'MI-004', label:'红米Note12', cells:{ '小红书':{exec:3,fail:0}, '抖音':{exec:0,fail:0}, '快手':{exec:0,fail:0}, '微信':{exec:2,fail:0} }},
  { id:'MI-005', label:'小米14Pro',  cells:{ '小红书':{exec:3,fail:0}, '抖音':{exec:2,fail:1}, '快手':{exec:2,fail:0}, '微信':{exec:0,fail:0} }},
];

export const deviceStats = deviceHeat.map(d => {
  let exec=0, errors=0;
  Object.values(d.cells).forEach(c => { exec+=c.exec; errors+=c.fail; });
  return { id:d.id, exec, errors };
});

export var deviceMetrics = {
  'MI-001': { tokenUsage: 18500, successCount: 8, successDuration: '3h 25min', comments: 58, likes: 45, saves: 32, dms: 12, reach: 120, status: 'online' },
  'MI-002': { tokenUsage: 12300, successCount: 6, successDuration: '2h 40min', comments: 35, likes: 28, saves: 18, dms: 8, reach: 72, status: 'online' },
  'MI-003': { tokenUsage: 22100, successCount: 9, successDuration: '4h 15min', comments: 72, likes: 55, saves: 40, dms: 15, reach: 148, status: 'warning' },
  'MI-004': { tokenUsage: 8700, successCount: 5, successDuration: '2h 05min', comments: 22, likes: 18, saves: 10, dms: 3, reach: 43, status: 'online' },
  'MI-005': { tokenUsage: 15400, successCount: 7, successDuration: '3h 10min', comments: 45, likes: 35, saves: 25, dms: 10, reach: 94, status: 'online' },
};
