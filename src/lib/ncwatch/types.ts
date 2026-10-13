// NCWatch 수신 API 공유 타입

export type MachineStatusPayload = {
  machineName:  string
  statusCode?:  number | null
  statusLabel?: string | null
  runCode?:     number | null
  modeCode?:    number | null
  messageCode?: number | null
  programName?: string | null
  oNumber?:     string | null
  spindleSpeed?: number | null
  feedRate?:    number | null
  positionX?:   number | null
  positionY?:   number | null
  positionZ?:   number | null
  toolNo?:      string | null
  partCount?:   number | null
  blockNumber?: number | null
  blockTot?:    number | null
  ratio?:       number | null
  alarmCode?:   string | null
  alarmMessage?: string | null
  aliveCount?:  number | null
  ncwatchTs?:   string | null
}

export type MachineReportPayload = {
  machineName: string
  reportDate:  string       // "YYYY-MM-DD"
  runTime?:    string | null
  runPct?:     number | null
  partCount?:  number | null
  stopTime?:   string | null
  stopPct?:    number | null
  manualPct?:  number | null
  alarmPct?:   number | null
  offlinePct?: number | null
  manualTime?: string | null
  alarmTime?:  string | null
  offlineTime?: string | null
}

export type MachineResult = {
  machineName: string
  result:      "OK" | "UNMAPPED" | "ERROR"
  equipmentId: string | null
  message?:    string
}
