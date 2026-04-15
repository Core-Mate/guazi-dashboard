import { platformMap, platformList } from '../data/platforms'
import { deviceList } from '../data/devices'
import { tasks } from '../data/tasks'

export function pTag(name) {
  const cls = platformMap[name] || 'tag-default';
  return `<span class="tag ${cls}">${name}</span>`;
}

export function initFilters() {
  const pSel = document.getElementById('platformFilter');
  if (pSel) {
    platformList.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      pSel.appendChild(opt);
    });
    const other = document.createElement('option');
    other.value = '__other__'; other.textContent = '其他平台';
    pSel.appendChild(other);
  }
  const dSel = document.getElementById('deviceFilter');
  if (dSel) {
    deviceList.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id; opt.textContent = d.label;
      dSel.appendChild(opt);
    });
  }
}

export function renderTaskTable() {
  const tbody = document.getElementById('taskTableBody');
  tbody.innerHTML = tasks.map((t, i) => {
    return `<tr onclick="openDrawer(${i})"><td class="td-bold">${t.name}</td><td class="td-mono">${t.skill||'–'}</td><td>${pTag(t.platform)}</td><td class="td-mono">${t.device}</td><td><span class="badge-status ${t.statusClass}">${t.status}</span></td><td>${t.duration}</td><td class="td-mono">${t.cost}</td><td class="text-muted">${t.time}</td></tr>`;
  }).join('');
}

export function animateAllNumbers() {
  document.querySelectorAll('.highlight-value').forEach(function(el) {
    var text = el.textContent;
    var num = parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
    var suffix = text.replace(/[\d,.\s]/g, '');
    if (num > 0) {
      var origText = text;
      el.textContent = '0';
      var startTime = performance.now();
      function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
      function update(now) {
        var progress = Math.min((now - startTime) / 800, 1);
        var eased = easeOutQuart(progress);
        var current = Math.round(num * eased);
        el.textContent = current.toLocaleString() + suffix;
        if (progress < 1) requestAnimationFrame(update);
        else el.textContent = origText;
      }
      requestAnimationFrame(update);
    }
  });
}

export function getToday(){
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

export function getStatNum(id){
  var el=document.getElementById(id);
  if(!el)return 0;
  return parseInt(el.textContent.replace(/,/g,''))||0;
}

export function setStatNum(id,num){
  var el=document.getElementById(id);
  if(!el)return;
  el.textContent=num.toLocaleString('en-US');
}

export function prependTransaction(date,type,amount,operator,status){
  var tbody=document.getElementById('transactionTbody');
  if(!tbody)return;
  var tr=document.createElement('tr');
  tr.innerHTML='<td class="text-muted">'+date+'</td><td>'+type+'</td><td>'+operator+'</td><td class="'+(amount.charAt(0)==='-'?'text-red':'text-green')+'">'+amount+'</td><td class="td-mono">-</td>';
  tbody.insertBefore(tr,tbody.firstChild);
}
