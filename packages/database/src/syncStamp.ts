import { getSyncContext } from '@ledger/shared';

// SQL fragments for stamping content mutations with the row's sync version.
// Interpolate the fragment and spread syncStamp() into params at the same
// position. Balance-only ledger updates and app_settings are NEVER stamped
// (docs/sync/DESIGN.md §2.3).
export const STAMP_SET = `version_hlc = ?, origin_device_id = ?`;
export const STAMP_COLS = `, version_hlc, origin_device_id`;
export const STAMP_VALS = `, ?, ?`;

export function syncStamp(): [versionHlc: string, originDeviceId: string] {
  const { hlc, deviceId } = getSyncContext();
  return [hlc.now(), deviceId];
}
