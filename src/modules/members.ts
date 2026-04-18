import { membersData } from '../data/members'
import { openModal, closeModal, showToast } from './modal-toast'
import { addTransactionRecord, addOplogRecord } from '../data/records'
import { apiAddMember, apiUpdateMember, apiDeleteMember, apiDistributeCredits, fetchWallet } from '../data/api'
import { renderOverviewOplog } from './wallet'
import { fetchMembers as fetchMembersApi, populateMemberFilter } from './api-integration'

function startLoading(label?: string) {
  var btn = document.querySelector('#modalFooter .modal-btn:not(.modal-btn-cancel)') as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.classList.add('btn-loading'); btn.textContent = label || '处理中...'; }
  return btn;
}
function stopLoading(btn: HTMLButtonElement, label: string) {
  if (btn) { btn.disabled = false; btn.classList.remove('btn-loading'); btn.textContent = label; }
}

var selectedMemberIds: Set<number> = new Set();
var memberSearchQuery = '';

export var memberSortKey: 'name' | 'phone' | 'role' | 'balance' | 'joinedAt' = 'joinedAt';
export var memberSortDir: 'asc' | 'desc' = 'desc';

function getMemberRoleLabel(role) {
  return role === 'admin' ? '管理员' : '成员';
}

function toMemberNumber(value) {
  var num = parseFloat(String(value || '').replace(/[^\d.-]/g, ''));
  return isNaN(num) ? 0 : num;
}

function toMemberTime(value) {
  var parsed = Number(new Date(value));
  return isNaN(parsed) ? 0 : parsed;
}

function compareMemberText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-CN');
}

function sortMemberRows(rows) {
  return rows.slice().sort(function(a, b) {
    var result = 0;
    if (memberSortKey === 'name') result = compareMemberText(a.name, b.name);
    else if (memberSortKey === 'phone') result = compareMemberText(a.phone, b.phone);
    else if (memberSortKey === 'role') result = compareMemberText(getMemberRoleLabel(a.role), getMemberRoleLabel(b.role));
    else if (memberSortKey === 'balance') result = toMemberNumber(a.balance) - toMemberNumber(b.balance);
    else if (memberSortKey === 'joinedAt') result = toMemberTime(a.joinDate) - toMemberTime(b.joinDate);
    if (result === 0) return 0;
    return memberSortDir === 'asc' ? result : -result;
  });
}

