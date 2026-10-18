'use strict'
const net = require('net')

/**
 * 중복 실행 방지: 루프백(127.0.0.1)의 지정 포트를 점유한다.
 * 프로세스가 죽거나 PC 가 재부팅되면 OS 가 포트를 즉시 회수하므로 PID 파일 방식의 "오래된 잠금" 문제가 없다.
 * 외부에서 접속할 수 없는 루프백 전용이며, 들어온 연결은 즉시 닫는다(데이터 처리 없음).
 */
function acquireInstanceLock(port) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy())
    server.once('error', (err) => {
      resolve({ acquired: false, error: err.code || String(err) })
    })
    server.listen(port, '127.0.0.1', () => {
      resolve({
        acquired: true,
        release: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

module.exports = { acquireInstanceLock }
