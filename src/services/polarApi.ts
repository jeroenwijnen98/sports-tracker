import { config } from '../config.ts';
import type { XmlType } from './xmlCache.ts';

const API = config.polar.apiBase;

/** Accept header for each kind of exercise XML Polar serves. */
export const XML_ACCEPT: Record<XmlType, string> = {
  tcx: 'application/vnd.garmin.tcx+xml',
  gpx: 'application/gpx+xml',
};

export interface PolarRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  accept?: string;
  /** Sent as JSON. */
  body?: unknown;
}

/**
 * Every AccessLink request goes through here. `url` is a path under the API
 * base (`/exercises`) or a full URL, such as a transaction's resource-uri.
 * Resolves to the Response, so the caller picks .json() or .text(); a non-2xx
 * status throws.
 */
export async function polarRequest(
  accessToken: string,
  url: string,
  { method = 'GET', accept = 'application/json', body }: PolarRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: accept };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url.startsWith('/') ? `${API}${url}` : url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Polar API error: ${res.status} ${text}`);
  }

  return res;
}

/** `polarRequest` with `accessToken` bound, the `request` the sync takes. */
export function withToken(accessToken: string) {
  return (url: string, options?: PolarRequestOptions) => polarRequest(accessToken, url, options);
}
