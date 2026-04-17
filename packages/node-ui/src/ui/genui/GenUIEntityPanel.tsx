/**
 * Streams OpenUI Lang from the daemon's /api/genui/render endpoint and renders
 * the resulting component tree progressively using @openuidev/react-lang's
 * Renderer.
 *
 * Drop this in anywhere we show an entity detail — e.g. EntityDetail panel
 * in the LayerContent tabs. Falls back to a `fallback` prop if the LLM is
 * not configured on the daemon (`503`) or streaming errors out.
 */
import React from 'react';
import { Renderer } from '@openuidev/react-lang';
import { genuiLibrary, getGenuiLibraryPrompt } from './registry.js';
import { streamGenUI } from './streamGenUI.js';

export interface GenUIEntityPanelProps {
  contextGraphId: string;
  entityUri: string;
  /** Rendered while the first delta hasn't arrived yet. */
  placeholder?: React.ReactNode;
  /** Rendered when LLM not configured, 404, or the stream errors. */
  fallback?: (err: string) => React.ReactNode;
}

export const GenUIEntityPanel: React.FC<GenUIEntityPanelProps> = ({
  contextGraphId,
  entityUri,
  placeholder,
  fallback,
}) => {
  const [response, setResponse] = React.useState<string>('');
  const [isStreaming, setIsStreaming] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let accumulated = '';
    setResponse('');
    setError(null);
    setIsStreaming(true);

    (async () => {
      try {
        const libraryPrompt = getGenuiLibraryPrompt();
        for await (const ev of streamGenUI({
          contextGraphId,
          entityUri,
          libraryPrompt,
          signal: controller.signal,
        })) {
          if (ev.type === 'delta') {
            accumulated += ev.text;
            setResponse(accumulated);
          } else if (ev.type === 'final') {
            if (ev.content) {
              accumulated = ev.content;
              setResponse(ev.content);
            }
          } else if (ev.type === 'error') {
            setError(ev.error);
            break;
          } else if (ev.type === 'done') {
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message);
        }
      } finally {
        setIsStreaming(false);
      }
    })();

    return () => controller.abort();
  }, [contextGraphId, entityUri]);

  if (error) {
    return <>{fallback ? fallback(error) : <div className="v10-genui-error">GenUI unavailable: {error}</div>}</>;
  }

  if (!response && isStreaming) {
    return <>{placeholder ?? <div className="v10-genui-loading">Composing detail view…</div>}</>;
  }

  return (
    <div className="v10-genui-panel">
      <Renderer
        response={response}
        library={genuiLibrary}
        isStreaming={isStreaming}
      />
    </div>
  );
};
