import { tasks } from '../data/tasks'
import { pTag } from './utils'

export function openDrawer(i) {
  const t = tasks[i];
  document.getElementById('drawerTitle').textContent = t.name;
  document.getElementById('drawerSub').textContent = t.fullTime;
  document.getElementById('drawerKV').innerHTML = `<dt>平台</dt><dd>${t.platform}</dd><dt>设备</dt><dd>${t.device}</dd><dt>状态</dt><dd>${t.status}</dd><dt>执行耗时</dt><dd>${t.duration}</dd><dt>消耗算力豆</dt><dd>${t.cost} 算力豆</dd>`;
  document.getElementById('drawerReport').innerHTML = t.report.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  document.getElementById('drawerOverlay').classList.add('open');
}

export function closeDrawer() { document.getElementById('drawerOverlay').classList.remove('open'); }

export function switchDrawerTab(tab, btn) {
  document.querySelectorAll('.drawer-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.drawer-tab-content').forEach(function(c) { c.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('drawerTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