function syncMemberSortHeaders() {
  document.querySelectorAll('th[data-sort-group="members"]').forEach(function(node) {
    var th = node as HTMLElement;
    var key = th.getAttribute('data-sort-key') || '';
    var arrow = th.querySelector('.sort-arrow') as HTMLElement | null;
    th.classList.remove('th-sort-asc', 'th-sort-desc');
    if (key === memberSortKey) {
      th.classList.add(memberSortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      if (arrow) {
        arrow.textContent = memberSortDir === 'asc' ? '▲' : '▼';
        arrow.style.opacity = '1';
      }
      th.setAttribute('aria-sort', memberSortDir === 'asc' ? 'ascending' : 'descending');
    } else {
      if (arrow) {
        arrow.textContent = '▼';
        arrow.style.opacity = '0.45';
      }
      th.setAttribute('aria-sort', 'none');
    }
  });
}

export function sortMembers(key: 'name' | 'phone' | 'role' | 'balance' | 'joinedAt') {
  if (memberSortKey === key) memberSortDir = memberSortDir === 'asc' ? 'desc' : 'asc';
  else {
    memberSortKey = key;
    memberSortDir = 'desc';
  }
  renderMembers();
}

async function refreshFromApi() {
  var data = await fetchMembersApi();
  membersData.length = 0;
  data.forEach(function(m) {
    membersData.push({
      id: m.id,
      name: m.username || '未知',
      phone: m.phone || '',
      role: m.role === 'admin' ? 'admin' : 'member',
      balance: Math.round(m.balance),
      joinDate: m.join_date ? m.join_date.slice(0, 10) : '',
    });
  });
  renderMembers();
  populateMemberFilter();
  var countEl = document.getElementById('statMemberCount');
  if (countEl) countEl.textContent = membersData.length + '人';
  var admin = membersData.find(function(m) { return m.role === 'admin'; });
  var nameEl = document.getElementById('sidebarUserName');
  var avatarEl = document.getElementById('sidebarAvatar');
  var roleEl = document.getElementById('sidebarUserRole');
  if (nameEl) nameEl.textContent = admin ? admin.name : '未加载成员';
  if (avatarEl) avatarEl.textContent = admin ? admin.name.charAt(0) : '—';
  if (roleEl) roleEl.textContent = admin ? '管理员' : '';
}

async function refreshWalletStats() {
  var data = await fetchWallet();
  if (!data) return;
  var setIf = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  setIf('statWallet', Math.round(data.total_balance).toLocaleString());
  setIf('statTopup', Math.round(data.total_recharged).toLocaleString());
  setIf('statConsumed', Math.round(data.total_consumed).toLocaleString());
}

function getPrimaryAdminId() {
  return membersData.find(function(m) { return m.role === 'admin'; })?.id ?? null;
}

export function renderMembers(filter?) {
  if (typeof filter === 'string') memberSearchQuery = filter.trim();
  var filtered = membersData;
  var primaryAdminId = getPrimaryAdminId();
  var countEl = document.getElementById('statMemberCount');
  if (countEl) countEl.textContent = membersData.length + '人';
  if (memberSearchQuery) {
    var q = memberSearchQuery.toLowerCase();
    filtered = membersData.filter(function(m) {
      return m.name.toLowerCase().includes(q) || m.phone.includes(q);
    });
  }
  var tbody = document.getElementById('membersBody');
  if (!tbody) {
    syncMemberSortHeaders();
    return;
  }
  filtered = sortMemberRows(filtered);
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:24px 12px;text-align:center;color:#94a3b8;">'
      + (memberSearchQuery ? '未找到匹配的成员' : '暂无成员数据') + '</td></tr>';
    syncMemberSortHeaders();
    updateBatchBar();
    return;
  }
  tbody.innerHTML = filtered.map(function(m) {
    var isPrimaryAdmin = m.id === primaryAdminId;
    var roleBadge = m.role === 'admin' ? '<span class="badge-role-admin">管理员</span>' : '<span class="badge-role-member">成员</span>';
    var selectCell = isPrimaryAdmin ? '<td></td>' : '<td><input type="checkbox" class="member-checkbox" data-id="'+m.id+'"'+(selectedMemberIds.has(m.id) ? ' checked' : '')+' onchange="toggleMemberSelect('+m.id+',this.checked)"></td>';
    var actions = isPrimaryAdmin ? '—' :
      '<button class="btn-sm" onclick="openManageMemberModal('+m.id+')">管理</button>' +
      '<button class="btn-sm-danger" onclick="confirmRemoveMember('+m.id+')">移除</button>';
    return '<tr>'+selectCell+'<td class="td-bold">'+m.name+'</td><td class="td-mono">'+m.phone+'</td><td>'+roleBadge+'</td><td class="td-mono">'+m.balance.toLocaleString()+'</td><td class="text-muted">'+m.joinDate+'</td><td>'+actions+'</td></tr>';
  }).join('');
  var allRows = tbody.querySelectorAll('tr') as any;
  allRows.forEach(function(row, i) {
    var delay = Math.min(i, 20) * 30;
    row.style.opacity = '0';
    row.style.transform = 'translateY(4px)';
    row.style.transition = 'opacity 200ms cubic-bezier(0.4,0,0.2,1), transform 200ms cubic-bezier(0.4,0,0.2,1)';
    row.style.transitionDelay = delay + 'ms';
    setTimeout(function() { row.style.opacity = '1'; row.style.transform = 'translateY(0)'; }, 10);
  });
  syncMemberSortHeaders();
}

export function openAddMemberModal() {
  var body = '<div class="modal-field"><label class="modal-label">姓名</label><input class="modal-input" id="newMemberName" placeholder="请输入成员姓名"></div>' +
    '<div class="modal-field"><label class="modal-label">手机号</label><input class="modal-input" id="newMemberPhone" placeholder="请输入手机号"></div>' +
    '<div class="modal-field"><label class="modal-label">初始算力豆</label><input class="modal-input" type="number" id="newMemberBalance" value="0" min="0"></div>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn modal-btn-primary" onclick="addMember()">添加</button>';
  openModal('添加成员', body, footer);
}

