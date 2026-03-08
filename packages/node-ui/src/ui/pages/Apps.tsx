import React, { useEffect, useRef, useCallback } from 'react';

const TRUSTED_APP_PATH = '/apps/origin-trail-game/';

/**
 * Renders the OriginTrail Game inside the Node Dashboard by embedding
 * its standalone UI in an iframe.
 *
 * Token handoff uses a nonce handshake: on iframe load the parent checks
 * that the iframe is still on the trusted app path, issues a random nonce,
 * and waits for the iframe to echo it back. Only matching nonces receive
 * the token. Re-auth is allowed on legitimate reloads of the trusted app
 * (the nonce changes each time so replayed requests are rejected).
 *
 * Security note: `allow-same-origin` is required because the app makes
 * fetch() calls to the node API on the same origin. The apps are
 * operator-installed trusted code served from loopback. The nonce
 * handshake provides defence-in-depth for token delivery.
 */
export function AppsPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonceRef = useRef<string | null>(null);

  const isTrustedOrigin = useCallback(() => {
    try {
      const loc = iframeRef.current?.contentWindow?.location;
      return loc?.pathname?.startsWith(TRUSTED_APP_PATH) ?? false;
    } catch { return false; }
  }, []);

  const sendNonce = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;
    if (!isTrustedOrigin()) return;
    const nonce = crypto.randomUUID();
    nonceRef.current = nonce;
    iframeRef.current.contentWindow.postMessage({ type: 'dkg-nonce', nonce }, '*');
  }, [isTrustedOrigin]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === 'dkg-token-request' &&
        iframeRef.current?.contentWindow === e.source &&
        typeof e.data.nonce === 'string' &&
        e.data.nonce === nonceRef.current
      ) {
        nonceRef.current = null;
        const token = (window as any).__DKG_TOKEN__;
        if (token && isTrustedOrigin()) {
          iframeRef.current.contentWindow!.postMessage(
            { type: 'dkg-token', token, apiOrigin: window.location.origin },
            '*',
          );
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isTrustedOrigin]);

  return (
    <iframe
      ref={iframeRef}
      src={TRUSTED_APP_PATH}
      onLoad={sendNonce}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      allow="clipboard-write"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        borderRadius: 8,
        background: '#111',
      }}
      title="OriginTrail Game"
    />
  );
}
