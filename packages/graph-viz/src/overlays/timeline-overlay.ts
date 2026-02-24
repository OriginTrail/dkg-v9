import type { TemporalFilter, TemporalConfig } from '../core/temporal-filter.js';

/**
 * DOM-based timeline overlay rendered inside the visualization container.
 *
 * Shows a single progressive slider: drag right to reveal more of the graph
 * chronologically. Includes play/pause, date labels, visible node count,
 * and a mini histogram showing node density over time.
 */
export class TimelineOverlay {
  private _container: HTMLElement;
  private _filter: TemporalFilter;
  private _config: TemporalConfig;

  // DOM elements
  private _root: HTMLElement | null = null;
  private _slider: HTMLInputElement | null = null;
  private _dateLabel: HTMLElement | null = null;
  private _countLabel: HTMLElement | null = null;
  private _playBtn: HTMLElement | null = null;
  private _histCanvas: HTMLCanvasElement | null = null;
  private _startLabel: HTMLElement | null = null;
  private _endLabel: HTMLElement | null = null;

  // State
  private _playInterval: ReturnType<typeof setInterval> | null = null;
  private _isPlaying = false;
  private _onChange: ((cursor: Date, visibleCount: number) => void) | null = null;

  constructor(
    container: HTMLElement,
    filter: TemporalFilter,
    config: TemporalConfig,
  ) {
    this._container = container;
    this._filter = filter;
    this._config = config;
  }

  /** Set callback for cursor changes */
  onChange(fn: (cursor: Date, visibleCount: number) => void): void {
    this._onChange = fn;
  }

  /** Build and attach the overlay DOM. Call after filter.scan(). */
  mount(): void {
    if (this._root) return; // already mounted

    const range = this._filter.dateRange;
    if (!range) return; // no dates found

    this._root = document.createElement('div');
    this._root.className = 'gv-timeline-overlay';
    this._root.innerHTML = this._buildHTML();
    this._injectStyles();
    this._container.appendChild(this._root);

    // Cache element refs
    this._slider = this._root.querySelector('.gv-tl-slider') as HTMLInputElement;
    this._dateLabel = this._root.querySelector('.gv-tl-date') as HTMLElement;
    this._countLabel = this._root.querySelector('.gv-tl-count') as HTMLElement;
    this._playBtn = this._root.querySelector('.gv-tl-play') as HTMLElement;
    this._histCanvas = this._root.querySelector('.gv-tl-hist') as HTMLCanvasElement;
    this._startLabel = this._root.querySelector('.gv-tl-start') as HTMLElement;
    this._endLabel = this._root.querySelector('.gv-tl-end') as HTMLElement;

    // Draw histogram
    this._drawHistogram();

    // Set initial slider position to max (show everything)
    this._slider.value = this._slider.max;
    this._updateDateLabel();

    // Event listeners
    this._slider.addEventListener('input', () => this._onSliderInput());
    this._playBtn?.addEventListener('click', () => this._togglePlay());
  }

  /** Remove the overlay from the DOM */
  unmount(): void {
    this.pause();
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
  }

  /** Whether the overlay is currently mounted */
  get mounted(): boolean {
    return this._root !== null;
  }

  /** Update the overlay after data changes (re-scan, redraw histogram) */
  refresh(): void {
    if (!this._root) return;
    const range = this._filter.dateRange;
    if (!range) {
      this.unmount();
      return;
    }

    // Update slider range
    if (this._slider) {
      this._slider.min = String(range[0].getTime());
      this._slider.max = String(range[1].getTime());
    }

    // Redraw histogram
    this._drawHistogram();

    // Update labels
    if (this._startLabel) this._startLabel.textContent = this._formatDateShort(range[0]);
    if (this._endLabel) this._endLabel.textContent = this._formatDateShort(range[1]);

    this._updateDateLabel();
  }

  /** Start auto-play from current position */
  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;
    if (this._playBtn) this._playBtn.textContent = '⏸';

    const range = this._filter.dateRange;
    if (!range || !this._slider) return;

    const totalRange = range[1].getTime() - range[0].getTime();
    const stepMs = this._getStepMs();
    const speed = this._config.playSpeed ?? 200;

