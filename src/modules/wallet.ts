import { openModal, closeModal, showToast } from './modal-toast'
import { getStatNum, setStatNum, getToday, prependTransaction } from './utils'
import { oplogData } from '../data/records'
import { membersData } from '../data/members'

export function renderOverviewOplog() {
  var body = document.getElementById('overviewOplogTbody');
  if (!body) return;
  var recent = oplogData.slice(0, 5);
  body.innerHTML = recent.map(function(item) {
    return '<tr><td class="text-muted">' + item.time + '</td><td>' + item.operator + '</td><td>' + item.action + '</td><td>' + item.target + '<span class="text-muted"> · ' + item.result + '</span></td></tr>';
  }).join('');
}

export function openDistributeToMember(id){
  var m = membersData.find(function(x){ return x.id === id; });
  if (!m) return;
  var body='<div class="modal-field"><label class="modal-label">成员</label><div style="font-size:14px;font-weight:500;padding:8px 0;">'+m.name+'</div></div><div class="modal-field"><label class="modal-label">分发数量</label><input class="modal-input" id="dAmount" type="number" min="1" placeholder="请输入算力豆数量"></div><div class="modal-field"><label class="modal-label">备注（可选）</label><input class="modal-input" id="dNote" type="text" placeholder="备注说明"></div><input type="hidden" id="dMember" value="'+m.name+'">';
  var footer='<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button><button class="modal-btn modal-btn-primary" onclick="confirmDistribute()">确认分发</button>';
  openModal('分发算力豆给 '+m.name,body,footer);
}

export function openDistributeModal(){
  var opts = membersData.map(function(m) { return '<option value="'+m.name+'">'+m.name+'</option>'; }).join('');
  var body='<div class="modal-field"><label class="modal-label">选择成员</label><select class="modal-select" id="dMember">'+opts+'</select></div><div class="modal-field"><label class="modal-label">分发数量</label><input class="modal-input" id="dAmount" type="number" min="1" placeholder="请输入算力豆数量"></div><div class="modal-field"><label class="modal-label">备注（可选）</label><input class="modal-input" id="dNote" type="text" placeholder="备注说明"></div>';
  var footer='<button class="modal-btn modal-btn-cancel" onclick="closeModal()">取消</button><button class="modal-btn modal-btn-primary" onclick="confirmDistribute()">确认分发</button>';
  openModal('分发算力豆',body,footer);
}

export function confirmDistribute(){
  var member=document.getElementById('dMember').value;
  var amount=parseInt(document.getElementById('dAmount').value)||0;
  if(amount<=0){alert('请输入有效算力豆数量');return;}
  var wallet=getStatNum('statWallet');
  if(amount>wallet){alert('余额不足');return;}
  setStatNum('statWallet',wallet-amount);
  prependTransaction(getToday(),'分发','-'+amount.toLocaleString('en-US')+'算力豆',member,'成功');
  closeModal();
  showToast('✓ 成功分发 '+amount.toLocaleString('en-US')+' 算力豆给 '+member,'success');
}
