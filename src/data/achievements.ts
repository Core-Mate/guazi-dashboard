export const ACHIEVEMENT_RULES = [
  { id:'reach_record', emoji:'🏆', text:'本周触达量创新高', detail:'超越历史最高记录', theme:'gold', test: ctx => ctx.reach > ctx.historyMax },
  { id:'growth_streak', emoji:'📈', textFn: ctx => '连续 '+ctx.growthWeeks+' 周增长', detailFn: ctx => '已保持 '+ctx.growthWeeks+' 周正增长', theme:'green', test: ctx => ctx.growthWeeks >= 2 },
  { id:'best_efficiency', emoji:'⚡', textFn: ctx => ctx.bestSkill+'效率最佳', detailFn: ctx => ctx.bestSkill+' 号指令集触达效率领先', theme:'purple', test: ctx => !!ctx.bestSkill },
  { id:'reach_milestone', emoji:'🎯', textFn: ctx => '累计触达突破 '+ctx.milestone.toLocaleString(), detail:'里程碑达成', theme:'blue', test: ctx => ctx.milestone > 0 },
  { id:'top_skill', emoji:'🔥', textFn: ctx => '指令集'+ctx.topSkill+'表现最佳', detailFn: ctx => ctx.topSkill+' 号产出最高', theme:'orange', test: ctx => !!ctx.topSkill },
  { id:'new_skill', emoji:'✨', text:'新指令集已上线', detail:'可在指令集商店查看', theme:'purple', test: ctx => ctx.hasNewSkill },
  { id:'full_device', emoji:'💪', text:'设备利用率 100%', detail:'所有设备均在执行任务', theme:'blue', test: ctx => ctx.deviceUtil >= 1 },
  { id:'cost_down', emoji:'📊', text:'周均触达成本下降', detail:'获客效率持续优化', theme:'green', test: ctx => ctx.costDown },
  { id:'peak_day', emoji:'🚀', textFn: ctx => '日触达峰值 '+ctx.peakDay+' 人', detailFn: ctx => '单日最高触达 '+ctx.peakDay+' 人', theme:'gold', test: ctx => ctx.peakDay > 0 },
];

export const ACHIEVEMENT_CONTEXTS = {
  today: { reach:38, historyMax:35, growthWeeks:3, bestSkill:'3号', milestone:1000, riskCount:0, topSkill:'3号', hasNewSkill:false, deviceUtil:0.8, costDown:true, peakDay:38 },
  '7d': { reach:266, historyMax:225, growthWeeks:3, bestSkill:'3号', milestone:1000, riskCount:2, topSkill:'3号', hasNewSkill:false, deviceUtil:1, costDown:true, peakDay:65 },
  '30d': { reach:1140, historyMax:900, growthWeeks:3, bestSkill:'3号', milestone:1000, riskCount:5, topSkill:'3号', hasNewSkill:true, deviceUtil:1, costDown:true, peakDay:70 },
};
ACHIEVEMENT_CONTEXTS.custom = ACHIEVEMENT_CONTEXTS['7d'];