export async function addMember() {
  var name = (document.getElementById('newMemberName') as HTMLInputElement).value.trim();
  var phone = (document.getElementById('newMemberPhone') as HTMLInputElement).value.trim();
  var balance = parseInt((document.getElementById('newMemberBalance') as HTMLInputElement).value) || 0;
  if (!name || !phone) { showToast('请填写姓名和手机号', 'error'); return; }

  var btn = startLoading();
  var operator = '管理员';
  var operatorMember = membersData.find(function(x) { return x.role === 'admin'; });
  if (operatorMember) operator = operatorMember.name;
  var res = await apiAddMember(name, phone, balance);
  if (!res.ok) { stopLoading(btn, '添加'); showToast(res.error || '添加失败', 'error'); return; }
  closeModal();
  await Promise.all([refreshFromApi(), refreshWalletStats()]);
  showToast('成功添加成员 ' + name, 'success');
  addOplogRecord(operator, '新增成员', '添加成员 ' + name, '已加入团队');
  renderOverviewOplog();
}

export function openManageMemberModal(id) {
  var m = membersData.find(function(x) { return x.id === id; });
  if (!m) return;
  var body = '<div class="modal-field"><label class="modal-label">姓名</label><input class="modal-input" id="mgName" value="'+m.name+'"></div>' +
    '<div class="modal-field"><label class="modal-label">手机号</label><input class="modal-input" id="mgPhone" value="'+m.phone+'"></div>' +
    '<div class="modal-field"><label class="modal-label">角色</label><select class="modal-select" id="mgRole"><option value="member" '+(m.role==='member'?'selected':'')+'>成员</option><option value="admin" '+(m.role==='admin'?'selected':'')+'>管理员</option></select></div>' +
    '<div style="border-top:1px solid #e4e4e7;margin:16px 0;"></div>' +
    '<div style="font-size:13px;font-weight:600;color:#52525b;margin-bottom:12px;">算力豆管理</div>' +
    '<div class="modal-field"><label class="modal-label">当前余额</label><div style="font-size:14px;font-weight:600;color:#2563eb;padding:8px 0;">'+m.balance.toLocaleString()+' 算力豆</div></div>' +
    '<div class="modal-field"><label class="modal-label">调整数量</label><input class="modal-input" id="mgAdjust" type="number" placeholder="正数增加，负数扣减"></div>' +
    '<div class="modal-field"><label class="modal-label">备注（可选）</label><input class="modal-input" id="mgNote" type="text" placeholder="备注说明"></div>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn modal-btn-primary" onclick="saveManageMember('+id+')">保存</button>';
  openModal('管理成员 · ' + m.name, body, footer);
}

export async function saveManageMember(id) {
  if (id === getPrimaryAdminId()) return;
  var m = membersData.find(function(x) { return x.id === id; });
  if (!m) return;
  var name = (document.getElementById('mgName') as HTMLInputElement).value.trim();
  var phone = (document.getElementById('mgPhone') as HTMLInputElement).value.trim();
  var role = (document.getElementById('mgRole') as HTMLSelectElement).value;
  var adjust = parseInt((document.getElementById('mgAdjust') as HTMLInputElement).value) || 0;
  var note = ((document.getElementById('mgNote') as HTMLInputElement) || {}).value || '';
  note = note.trim();
  var operator = '管理员';
  var operatorMember = membersData.find(function(x) { return x.role === 'admin'; });
  if (operatorMember) operator = operatorMember.name;

  var btn = startLoading();
  var updateRes = await apiUpdateMember(id, { name: name, phone_number: phone, role: role });
  if (!updateRes.ok) { stopLoading(btn, '保存'); showToast(updateRes.error || '更新失败', 'error'); return; }

  if (adjust !== 0) {
    var admin = membersData.find(function(x) { return x.role === 'admin'; });
    if (!admin) { stopLoading(btn, '保存'); showToast('找不到管理员账号', 'error'); return; }
    var distRes;
    if (adjust > 0) {
      distRes = await apiDistributeCredits(admin.id, id, adjust, note || '管理员分发');
    } else {
      distRes = await apiDistributeCredits(id, admin.id, Math.abs(adjust), note || '管理员扣减');
    }
    if (!distRes.ok) { stopLoading(btn, '保存'); showToast(distRes.error || '调整余额失败', 'error'); return; }
  }

  closeModal();
  await Promise.all([refreshFromApi(), refreshWalletStats()]);
  if (adjust !== 0) {
    addTransactionRecord(operator, adjust > 0 ? '分发' : '扣减', adjust > 0 ? '分发给 ' + name + ' ' + adjust.toLocaleString() + ' 算力豆' : '回收 ' + Math.abs(adjust).toLocaleString() + ' 算力豆自 ' + name, -adjust);
    addOplogRecord(operator, '分发算力豆', adjust > 0 ? '分发 ' + adjust.toLocaleString() + ' 算力豆给 ' + name : '回收 ' + Math.abs(adjust).toLocaleString() + ' 算力豆自 ' + name);
  }
  addOplogRecord(operator, '编辑成员', '编辑成员 ' + name, '已更新');
  renderOverviewOplog();
  showToast('成员信息已更新', 'success');
}

