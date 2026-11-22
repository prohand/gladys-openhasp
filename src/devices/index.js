// -----------------------------------------------------------------------------
// The devices the integration publishes, and how a Gladys device maps back to
// a plate or a screen object.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { newPlate } from '../openhasp/hub.js';
import { PLATE_TYPE, buildPlateDevice, plateIds, setPlateValue } from './plate.js';
import { OBJECT_DEVICE_TYPE, buildObjectDevice, objectIds, setObjectValue } from './objects.js';

/**
 * Every device to show in the Discovery screen: the plates seen on the broker,
 * the plates the configured objects name (even before they show up), then the
 * configured objects.
 */
export function buildDiscoveredDevices(gladys, hub, config) {
  const plates = new Map(hub.list().map((plate) => [plate.name, plate]));
  for (const object of config.objectList) {
    if (!plates.has(object.plate)) {
      plates.set(object.plate, newPlate(object.plate));
    }
  }
  return [
    ...[...plates.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((plate) => buildPlateDevice(gladys, plate)),
    ...config.objectList.map((object) => buildObjectDevice(gladys, object)),
  ];
}

/**
 * What an external id (of a device or of a feature) designates.
 * @returns {{ kind: 'plate', plate: string, feature: string | null }
 *   | { kind: 'object', plate: string, object: string, feature: string | null }
 *   | null}
 */
export function resolveExternalId(gladys, externalId) {
  const prefix = gladys.externalId('');
  const text = String(externalId ?? '');
  if (!text.startsWith(prefix)) {
    return null;
  }
  const [type, platformId, feature = null] = text.slice(prefix.length).split(':');
  if (type === PLATE_TYPE && platformId) {
    return { kind: 'plate', plate: platformId, feature };
  }
  if (type === OBJECT_DEVICE_TYPE && platformId) {
    const dot = platformId.lastIndexOf('.');
    if (dot > 0) {
      return {
        kind: 'object',
        plate: platformId.slice(0, dot),
        object: platformId.slice(dot + 1),
        feature,
      };
    }
  }
  return null;
}

/**
 * The plate name behind a device chosen in a `source: "devices"` select: the
 * plate itself, or the plate of a screen object.
 */
export function plateNameOf(gladys, externalId) {
  return resolveExternalId(gladys, externalId)?.plate ?? null;
}

/** The configured object behind an external id, or `null`. */
export function findObject(gladys, config, externalId) {
  const target = resolveExternalId(gladys, externalId);
  if (target?.kind !== 'object') {
    return null;
  }
  return (
    config.objectList.find(
      (object) => object.plate === target.plate && object.object === target.object,
    ) ?? null
  );
}

/**
 * A command from Gladys (onSetValue).
 * @returns {Promise<{ state?: number, text?: string } | null>} the state to publish back
 */
export async function setValue(gladys, hub, config, device, feature, value) {
  const target = resolveExternalId(gladys, feature.external_id ?? device.external_id);
  if (target?.kind === 'plate') {
    return setPlateValue(hub, target.plate, target.feature, value);
  }
  const object = findObject(gladys, config, device.external_id);
  if (object) {
    return setObjectValue(hub, object, value);
  }
  throw new Error(`Unknown device ${device.external_id}: is it still in the objects setting?`);
}

/**
 * The transport badge of every device: `local` while its plate is online,
 * `unreachable` otherwise.
 */
export function buildTransportEntries(gladys, hub, config) {
  const transportOf = (plateName) =>
    hub.connected && hub.get(plateName)?.online
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.UNREACHABLE;
  const entries = buildDiscoveredDevices(gladys, hub, config).map((device) => ({
    external_id: device.external_id,
    transport: transportOf(plateNameOf(gladys, device.external_id)),
  }));
  return entries;
}

export { plateIds, objectIds };
