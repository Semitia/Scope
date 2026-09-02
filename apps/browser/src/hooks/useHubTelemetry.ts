import { useMemo } from 'react';
import {
  useHubTelemetry as useSharedHubTelemetry,
  type TelemetryController,
} from '@debugscope/ui-core';

export { normalizeHubAddress } from '@debugscope/ui-core';

function defaultHubAddress(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.DEV ? `${window.location.hostname}:4713` : window.location.host;
  return `${protocol}//${host}/api/ws`;
}

export function useHubTelemetry(enabled: boolean): TelemetryController {
  const defaultAddress = useMemo(defaultHubAddress, []);
  return useSharedHubTelemetry({ enabled, defaultAddress });
}
