export const mockData = {
  today: {
    labels: ['0:00','1:00','2:00','3:00','4:00','5:00','6:00','7:00','8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'],
    exec:    [0,0,0,0,0,0,0,0,1,2,1,0,2,3,2,1,0,0,0,0,0,0,0,0],
    success: [0,0,0,0,0,0,0,0,1,2,1,0,1,3,2,1,0,0,0,0,0,0,0,0],
    cost:    [0,0,0,0,0,0,0,0,10,20,10,0,20,30,20,10,0,0,0,0,0,0,0,0],
    data:    [0,0,0,0,0,0,0,0,1,2,1,0,1,3,2,1,0,0,0,0,0,0,0,0],
    reach: [0,0,0,0,0,0,0,0,8,18,12,0,15,25,20,10,0,0,0,0,0,0,0,0],
    comments: [3, 5, 4, 6, 8, 7, 9, 4, 6, 5, 7, 8, 6, 7, 5, 8, 9, 6, 7, 8],
    likes: [2, 3, 2, 4, 5, 4, 6, 3, 4, 3, 5, 6, 4, 5, 3, 5, 6, 4, 5, 6],
    dms: [1, 1, 2, 2, 3, 2, 3, 1, 2, 2, 3, 3, 2, 2, 2, 3, 3, 2, 3, 3],
    runtime: [0,0,0,0,0,0,0,0,0.8,1.5,1.2,0,1.3,2.0,1.5,1.0,0,0,0,0,0,0,0,0],
    statExec: '12', statRate: '92%', statRateSub: '11 成功 / 12 总计',
    statCost: '120', execChange: '+5%', costChange: '-3%',
    statReach: '108', reachChange: '+15%',
    costAvg: '120 算力豆', costPer: '10 算力豆', costWow: '-3%',
    trendDesc: '多维度数据对比', costDesc: '今日算力豆消耗', reachDesc: '今日触达量',
  },
  '7d': {
    labels: ['04/07','04/08','04/09','04/10','04/11','04/12','04/13'],
    exec: [5,7,4,10,8,9,4],
    success: [4,6,3,9,7,9,4],
    cost: [50,70,40,100,80,90,40],
    data: [4,6,3,9,7,9,4],
    reach: [30,42,25,65,50,38,16],
    comments: [15, 22, 18, 25, 30, 28, 35],
    likes: [8, 12, 10, 15, 20, 18, 22],
    dms: [3, 5, 4, 6, 8, 7, 9],
    runtime: [5.2, 6.8, 4.5, 9.5, 7.8, 8.5, 4.7],
    statExec: '47', statRate: '89%', statRateSub: '42 成功 / 47 总计',
    statCost: '470', execChange: '+12%', costChange: '-8%',
    statReach: '266', reachChange: '+18%',
    costAvg: '67 算力豆', costPer: '10 算力豆', costWow: '-8%',
    trendDesc: '多维度数据对比', costDesc: '近 7 天算力豆消耗', reachDesc: '近 7 天触达量',
  },
  '30d': {
    labels: ['03/15','03/16','03/17','03/18','03/19','03/20','03/21','03/22','03/23','03/24','03/25','03/26','03/27','03/28','03/29','03/30','03/31','04/01','04/02','04/03','04/04','04/05','04/06','04/07','04/08','04/09','04/10','04/11','04/12','04/13'],
    exec:    [3,5,4,6,5,7,2,4,6,8,5,7,6,9,8,6,7,5,8,10,7,9,6,5,7,4,10,8,9,4],
    success: [2,4,3,5,4,6,2,3,5,7,4,6,5,8,7,5,6,4,7,9,6,8,5,4,6,3,9,7,9,4],
    cost:    [30,50,40,60,50,70,20,40,60,80,50,70,60,90,80,60,70,50,80,100,70,90,60,50,70,40,100,80,90,40],
    data:    [2,4,3,5,4,6,2,3,5,7,4,6,5,8,7,5,6,4,7,9,6,8,5,4,6,3,9,7,9,4],
    reach: [20,35,28,40,30,50,15,25,40,55,30,48,38,60,52,35,45,32,55,70,50,60,38,30,42,25,65,50,38,16],
    comments: [12,15,18,14,20,22,16,25,18,22,28,20,24,30,22,26,32,24,28,35,26,30,38,28,32,40,30,35,42,38],
    likes: [6,8,10,7,11,12,9,14,10,12,16,11,13,18,12,15,20,13,16,22,14,18,24,16,20,26,18,22,28,24],
    dms: [2,3,4,2,4,5,3,5,4,4,6,4,5,7,4,5,8,4,6,9,5,6,9,5,7,10,6,8,11,9],
    runtime: [3.5,5.0,4.2,6.0,5.5,7.0,2.5,4.5,6.5,8.0,5.5,7.5,6.5,9.0,8.0,6.5,7.5,5.5,8.5,10.0,7.5,9.5,6.5,5.5,7.0,4.5,10.0,8.5,9.0,4.5],
    statExec: '188', statRate: '87%', statRateSub: '164 成功 / 188 总计',
    statCost: '1,870', execChange: '+22%', costChange: '-12%',
    statReach: '1,169', reachChange: '+25%',
    costAvg: '62 算力豆', costPer: '10 算力豆', costWow: '-12%',
    trendDesc: '多维度数据对比', costDesc: '近 30 天算力豆消耗', reachDesc: '近 30 天触达量',
  },
  custom: null,
};
mockData.custom = mockData['7d'];

export const INTERACTION_BREAKDOWN = {
  today: [
    { name:'评论', value:33, color:'#2563eb' },
    { name:'点赞', value:22, color:'#3b82f6' },
    { name:'收藏', value:18, color:'#60a5fa' },
    { name:'私信', value:5, color:'#93c5fd' },
  ],
  '7d': [
    { name:'评论', value:232, color:'#2563eb' },
    { name:'点赞', value:155, color:'#3b82f6' },
    { name:'收藏', value:160, color:'#60a5fa' },
    { name:'私信', value:31, color:'#93c5fd' },
  ],
  '30d': [
    { name:'评论', value:992, color:'#2563eb' },
    { name:'点赞', value:660, color:'#3b82f6' },
    { name:'收藏', value:580, color:'#60a5fa' },
    { name:'私信', value:132, color:'#93c5fd' },
  ],
};
(INTERACTION_BREAKDOWN as any).custom = INTERACTION_BREAKDOWN['7d'];

export const chartColors = {
  primary: '#2563eb', primaryBg: 'rgba(37,99,235,0.12)',
  orange: '#f97316', orangeBg: 'rgba(249,115,22,0.12)',
  green: '#22c55e',
};

export const ttOpts = { backgroundColor:'#fff', titleColor:'#09090b', bodyColor:'#52525b', borderColor:'#e4e4e7', borderWidth:1, padding:12, cornerRadius:8, titleFont:{weight:600}, displayColors:true, boxPadding:4 };
export const lineBase = { tension:0.3, pointRadius:0, pointHoverRadius:6, borderWidth:2.5 };
export const axBase = { x:{ grid:{display:false}, ticks:{font:{size:11},color:'#a1a1aa',maxTicksLimit:10,autoSkip:true,maxRotation:0} }, y:{ grid:{color:'#f4f4f5'}, ticks:{font:{size:11},color:'#a1a1aa'}, beginAtZero:true } };
export const chartBase = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false}, animation:{duration:600,easing:'easeOutQuart'} };