    this._playInterval = setInterval(() => {
      const current = parseInt(this._slider!.value, 10);
      const next = current + stepMs;
      if (next >= range[1].getTime()) {
        this._slider!.value = String(range[1].getTime());
        this._onSliderInput();
        this.pause();
        return;
      }
      this._slider!.value = String(next);
      this._onSliderInput();
    }, speed);
  }

  /** Pause auto-play */
  pause(): void {
    this._isPlaying = false;
    if (this._playBtn) this._playBtn.textContent = '▶';
    if (this._playInterval) {
      clearInterval(this._playInterval);
      this._playInterval = null;
    }
  }

  /** Set the slider to a specific date programmatically */
  setCursor(date: Date): void {
    if (!this._slider) return;
    this._slider.value = String(date.getTime());
    this._onSliderInput();
  }

  // --- Private ---

  private _buildHTML(): string {
    const range = this._filter.dateRange!;
    const minMs = range[0].getTime();
    const maxMs = range[1].getTime();

    return `
      <div class="gv-tl-bar">
        <button class="gv-tl-play" title="Play/Pause timeline">▶</button>
        <div class="gv-tl-track">
          <div class="gv-tl-labels">
            <span class="gv-tl-start">${this._formatDateShort(range[0])}</span>
            <span class="gv-tl-date"></span>
            <span class="gv-tl-end">${this._formatDateShort(range[1])}</span>
          </div>
          <div class="gv-tl-slider-wrap">
            <canvas class="gv-tl-hist" width="600" height="32"></canvas>
            <input type="range" class="gv-tl-slider" min="${minMs}" max="${maxMs}" value="${maxMs}" step="1" />
          </div>
        </div>
        <div class="gv-tl-count" title="Visible nodes">—</div>
      </div>
    `;
  }

  private _onSliderInput(): void {
    if (!this._slider) return;
    const ms = parseInt(this._slider.value, 10);
    const date = new Date(ms);
    this._filter.setCursor(date);
    this._updateDateLabel();
    this._onChange?.(date, 0); // count will be set by the caller after re-render
  }

  private _updateDateLabel(): void {
    if (!this._dateLabel || !this._slider) return;
    const ms = parseInt(this._slider.value, 10);
    const date = new Date(ms);
    this._dateLabel.textContent = this._formatDateFull(date);
  }

  /** Update the visible count badge (called externally after render) */
  updateCount(count: number): void {
    if (this._countLabel) {
      this._countLabel.textContent = count.toLocaleString();
    }
  }

  private _togglePlay(): void {
    if (this._isPlaying) {
      this.pause();
    } else {
      // If at the end, reset to beginning
      if (this._slider && this._filter.dateRange) {
        const current = parseInt(this._slider.value, 10);
        if (current >= this._filter.dateRange[1].getTime() - this._getStepMs()) {
          this._slider.value = String(this._filter.dateRange[0].getTime());
          this._onSliderInput();
        }
      }
      this.play();
    }
  }

  private _getStepMs(): number {
    const step = this._config.stepSize ?? 'day';
    const range = this._filter.dateRange;
    if (!range) return 86400000;

    // Scale steps so that 100 steps covers the full range
    const totalRange = range[1].getTime() - range[0].getTime();
    const autoStep = totalRange / 200;

    switch (step) {
      case 'hour': return Math.max(3600000, autoStep);
      case 'day': return Math.max(86400000, autoStep);
      case 'week': return Math.max(604800000, autoStep);
      case 'month': return Math.max(2592000000, autoStep);
      default: return autoStep;
    }
  }

  private _drawHistogram(): void {
    const canvas = this._histCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const buckets = this._filter.computeHistogram(canvas.width / 4);
    if (buckets.length === 0) return;

    const maxCount = Math.max(...buckets.map(b => b.count));
    if (maxCount === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const barW = w / buckets.length;

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < buckets.length; i++) {
      const ratio = buckets[i].count / maxCount;
      const barH = ratio * (h - 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.fillRect(i * barW, h - barH, barW - 1, barH);
    }
  }

  private _formatDateShort(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  private _formatDateFull(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  private _styleId = 'gv-timeline-styles';

  private _injectStyles(): void {
    if (document.getElementById(this._styleId)) return;

    const style = document.createElement('style');
    style.id = this._styleId;
    style.textContent = `
      .gv-timeline-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 90;
        pointer-events: none;
      }
      .gv-tl-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px 12px;
        background: linear-gradient(to top,
          var(--gv-bg, rgba(10, 10, 15, 0.95)) 0%,
          var(--gv-bg, rgba(10, 10, 15, 0.85)) 60%,
          transparent 100%);
        pointer-events: auto;
      }
      .gv-tl-play {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid var(--gv-surface-border, rgba(100, 100, 140, 0.3));
        background: var(--gv-surface, rgba(20, 20, 30, 0.9));
        color: var(--gv-text, #e0e0e0);
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background 0.2s, border-color 0.2s;
        padding: 0;
        line-height: 1;
      }
      .gv-tl-play:hover {
        background: var(--gv-primary-muted, rgba(99, 102, 241, 0.3));
        border-color: var(--gv-primary, rgba(99, 102, 241, 0.5));
      }
      .gv-tl-track {
        flex: 1;
        min-width: 0;
        position: relative;
      }
      .gv-tl-labels {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--gv-text-muted, #666);
        margin-bottom: 2px;
        padding: 0 2px;
      }
      .gv-tl-date {
        font-weight: 600;
        color: var(--gv-text-secondary, #aaa);
        font-size: 11px;
      }
      .gv-tl-slider-wrap {
        position: relative;
        height: 32px;
      }
      .gv-tl-hist {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        opacity: 0.7;
      }
      .gv-tl-slider {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        cursor: pointer;
        z-index: 2;
      }
      .gv-tl-slider::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 2px;
        background: var(--gv-surface-border, rgba(100, 100, 140, 0.3));
        margin-top: 14px;
      }
      .gv-tl-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--gv-primary, #6366f1);
        border: 2px solid var(--gv-bg, #0a0a0f);
        margin-top: -6px;
        box-shadow: 0 0 8px var(--gv-primary-muted, rgba(99, 102, 241, 0.4));
        transition: transform 0.15s ease;
      }
      .gv-tl-slider::-webkit-slider-thumb:hover {
        transform: scale(1.2);
      }
      .gv-tl-slider::-moz-range-track {
        height: 4px;
        border-radius: 2px;
        background: var(--gv-surface-border, rgba(100, 100, 140, 0.3));
        border: none;
      }
      .gv-tl-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--gv-primary, #6366f1);
        border: 2px solid var(--gv-bg, #0a0a0f);
        box-shadow: 0 0 8px var(--gv-primary-muted, rgba(99, 102, 241, 0.4));
      }
      .gv-tl-count {
        min-width: 40px;
        padding: 4px 8px;
        border-radius: 12px;
        background: var(--gv-surface, rgba(20, 20, 30, 0.9));
        border: 1px solid var(--gv-surface-border, rgba(100, 100, 140, 0.3));
        color: var(--gv-primary, #6366f1);
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        flex-shrink: 0;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }
}
