export var ROI_WEIGHTS = { comment: 1.3, dm: 1.3, like: 0.4, save: 0.4 };
export var CREDIT_PRICE = 0.3;

export var ROI_DATA = {
  today: {
    total: { comments: 33, dms: 5, likes: 15, saves: 8, credits: 68 },
    platforms: {
      '小红书': { comments: 20, dms: 3, likes: 9, saves: 5, credits: 42 },
      '抖音':   { comments: 8, dms: 1, likes: 4, saves: 2, credits: 16 },
      '快手':   { comments: 4, dms: 1, likes: 2, saves: 1, credits: 8 },
      '微信':   { comments: 1, dms: 0, likes: 0, saves: 0, credits: 2 },
    }
  },
  '7d': {
    total: { comments: 232, dms: 31, likes: 85, saves: 42, credits: 520 },
    platforms: {
      '小红书': { comments: 142, dms: 20, likes: 52, saves: 26, credits: 310 },
      '抖音':   { comments: 52, dms: 7, likes: 19, saves: 9, credits: 120 },
      '快手':   { comments: 25, dms: 3, likes: 9, saves: 5, credits: 58 },
      '微信':   { comments: 13, dms: 1, likes: 5, saves: 2, credits: 32 },
    }
  },
  '30d': {
    total: { comments: 992, dms: 132, likes: 380, saves: 190, credits: 2250 },
    platforms: {
      '小红书': { comments: 610, dms: 85, likes: 233, saves: 117, credits: 1350 },
      '抖音':   { comments: 218, dms: 28, likes: 85, saves: 43, credits: 510 },
      '快手':   { comments: 108, dms: 12, likes: 40, saves: 20, credits: 260 },
      '微信':   { comments: 56, dms: 7, likes: 22, saves: 10, credits: 130 },
    }
  },
};

export function calcROI(range) {
  var entry = ROI_DATA[range] || ROI_DATA['7d'];
  var d = entry.total || entry;
  var w = ROI_WEIGHTS;
  var value = d.comments * w.comment + d.dms * w.dm + d.likes * w.like + d.saves * w.save;
  var cost = d.credits * CREDIT_PRICE;
  return {
    value: value,
    cost: cost,
    roi: cost > 0 ? value / cost : 0,
    saved: value - cost,
    savedPct: cost > 0 ? Math.round((value - cost) / cost * 100) : 0,
    breakdown: [
      { label: '评论', count: d.comments, unit: '条', unitPrice: w.comment, subtotal: d.comments * w.comment },
      { label: '私信', count: d.dms, unit: '条', unitPrice: w.dm, subtotal: d.dms * w.dm },
      { label: '点赞', count: d.likes, unit: '次', unitPrice: w.like, subtotal: d.likes * w.like },
      { label: '收藏', count: d.saves, unit: '次', unitPrice: w.save, subtotal: d.saves * w.save },
    ]
  };
}

export function calcROIPlatforms(range) {
  var entry = ROI_DATA[range] || ROI_DATA['7d'];
  if (!entry.platforms) return [];
  var w = ROI_WEIGHTS;
  return Object.keys(entry.platforms).map(function(name) {
    var d = entry.platforms[name];
    var value = d.comments * w.comment + d.dms * w.dm + d.likes * w.like + d.saves * w.save;
    var cost = d.credits * CREDIT_PRICE;
    return {
      name: name,
      comments: d.comments,
      dms: d.dms,
      likes: d.likes,
      saves: d.saves,
      credits: d.credits,
      value: value,
      cost: cost,
      roi: cost > 0 ? value / cost : 0,
    };
  });
}
