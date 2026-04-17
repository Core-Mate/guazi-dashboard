export var ROI_WEIGHTS = { comment: 1.3, dm: 1.3, like: 0.4, save: 0.4 };
export var CREDIT_PRICE = 0.3;

var EMPTY_TOTAL = { comments: 0, dms: 0, likes: 0, saves: 0, credits: 0 };

export var ROI_DATA: any = {
  today: { total: EMPTY_TOTAL, platforms: {} },
  '7d': { total: EMPTY_TOTAL, platforms: {} },
  '30d': { total: EMPTY_TOTAL, platforms: {} },
  custom: { total: EMPTY_TOTAL, platforms: {} },
};

export function calcROI(_range: string) {
  return {
    value: 0,
    cost: 0,
    roi: 0,
    saved: 0,
    savedPct: 0,
    breakdown: [],
  };
}

export function calcROIPlatforms(_range: string) {
  return [] as any[];
}
