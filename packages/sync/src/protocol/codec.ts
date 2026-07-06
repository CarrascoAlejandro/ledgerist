import type { SyncMessage } from './messages.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CodecError extends Error {}

export function encodeMessage(msg: SyncMessage): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

export function decodeMessage(frame: Uint8Array): SyncMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(frame));
  } catch {
    throw new CodecError('Frame is not valid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== 'string'
  ) {
    throw new CodecError('Frame is not a protocol message');
  }
  return parsed as SyncMessage;
}
