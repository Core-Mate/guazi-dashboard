export const platformMap: Record<string, string> = {
  '小红书':   'tag-xhs',
  '抖音':     'tag-dy',
  '快手':     'tag-ks',
  '微博':     'tag-wb',
  '微信':     'tag-wx',
  '大众点评': 'tag-dzdp',
};
export const platformList = ['小红书','抖音','快手','微信','微博','大众点评'];

export const platformColors: Record<string, string> = {
  '小红书': '#e11d48', '抖音': '#333', '快手': '#ea580c',
  '微博': '#dc2626', '微信': '#16a34a', '大众点评': '#ca8a04',
};

export const platformStats = [
  { name: '小红书', exec: 25, rate: '92%', rateCls: 'text-green', credits: 210 },
  { name: '抖音',   exec: 10, rate: '82%', rateCls: 'text-amber', credits: 110 },
  { name: '快手',   exec: 8,  rate: '88%', rateCls: 'text-green', credits: 80 },
  { name: '微信',   exec: 4,  rate: '75%', rateCls: 'text-amber', credits: 40 },
];

export const PLATFORM_BREAKDOWN = {
  today: [
    { name:'小红书', value:28, color:'#e11d48' },
    { name:'抖音', value:6, color:'#333' },
    { name:'快手', value:3, color:'#ea580c' },
    { name:'微信', value:1, color:'#16a34a' },
  ],
  '7d': [
    { name:'小红书', value:162, color:'#e11d48' },
    { name:'抖音', value:58, color:'#333' },
    { name:'快手', value:28, color:'#ea580c' },
    { name:'微信', value:18, color:'#16a34a' },
  ],
  '30d': [
    { name:'小红书', value:680, color:'#e11d48' },
    { name:'抖音', value:240, color:'#333' },
    { name:'快手', value:130, color:'#ea580c' },
    { name:'微信', value:90, color:'#16a34a' },
  ],
};
PLATFORM_BREAKDOWN.custom = PLATFORM_BREAKDOWN['7d'];

export let platformCompareData = {
  today: [
    { name:'小红书', exec:5, success:4, rate:'80%' },
    { name:'抖音', exec:2, success:2, rate:'100%' },
    { name:'快手', exec:1, success:1, rate:'100%' },
    { name:'微信', exec:1, success:0, rate:'0%' },
  ],
  '7d': [
    { name:'小红书', exec:15, success:12, rate:'80%' },
    { name:'抖音', exec:8, success:7, rate:'88%' },
    { name:'快手', exec:4, success:3, rate:'75%' },
    { name:'微信', exec:3, success:2, rate:'67%' },
  ],
  '30d': [
    { name:'小红书', exec:62, success:54, rate:'87%' },
    { name:'抖音', exec:30, success:26, rate:'87%' },
    { name:'快手', exec:18, success:14, rate:'78%' },
    { name:'微信', exec:12, success:9, rate:'75%' },
  ],
};
platformCompareData.custom = platformCompareData['7d'];
