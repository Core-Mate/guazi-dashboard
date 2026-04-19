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
