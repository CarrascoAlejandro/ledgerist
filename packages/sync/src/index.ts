export { SyncEngine } from './engine/SyncEngine.js';
export type {
  SyncEngineDeps,
  SyncSessionResult,
  SyncPhase,
  SyncProgressEvent,
} from './engine/SyncEngine.js';
export { MergeSession } from './engine/merge.js';
export type { MergeStats } from './engine/merge.js';
export {
  BATCH_SIZE,
  SYNC_TABLES,
  chunkRows,
  collectTableChanges,
  getMaxSeq,
  stampUnstampedRows,
  tableSpec,
} from './engine/collector.js';
export {
  buildCursorUpdateOp,
  getLocalDevice,
  getPeer,
  listPeers,
  setPeerStatus,
  updateAckedThroughSeq,
  upsertPeer,
} from './engine/peers.js';
export type { LocalDevice, SyncPeer } from './engine/peers.js';
export * from './protocol/messages.js';
export { CodecError, decodeMessage, encodeMessage } from './protocol/codec.js';
export type { PeerChannel, TransportClient, TransportServer } from './transport/types.js';
export { LoopbackChannel, createLoopbackPair } from './transport/loopback.js';
export {
  HandshakeError,
  MAX_FRAME_BYTES,
  SecureChannel,
  b64u,
  concatBytes,
  hkdfBits,
  hmacSign,
  hmacVerify,
  randomBytes,
  secureAccept,
  secureConnect,
  utf8,
} from './protocol/secureChannel.js';
export type { HandshakeErrorCode } from './protocol/secureChannel.js';
export {
  PAIRING_MAX_FAILURES,
  PAIRING_TTL_MS,
  createPairingOffer,
  derivePairingKey,
  encodePairingPayload,
  parsePairingPayload,
  runPairingHost,
  runPairingJoin,
} from './engine/pairing.js';
export type { PairingOffer, PairingPayload } from './engine/pairing.js';
export { createAcceptor, dialAndSync } from './engine/sessionRunner.js';
export type { RunnerDeps } from './engine/sessionRunner.js';
export {
  countUnseenConflicts,
  listConflicts,
  markConflictsSeen,
  renameDevice,
} from './engine/conflicts.js';
export type { ConflictKind, SyncConflict } from './engine/conflicts.js';
export { WsTransportClient } from './transport/wsClient.js';
export type { WebSocketCtor, WebSocketLike } from './transport/wsClient.js';
export { ElectronRelayServer, getElectronSyncAPI } from './transport/electronRelay.js';
export type { ElectronServerInfo, ElectronSyncAPI } from './transport/electronRelay.js';