export function confirmRemoveMember(id) {
  var m = membersData.find(function(x) { return x.id === id; });
  if (!m) return;
  if (id === getPrimaryAdminId()) { showToast('管理员不可移除', 'error'); return; }
  var body = '<p style="color:#71717a;font-size:14px;">确定要移除成员 <strong>'+m.name+'</strong> 吗？此操作不可撤销。</p>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn" style="background:#ef4444;color:#fff;" onclick="removeMember('+id+')">确认移除</button>';
  openModal('移除成员', body, footer);
}

export async function removeMember(id) {
  var m = membersData.find(function(x) { return x.id === id; });
  if (m && id === getPrimaryAdminId()) { showToast('管理员不可移除', 'error'); closeModal(); return; }
  var memberName = m ? m.name : '未知';
  var operator = '管理员';
  var operatorMember = membersData.find(function(x) { return x.role === 'admin'; });
  if (operatorMember) operator = operatorMember.name;
  var btn = startLoading();
  var res = await apiDeleteMember(id);
  if (!res.ok) { stopLoading(btn, '确认移除'); showToast(res.error || '移除失败', 'error'); return; }
  closeModal();
  await Promise.all([refreshFromApi(), refreshWalletStats()]);
  addOplogRecord(operator, '删除成员', '移除成员 ' + memberName, '已移除');
  renderOverviewOplog();
  showToast('成员已移除', 'success');
}

function updateBatchBar() {
  var bar = document.getElementById('memberBatchBar');
  var countEl = document.getElementById('memberBatchCount');
  if (!bar) return;
  if (selectedMemberIds.size > 0) {
    bar.style.display = 'flex';
    if (countEl) countEl.textContent = '已选 ' + selectedMemberIds.size + ' 人';
  } else {
    bar.style.display = 'none';
  }
  var allCheckbox = document.getElementById('memberSelectAll') as HTMLInputElement;
  var allBoxes = document.querySelectorAll('#membersBody .member-checkbox');
  if (allCheckbox && allBoxes.length) {
    allCheckbox.checked = selectedMemberIds.size === allBoxes.length && allBoxes.length > 0;
  }
}

export function toggleMemberSelect(id, checked) {
  if (checked) selectedMemberIds.add(id);
  else selectedMemberIds.delete(id);
  updateBatchBar();
}

export function toggleSelectAllMembers(checked) {
  var primaryAdminId = getPrimaryAdminId();
  var selectedIds = checked ? membersData.filter(function(m) { return m.id !== primaryAdminId; }).map(function(m) { return m.id; }) : [];
  selectedMemberIds = new Set(selectedIds);
  var checkboxes = document.querySelectorAll('#membersBody .member-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(function(cb) {
    var id = parseInt(cb.dataset.id);
    cb.checked = checked;
    if (checked && selectedIds.indexOf(id) === -1) cb.checked = false;
  });
  updateBatchBar();
}

