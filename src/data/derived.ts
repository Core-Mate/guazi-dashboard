export var tasks: any[] = [];
export var execSteps: Record<number, any[]> = {};

export var accountList: any[] = [];
export var scenarioGroups: any[] = [];
export var skillData: any = {};
export function replaceSkillData(_g: string, _items: any) {}
export var deviceList: any[] = [];
export var deviceMetrics: Record<string, any> = {};
export var deviceHeat: any[] = [];
export var deviceStats: any[] = [];
export var heatPlatforms: string[] = [];
export var enabledScenarios: string[] = [];
export var PLATFORM_BREAKDOWN: any = { today: [], '7d': [], '30d': [], custom: [] };
export var INTERACTION_BREAKDOWN: any = { today: [], '7d': [], '30d': [], custom: [] };

var emptyAchievementMetrics: Array<{
  emoji?: string;
  label?: string;
  bestLabel?: string;
  bestChange?: number;
  bestCurrent?: number;
  bestPrev?: number | null;
}> = [];

export var ACHIEVEMENT_CONTEXTS: any = {
  today: { metrics: emptyAchievementMetrics.slice() },
  '7d': { metrics: emptyAchievementMetrics.slice() },
  '30d': { metrics: emptyAchievementMetrics.slice() },
  custom: { metrics: emptyAchievementMetrics.slice() },
};

export var mockData: any = {
  today: {},
  '7d': {},
  '30d': {},
  custom: {},
};

export var membersData: any[] = [];
