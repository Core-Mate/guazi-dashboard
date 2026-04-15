import { membersData } from '../data/members'
import { openModal, closeModal, showToast } from './modal-toast'
import { getToday, prependTransaction } from './utils'

var nextMemberId = 6;

export function renderMembers(filter?) {
  var filtered = membersData;
  if (filter) {
    var q = filter.toLowerCase();
    filtered = membersData.filter(function(m) {
      return m.name.toLowerCase().includes(q) || m.phone.includes(q);
    });
  }
  var tbody = document.getElementById('membersBody');
  tbody.innerHTML = filtered.map(function(m) {
    var roleBadge = m.role === 'admin' ? '<span class="badge-role-admin">管理员</span>' : '<span class="badge-role-member">成员</span>';
    var actions = m.role === 'admin' ? '—' :
      '<button class="btn-sm" onclick="openManageMemberModal('+m.id+')">管理</button>' +
      '<button class="btn-sm-danger" onclick="confirmRemoveMember('+m.id+')">移除</button>';
    return '<tr><td class="td-bold">'+m.name+'</td><td class="td-mono">'+m.phone+'</td><td>'+roleBadge+'</td><td class="td-mono">'+m.balance.toLocaleString()+'</td><td class="text-muted">'+m.joinDate+'</td><td>'+actions+'</td></tr>';
  }).join('');
}

export function openAddMemberModal() {
  var body = '<div class="modal-field"><label class="modal-label">姓名</label><input class="modal-input" id="newMemberName" placeholder="请输入成员姓名"></div>' +
    '<div class="modal-field"><label class="modal-label">手机号</label><input class="modal-input" id="newMemberPhone" placeholder="请输入手机号"></div>' +
    '<div class="modal-field"><label class="modal-label">角色</label><select class="modal-select" id="newMemberRole"><option value="member">成员</option><option value="admin">管理员</option></select></div>' +
    '<div class="modal-field"><label class="modal-label">初始算力豆</label><input class="modal-input" type="number" id="newMemberBalance" value="0" min="0"></div>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn modal-btn-primary" onclick="addMember()">添加</button>';
  openModal('添加成员', body, footer);
}

export function addMember() {
  var name = (document.getElementById('newMemberName') as HTMLInputElement).value.trim();
  var phone = (document.getElementById('newMemberPhone') as HTMLInputElement).value.trim();
  var role = (document.getElementById('newMemberRole') as HTMLSelectElement).value;
  var balance = parseInt((document.getElementById('newMemberBalance') as HTMLInputElement).value) || 0;
  if (!name || !phone) { showToast('请填写姓名和手机号', 'error'); return; }
  membersData.push({ id: nextMemberId++, name: name, phone: phone, role: role, balance: balance, joinDate: new Date().toISOString().slice(0,10) });
  closeModal();
  renderMembers();
  showToast('成功添加成员 ' + name, 'success');
  var countEl = document.getElementById('statMemberCount');
  if (countEl) countEl.textContent = membersData.length + '人';
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

export function saveManageMember(id) {
  var m = membersData.find(function(x) { return x.id === id; });
  if (!m) return;
  m.name = (document.getElementById('mgName') as HTMLInputElement).value.trim();
  m.phone = (document.getElementById('mgPhone') as HTMLInputElement).value.trim();
  m.role = (document.getElementById('mgRole') as HTMLSelectElement).value;
  var adjust = parseInt((document.getElementById('mgAdjust') as HTMLInputElement).value) || 0;
  if (adjust !== 0) {
    m.balance += adjust;
    var sign = adjust > 0 ? '+' : '';
    prependTransaction(getToday(), adjust > 0 ? '分发' : '扣减', sign + adjust.toLocaleString('en-US') + '算力豆', m.name, '成功');
    var walletEl = document.getElementById('statWallet');
    if (walletEl) {
      var current = parseInt(walletEl.textContent.replace(/,/g, '')) || 0;
      walletEl.textContent = (current - adjust).toLocaleString();
    }
  }
  closeModal();
  renderMembers();
  showToast('成员信息已更新');
}

export function confirmRemoveMember(id) {
  var m = membersData.find(function(x) { return x.id === id; });
  if (!m) return;
  var body = '<p style="color:#71717a;font-size:14px;">确定要移除成员 <strong>'+m.name+'</strong> 吗？此操作不可撤销。</p>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button>' +
    '<button class="modal-btn" style="background:#ef4444;color:#fff;" onclick="removeMember('+id+')">确认移除</button>';
  openModal('移除成员', body, footer);
}

export function removeMember(id) {
  var idx = membersData.findIndex(function(x) { return x.id === id; });
  if (idx >= 0) membersData.splice(idx, 1);
  closeModal();
  renderMembers();
  showToast('成员已移除', 'success');
}
