import { getCurrentUser, type AuthUser } from './auth'

function getResolvedUser(user?: AuthUser | null): AuthUser | null {
  return typeof user === 'undefined' ? getCurrentUser() : (user || null)
}

function getDisplayName(user?: AuthUser | null): string {
  var target = getResolvedUser(user) as (AuthUser & { display_name?: string }) | null
  if (!target) return '成员'
  return String(target.display_name || target.name || target.phoneNumber || '成员').trim() || '成员'
}

function pruneMemberWriteEntrances() {
  if (document.body.getAttribute('data-readonly-member-pruned') === '1') return
  document.querySelectorAll('[data-readonly-prune="member"]').forEach(function(node) {
    node.remove()
  })
  document.body.setAttribute('data-readonly-member-pruned', '1')
}

export function isMemberReadOnly(user?: AuthUser | null): boolean {
  var target = getResolvedUser(user)
  return !!target && target.role === 'member'
}

export function syncMemberReadOnlyUI(user?: AuthUser | null) {
  var target = getResolvedUser(user)
  var banner = document.getElementById('readonlyBanner') as HTMLElement | null
  var nameEl = document.getElementById('readonlyBannerUser')

  if (target && target.role) document.body.setAttribute('data-user-role', target.role)
  else document.body.removeAttribute('data-user-role')

  if (nameEl) nameEl.textContent = getDisplayName(target)
  if (banner) {
    if (isMemberReadOnly(target)) banner.removeAttribute('hidden')
    else banner.setAttribute('hidden', '')
  }

  if (isMemberReadOnly(target)) pruneMemberWriteEntrances()
}
