import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { TimelineEvent, OperationType } from '../types';
import { OP_COLORS } from '../types';

interface Props {
  events: TimelineEvent[];
  playbackTs: number | null;
  onSeek: (ts: number | null) => void;
}

export function TimelineSlider({ events, playbackTs, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number>(0);
  const speedRef = useRef(1);

  const { minTs, maxTs, span } = useMemo(() => {
    if (events.length === 0) return { minTs: 0, maxTs: 0, span: 1 };
    const min = events[0].ts;
    const max = events[events.length - 1].ts;
    return { minTs: min, maxTs: max, span: Math.max(max - min, 1) };
  }, [events]);

  const pct = playbackTs != null ? ((playbackTs - minTs) / span) * 100 : 100;

  const seekFromMouse = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || events.length === 0) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(minTs + ratio * span);
    },
    [events, minTs, span, onSeek],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setPlaying(false);
      seekFromMouse(e.clientX);

      const onMove = (ev: MouseEvent) => seekFromMouse(ev.clientX);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [seekFromMouse],
  );

  useEffect(() => {
    if (!playing || events.length === 0) return;
    let last = performance.now();
    const startTs = playbackTs ?? minTs;
    let currentTs = startTs;

    const tick = () => {
      const now = performance.now();
      const dt = (now - last) * speedRef.current;
      last = now;
      currentTs = Math.min(currentTs + dt, maxTs);
      onSeek(currentTs);
      if (currentTs >= maxTs) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, events.length, minTs, maxTs]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
    } else {
      if (playbackTs != null && playbackTs >= maxTs) {
        onSeek(minTs);
      }
      setPlaying(true);
    }
  }, [playing, playbackTs, maxTs, minTs, onSeek]);

  const exitReplay = useCallback(() => {
    setPlaying(false);
    onSeek(null);
  }, [onSeek]);

  const visibleEvents = useMemo(() => {
    if (events.length === 0) return [];
    const step = Math.max(1, Math.floor(events.length / 300));
    return events.filter((_, i) => i % step === 0);
  }, [events]);

  const currentEvent = useMemo(() => {
    if (playbackTs == null || events.length === 0) return null;
    let best: TimelineEvent | null = null;
    for (const e of events) {
      if (e.ts <= playbackTs) best = e;
      else break;
    }
    return best;
  }, [playbackTs, events]);

  if (events.length === 0) {
    return (
      <div className="timeline-slider">
        <div className="timeline-empty">Perform operations to populate the timeline</div>
      </div>
    );
  }

  return (
    <div className="timeline-slider">
      <div className="timeline-controls">
        <button className="timeline-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
          {playing ? '\u275A\u275A' : '\u25B6'}
        </button>
        <button
          className="timeline-btn"
          onClick={() => { speedRef.current = speedRef.current >= 4 ? 0.5 : speedRef.current * 2; }}
          title="Playback speed"
        >
          {speedRef.current}x
        </button>
        {playbackTs != null && (
          <button className="timeline-btn timeline-btn-exit" onClick={exitReplay} title="Exit replay">
            LIVE
          </button>
        )}
        {currentEvent && (
          <span className="timeline-current-event">
            <span
              className="timeline-dot"
              style={{ background: OP_COLORS[currentEvent.opType] || '#fff' }}
            />
            N{currentEvent.nodeId} &middot; {currentEvent.phase} &middot; {currentEvent.label}
          </span>
        )}
        <span className="timeline-time">
          {playbackTs != null
            ? `${((playbackTs - minTs) / 1000).toFixed(1)}s / ${(span / 1000).toFixed(1)}s`
            : `${(span / 1000).toFixed(1)}s recorded`}
        </span>
      </div>

      <div className="timeline-track" ref={trackRef} onMouseDown={onMouseDown}>
        <div className="timeline-fill" style={{ width: `${pct}%` }} />
        {visibleEvents.map((ev) => {
          const left = ((ev.ts - minTs) / span) * 100;
          return (
            <div
              key={ev.id}
              className="timeline-marker"
              style={{
                left: `${left}%`,
                background: OP_COLORS[ev.opType as OperationType] || '#666',
              }}
              title={`${ev.phase}: ${ev.label}`}
            />
          );
        })}
        <div className="timeline-thumb" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}
