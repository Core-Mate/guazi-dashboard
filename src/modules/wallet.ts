import { openModal, closeModal, showToast } from './modal-toast'
import { membersData } from '../data/members'
import { apiDistributeCredits } from '../data/api'
import { renderOverviewOplogTable } from './records'
import { refreshDashboard } from '../main'

function startLoading(label?: string) {
  var btn = document.querySelector('#modalFooter .modal-btn:not(.modal-btn-cancel)') as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.classList.add('btn-loading'); btn.textContent = label || '处理中...'; }
  return btn;
}
function stopLoading(btn: HTMLButtonElement, label: string) {
  if (btn) { btn.disabled = false; btn.classList.remove('btn-loading'); btn.textContent = label; }
}

export function renderOverviewOplog() {
  return renderOverviewOplogTable(10);
}

export function openDistributeToMember(id) {
  var m = membersData.find(function(x) { return x.id === id; });
  if (!m) return;
  var body = '<div class="modal-field"><label class="modal-label">成员</label><div style="font-size:14px;font-weight:500;padding:8px 0;">'+m.name+'</div></div>' +
    '<div class="modal-field"><label class="modal-label">分发数量</label><input class="modal-input" id="dAmount" type="number" min="1" placeholder="请输入算力豆数量"></div>' +
    '<div class="modal-field"><label class="modal-label">备注（可选）</label><input class="modal-input" id="dNote" type="text" placeholder="备注说明"></div>' +
    '<input type="hidden" id="dMemberId" value="'+m.id+'">';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button><button class="modal-btn modal-btn-primary" onclick="confirmDistribute()">确认分发</button>';
  openModal('分发算力豆给 '+m.name, body, footer);
}

export function openDistributeModal() {
  var nonAdmin = membersData.filter(function(m) { return m.role !== 'admin'; });
  var opts = nonAdmin.map(function(m) { return '<option value="'+m.id+'">'+m.name+'</option>'; }).join('');
  var body = '<div class="modal-field"><label class="modal-label">选择成员</label><select class="modal-select" id="dMemberId">'+opts+'</select></div>' +
    '<div class="modal-field"><label class="modal-label">分发数量</label><input class="modal-input" id="dAmount" type="number" min="1" placeholder="请输入算力豆数量"></div>' +
    '<div class="modal-field"><label class="modal-label">备注（可选）</label><input class="modal-input" id="dNote" type="text" placeholder="备注说明"></div>';
  var footer = '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button><button class="modal-btn modal-btn-primary" onclick="confirmDistribute()">确认分发</button>';
  openModal('分发算力豆', body, footer);
}

export async function confirmDistribute() {
  var memberIdEl = document.getElementById('dMemberId') as HTMLInputElement | HTMLSelectElement;
  if (!memberIdEl) return;
  var memberId = parseInt(memberIdEl.value);
  var amount = parseInt((document.getElementById('dAmount') as HTMLInputElement).value) || 0;
  var noteEl = document.getElementById('dNote') as HTMLInputElement;
  var note = noteEl ? noteEl.value.trim() : '';

  if (!memberId || isNaN(memberId)) { showToast('请选择成员', 'error'); return; }
  if (amount <= 0) { showToast('请输入有效算力豆数量', 'error'); return; }

  var btn = startLoading();
  var member = membersData.find(function(x) { return x.id === memberId; });
  var memberName = member ? member.name : '未知';

  var admin = membersData.find(function(x) { return x.role === 'admin'; });
  if (!admin) { stopLoading(btn, '确认分发'); showToast('找不到管理员账号', 'error'); return; }
  if (amount > admin.balance) { stopLoading(btn, '确认分发'); showToast('管理员余额不足', 'error'); return; }

  var res = await apiDistributeCredits(admin.id, memberId, amount, note || '分发算力豆');
  if (!res.ok) { stopLoading(btn, '确认分发'); showToast(res.error || '分发失败', 'error'); return; }

  closeModal();
  await refreshDashboard();
  showToast('✓ 成功分发 ' + amount.toLocaleString() + ' 算力豆给 ' + memberName, 'success');
}
