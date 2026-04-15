export let transactionData = [
  { time:'04/13 14:32', member:'张磊', type:'消耗', desc:'小红书获客 · 想卖车', change:-12, balance:8530 },
  { time:'04/13 13:45', member:'张磊', type:'消耗', desc:'小红书获客 · 二手车置换', change:-10, balance:8542 },
  { time:'04/13 12:10', member:'李明', type:'消耗', desc:'抖音评论获客 · 10万代步车', change:-5, balance:8552 },
  { time:'04/10 09:00', member:'张磊', type:'充值', desc:'月度充值', change:5000, balance:8557 },
  { time:'04/08 16:20', member:'张磊', type:'分发', desc:'分发给 李明 500 算力豆', change:-500, balance:3557 },
  { time:'04/05 10:30', member:'王芳', type:'消耗', desc:'小红书获客 · 二手车报价', change:-10, balance:4057 },
  { time:'04/04 08:00', member:'李明', type:'签到', desc:'每日签到奖励', change:10, balance:4067 },
  { time:'04/03 14:15', member:'赵强', type:'消耗', desc:'快手获客 · 卖车避坑', change:-10, balance:4057 },
  { time:'04/01 09:00', member:'张磊', type:'充值', desc:'季度充值', change:10000, balance:4067 },
  { time:'03/31 18:20', member:'陈静', type:'消耗', desc:'微信获客 · 二手车群', change:-8, balance:14067 },
  { time:'03/31 00:00', member:'王芳', type:'过期', desc:'未使用算力豆过期清零', change:-50, balance:14075 },
  { time:'03/30 15:45', member:'张磊', type:'分发', desc:'分发给 王芳 300 算力豆', change:-300, balance:14125 },
  { time:'03/29 11:12', member:'李明', type:'消耗', desc:'小红书获客 · 新手卖车', change:-10, balance:14425 },
  { time:'03/28 17:36', member:'王芳', type:'消耗', desc:'小红书获客 · 置换咨询', change:-12, balance:14435 },
  { time:'03/27 09:40', member:'张磊', type:'充值', desc:'补充周转算力豆', change:3000, balance:14447 },
  { time:'03/26 14:08', member:'赵强', type:'退款', desc:'任务异常中断退款', change:6, balance:11447 },
  { time:'03/25 19:25', member:'陈静', type:'消耗', desc:'微信获客 · 本地车友群', change:-8, balance:11441 },
  { time:'03/24 10:18', member:'张磊', type:'赠送', desc:'邀请新成员奖励', change:100, balance:11449 },
  { time:'03/22 16:52', member:'王芳', type:'消耗', desc:'小红书获客 · 急售二手车', change:-10, balance:11349 },
  { time:'03/21 13:09', member:'李明', type:'消耗', desc:'快手获客 · 二手车行情', change:-9, balance:11359 },
  { time:'03/20 09:30', member:'张磊', type:'充值', desc:'活动补贴', change:2000, balance:11368 },
  { time:'03/18 15:44', member:'陈静', type:'消耗', desc:'微信获客 · 个人卖车', change:-7, balance:9368 },
  { time:'03/17 11:03', member:'赵强', type:'消耗', desc:'小红书获客 · 车商收车', change:-10, balance:9375 },
  { time:'03/15 18:28', member:'张磊', type:'分发', desc:'分发给 陈静 400 算力豆', change:-400, balance:9385 },
  { time:'03/14 10:16', member:'王芳', type:'消耗', desc:'抖音评论获客 · 买车避坑', change:-5, balance:9785 },
  { time:'03/12 09:48', member:'李明', type:'消耗', desc:'小红书获客 · 想换新能源', change:-12, balance:9790 }
];

export function replaceTransactionData(items: typeof transactionData) {
  transactionData.length = 0;
  items.forEach(function(item) { transactionData.push(item); });
}

export const oplogData = [
  { time:'04/13 09:00', operator:'张磊', action:'分发算力豆', target:'分发 500 算力豆给 李明', result:'已完成' },
  { time:'04/10 09:00', operator:'张磊', action:'分发算力豆', target:'分发 300 算力豆给 王芳', result:'已完成' },
  { time:'04/08 16:20', operator:'张磊', action:'新增成员', target:'添加成员 陈静', result:'已加入团队' },
  { time:'04/05 11:00', operator:'张磊', action:'新增成员', target:'添加成员 赵强', result:'已加入团队' },
  { time:'04/03 14:00', operator:'张磊', action:'封禁成员', target:'封禁成员 孙浩（违规操作）', result:'已封禁' },
  { time:'04/01 10:00', operator:'张磊', action:'分发算力豆', target:'分发 1,000 算力豆给 李明', result:'已完成' },
  { time:'03/31 18:10', operator:'张磊', action:'删除成员', target:'移除成员 周涛（已离职）', result:'已移除' },
  { time:'03/30 15:40', operator:'张磊', action:'分发算力豆', target:'分发 200 算力豆给 赵强', result:'已完成' },
  { time:'03/29 12:05', operator:'张磊', action:'新增成员', target:'添加成员 王芳', result:'已加入团队' },
  { time:'03/28 17:20', operator:'张磊', action:'分发算力豆', target:'回收 200 算力豆自 赵强', result:'已完成' },
  { time:'03/27 09:15', operator:'张磊', action:'封禁成员', target:'临时封禁成员 刘敏（待核实）', result:'已封禁' },
  { time:'03/25 19:00', operator:'张磊', action:'删除成员', target:'移除成员 何磊（试用期结束）', result:'已移除' },
  { time:'03/24 10:05', operator:'张磊', action:'新增成员', target:'添加成员 刘敏', result:'已加入团队' },
  { time:'03/22 16:35', operator:'张磊', action:'分发算力豆', target:'分发 300 算力豆给 王芳', result:'已完成' },
  { time:'03/21 11:50', operator:'张磊', action:'新增成员', target:'添加成员 李明', result:'已加入团队' }
];
