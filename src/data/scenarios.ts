export const scenarioGroups = [
  { id:'acquire', icon:'🎯', name:'获客触达', color:'#6366f1',
    extraCols:['评论','点赞','收藏','私信','触达量(去重)'],
    extraFn: r => [r.comments, r.likes, r.favorites, r.dms, r.uniqueReach],
    extraBold: [4],
  },
];

export var skillData = {
  acquire: [
    { skill:'1号', skillName:'个人卖车词+互动留资版', exec:5, success:2, fail:3, avgDur:'10:06', tokenAvg:4621, comments:58, likes:73, favorites:73, dms:0, profileViews:0, uniqueReach:48 },
    { skill:'3号', skillName:'个人卖车/个人自用车+极简任务指令', exec:4, success:2, fail:2, avgDur:'7:41', tokenAvg:9329, comments:99, likes:87, favorites:87, dms:23, profileViews:3, uniqueReach:95 },
    { skill:'2号', skillName:'个人自用车+需求响应规范版', exec:3, success:2, fail:1, avgDur:'5:30', tokenAvg:4369, comments:25, likes:40, favorites:0, dms:8, profileViews:0, uniqueReach:28 },
    { skill:'4号', skillName:'多关键词+懂车老司机人设指令', exec:3, success:3, fail:0, avgDur:'7:14', tokenAvg:9062, comments:50, likes:40, favorites:0, dms:0, profileViews:0, uniqueReach:40 },
  ],
};

export let enabledScenarios = ['acquire'];

export function replaceSkillData(groupId: string, items) {
  skillData[groupId] = items;
}
