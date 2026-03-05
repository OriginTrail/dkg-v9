import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';

export interface InstalledApp {
  id: string;
  label: string;
  path: string;
  staticUrl?: string;
}

/**
 * Hosts a DKG app in an iframe.
 *
 * Sandbox permissions are conditional on the iframe origin:
 *
 * - **Cross-origin** (`staticUrl` present, different port): sandbox includes
 *   `allow-same-origin` — safe because it refers to the app's own origin,
 *   not the parent's. The app gets localStorage/sessionStorage on its
 *   own origin while remaining isolated from the parent.
 *
 * - **Same-origin fallback** (`staticUrl` absent): sandbox omits
 *   `allow-same-origin` to prevent the app from escaping the sandbox
 *   and accessing parent-origin data.
 *
 * Top-level navigation is always blocked (no `allow-top-navigation`).
 *
 * Token is passed via postMessage handshake (app requests it, we respond).
 */
export function AppHostPage({ apps }: { apps: InstalledApp[] }) {
  const { appId } = useParams<{ appId: string }>();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const app = apps.find(a => a.id === appId);

  const sendToken = useCallback(() => {
    const token = (window as any).__DKG_TOKEN__;
    if (token && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'dkg-token', token, apiOrigin: window.location.origin },
        '*',
      );
    }
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'dkg-token-request' && iframeRef.current?.contentWindow === e.source) {
        sendToken();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sendToken]);

  const isCrossOrigin = !!app?.staticUrl;
  const sandboxPolicy = useMemo(() => {
    const flags = ['allow-scripts', 'allow-forms', 'allow-popups'];
    if (isCrossOrigin) flags.push('allow-same-origin');
    return flags.join(' ');
  }, [isCrossOrigin]);

  if (!app) {
    return (
      <div style={{ padding: 32, color: '#aaa' }}>
        App <strong>{appId}</strong> is not installed.
      </div>
    );
  }

  const iframeSrc = app.staticUrl || `${app.path}/`;

  return (
    <iframe
      ref={iframeRef}
      src={iframeSrc}
      onLoad={sendToken}
      sandbox={sandboxPolicy}
      style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, background: '#111' }}
      title={app.label}
    />
  );
}
