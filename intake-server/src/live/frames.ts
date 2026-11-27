import WebSocket from 'ws'
import { validate, type LiveFrameDto } from '@invimport/contracts'

type Peer = Pick<WebSocket, 'readyState' | 'bufferedAmount' | 'send' | 'terminate'>
const MAX_BUFFERED_BYTES = 64 * 1024

export function sendLiveFrame(socket: Peer, frame: LiveFrameDto): boolean {
  validate('LiveFrame', frame)
  if (socket.readyState !== WebSocket.OPEN) {
    return false
  }
  const bytes = JSON.stringify(frame)
  if (socket.bufferedAmount + Buffer.byteLength(bytes) > MAX_BUFFERED_BYTES) {
    socket.terminate()
    return false
  }
  socket.send(bytes)
  return true
}