export function cancelBatchSelect() {
  selectedMemberIds.clear();
  var checkboxes = document.querySelectorAll('.member-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(function(cb) { cb.checked = false; });
  updateBatchBar();
}

export function openBatchDistributeModal() {
  if (selectedMemberIds.size === 0) return;
  var names = [];
  membersData.filter(function(m) { return m.id !== getPrimaryAdminId(); }).forEach(function(m) {
    if (selectedMemberIds.has(m.id)) names.push(m.name);
  });
  var body = '<div class="modal-field"><label class="modal-label">分发对象</label>' +
    '<div style="color:#71717a;font-size:13px;margin-bottom:12px;">' + names.join('、') + '（共' + names.length + '人）</div></div>' +
    '<div class="modal-field"><label class="modal-label">每人分发算力豆数量</label>' +
    '<input class="modal-input" type="number" id="batchDistAmount" min="1" placeholder="输入数量"></div>' +
    '<div class="modal-field"><label class="modal-label">备注（可选）</label>' +
    '<input class="modal-input" id="batchDistRemark" placeholder="批量分发"></div>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn modal-btn-primary" onclick="confirmBatchDistribute()">确认分发</button>';
  openModal('批量分发算力豆', body, footer);
}

export function confirmBatchRemove() {
  if (selectedMemberIds.size === 0) return;
  var names = [];
  membersData.forEach(function(m) {
    if (selectedMemberIds.has(m.id) && m.id !== getPrimaryAdminId()) names.push(m.name);
  });
  if (names.length === 0) { showToast('管理员不可移除', 'error'); return; }
  var body = '<p style="color:#71717a;font-size:14px;">确定要移除以下 <strong>' + names.length + '</strong> 位成员吗？此操作不可撤销。</p>' +
    '<div style="margin-top:8px;padding:8px 12px;background:#fef2f2;border-radius:6px;font-size:13px;color:#dc2626;">' + names.join('、') + '</div>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn" style="background:#ef4444;color:#fff;" onclick="executeBatchRemove()">确认移除</button>';
  openModal('批量移除成员', body, footer);
}

export async function executeBatchRemove() {
  var targetIds = Array.from(selectedMemberIds).filter(function(id) {
    var m = membersData.find(function(x) { return x.id === id; });
    return m && id !== getPrimaryAdminId();
  });
  if (targetIds.length === 0) { closeModal(); return; }
  var targetNames = targetIds.map(function(id) {
    var member = membersData.find(function(x) { return x.id === id; });
    return member ? member.name : '未知';
  });
  var operator = '管理员';
  var operatorMember = membersData.find(function(x) { return x.role === 'admin'; });
  if (operatorMember) operator = operatorMember.name;

  var btn = startLoading();
  for (var i = 0; i < targetIds.length; i++) {
    var res = await apiDeleteMember(targetIds[i]);
    if (!res.ok) {
      stopLoading(btn, '确认移除');
      showToast('移除第 ' + (i + 1) + ' 人时失败: ' + (res.error || ''), 'error');
      return;
    }
  }
  closeModal();
  await Promise.all([refreshFromApi(), refreshWalletStats()]);
  targetNames.forEach(function(name) {
    addOplogRecord(operator, '删除成员', '移除成员 ' + name, '已移除');
  });
  renderOverviewOplog();
  cancelBatchSelect();
  showToast('已成功移除 ' + targetIds.length + ' 位成员', 'success');
}

export async function confirmBatchDistribute() {
  var amountEl = document.getElementById('batchDistAmount') as HTMLInputElement;
  var remarkEl = document.getElementById('batchDistRemark') as HTMLInputElement;
  var amount = parseInt(amountEl?.value || '0');
  if (!amount || amount <= 0) { showToast('请输入有效金额', 'error'); return; }

  var admin = membersData.find(function(m) { return m.role === 'admin'; });
  if (!admin) { showToast('未找到管理员', 'error'); return; }

  var targetIds = Array.from(selectedMemberIds);
  var totalNeeded = amount * targetIds.length;

  if (admin.balance < totalNeeded) {
    showToast('余额不足，需要 ' + totalNeeded + ' 算力豆，当前 ' + admin.balance, 'error');
    return;
  }

  var btn = startLoading();
  var remark = remarkEl?.value || '批量分发';
  for (var i = 0; i < targetIds.length; i++) {
    var res = await apiDistributeCredits(admin.id, targetIds[i], amount, remark);
    if (!res.ok) {
      stopLoading(btn, '确认分发');
      showToast('分发给第 ' + (i + 1) + ' 人时失败: ' + (res.error || ''), 'error');
      return;
    }
  }
  targetIds.forEach(function(tid) {
    var target = membersData.find(function(m) { return m.id === tid; });
    var targetName = target ? target.name : '未知';
    addTransactionRecord(admin.name, '分发', '分发给 ' + targetName + ' ' + amount.toLocaleString() + ' 算力豆', -amount);
    addOplogRecord(admin.name, '分发算力豆', '分发 ' + amount.toLocaleString() + ' 算力豆给 ' + targetName);
  });
  renderOverviewOplog();
  closeModal();
  await Promise.all([refreshFromApi(), refreshWalletStats()]);
  cancelBatchSelect();
  showToast('已成功向 ' + targetIds.length + ' 人各分发 ' + amount + ' 算力豆', 'success');
}

(window as any).sortMembers = sortMembers;
