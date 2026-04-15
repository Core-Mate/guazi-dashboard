import { ACHIEVEMENT_RULES, ACHIEVEMENT_CONTEXTS } from '../data/achievements'

export function computeAchievements(ctx) {
  return ACHIEVEMENT_RULES.filter(r => r.test(ctx)).map(r => ({
    emoji: r.emoji,
    text: r.textFn ? r.textFn(ctx) : r.text,
    detail: r.detailFn ? r.detailFn(ctx) : (r.detail || ''),
    theme: r.theme,
  }));
}

export function renderAchievements(range) {
  const bar = document.getElementById('achievementBar');
  if (!bar) return;
  const ctx = ACHIEVEMENT_CONTEXTS[range] || ACHIEVEMENT_CONTEXTS['7d'];
  const achievements = computeAchievements(ctx);
  if (!achievements.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = achievements.map((a, i) =>
    '<span class="achievement-tag achieve-'+a.theme+'" style="animation-delay:'+i*0.08+'s" onmousemove="tiltAchieve(event,this)" onmouseleave="resetAchieve(this)">' +
      '<span class="achieve-emoji">'+a.emoji+'</span>' +
      '<span class="achieve-title">'+a.text+'</span>' +
      (a.detail ? '<span class="achieve-detail">'+a.detail+'</span>' : '') +
    '</span>'
  ).join('');
}

export function tiltAchieve(e, el) {
  var r = el.getBoundingClientRect();
  var x = (e.clientX - r.left) / r.width - 0.5;
  var y = (e.clientY - r.top) / r.height - 0.5;
  el.style.transform = 'perspective(400px) rotateY('+x*12+'deg) rotateX('+(-y*12)+'deg) scale(1.04)';
}

export function resetAchieve(el) {
  el.style.transform = '';
}
