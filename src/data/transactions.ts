import { pad2 } from './helpers'

export type TransactionRecord = {
  time: string
  member: string
  type: string
  desc: string
  change: number
  balance: number
  __optimistic?: boolean
}

export type OplogRecord = {
  time: string
  operator: string
  action: string
  target: string
  result: string
  __optimistic?: boolean
}

type RecordOptimisticHandlers = {
  onTransactionRecord?: ((item: TransactionRecord) => void) | null
  onOplogRecord?: ((item: OplogRecord) => void) | null
}

export let transactionData: TransactionRecord[] = []
export let oplogData: OplogRecord[] = []

var optimisticHandlers: RecordOptimisticHandlers = {}

function nowRecordTime() {
  var now = new Date()
  return pad2(now.getMonth() + 1) + '/' + pad2(now.getDate()) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes())
}

export function replaceTransactionData(items: TransactionRecord[]) {
  transactionData.length = 0
  items.forEach(function(item) { transactionData.push(item) })
}

export function replaceOplogData(items: OplogRecord[]) {
  oplogData.length = 0
  items.forEach(function(item) { oplogData.push(item) })
}

export function registerRecordOptimisticHandlers(handlers: RecordOptimisticHandlers) {
  optimisticHandlers = handlers || {}
}

export function addTransactionRecord(member, type, desc, change) {
  var latest = transactionData[0]
  var balance = latest ? latest.balance + change : change
  var item: TransactionRecord = {
    time: nowRecordTime(),
    member: member,
    type: type,
    desc: desc,
    change: change,
    balance: balance,
    __optimistic: true,
  }
  transactionData.unshift(item)
  if (optimisticHandlers.onTransactionRecord) optimisticHandlers.onTransactionRecord(item)
}

export function addOplogRecord(operator, action, target, result?) {
  var item: OplogRecord = {
    time: nowRecordTime(),
    operator: operator,
    action: action,
    target: target,
    result: result || '已完成',
    __optimistic: true,
  }
  oplogData.unshift(item)
  if (optimisticHandlers.onOplogRecord) optimisticHandlers.onOplogRecord(item)
}
