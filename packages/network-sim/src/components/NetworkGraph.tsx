import { useRef, useEffect, useCallback } from 'react';
import type { DevnetNode, GraphAnimation, OperationType, NodeLabel } from '../types';
import { OP_COLORS } from '../types';

export const CHAIN_NODE_ID = 0;

interface Props {
  nodes: DevnetNode[];
  animations: GraphAnimation[];
  selectedNode: number;
  onSelectNode: (id: number) => void;
  nodeLabels?: NodeLabel[];
}

interface NodePos {
  x: number;
  y: number;
}

const NODE_RADIUS = 22;
const GLOW_RADIUS = 36;
const PARTICLE_RADIUS = 6;
const PARTICLE_GLOW = 18;
const CHAIN_SIZE = 28;

function getNodePositions(nodes: DevnetNode[], cx: number, cy: number, radius: number): NodePos[] {
  const positions = nodes.map((_, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
  positions.push({ x: cx, y: cy });
  return positions;
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.04)';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawConnection(
  ctx: CanvasRenderingContext2D,
  from: NodePos,
  to: NodePos,
  active: boolean,
) {
  ctx.save();
  ctx.strokeStyle = active ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.08)';
  ctx.lineWidth = active ? 1.5 : 1;
  ctx.setLineDash(active ? [] : [4, 4]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawChainConnection(
  ctx: CanvasRenderingContext2D,
  from: NodePos,
  to: NodePos,
  active: boolean,
) {
  ctx.save();
  ctx.strokeStyle = active ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.06)';
  ctx.lineWidth = active ? 1.5 : 0.8;
  ctx.setLineDash(active ? [6, 3] : [3, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  pos: NodePos,
  node: DevnetNode,
  isSelected: boolean,
  _dpr: number,
) {
  ctx.save();

  if (isSelected) {
    const glow = ctx.createRadialGradient(pos.x, pos.y, NODE_RADIUS, pos.x, pos.y, GLOW_RADIUS);
    glow.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, GLOW_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? '#1e1b4b' : '#0f0f23';
  ctx.fill();
  ctx.strokeStyle = node.online
    ? isSelected
      ? '#818cf8'
      : '#4f46e5'
    : '#374151';
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.stroke();

  const statusColor = node.online ? '#10b981' : '#ef4444';
  ctx.beginPath();
  ctx.arc(pos.x + 15, pos.y - 15, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = statusColor;
  ctx.fill();
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (node.online) {
    const pulse = ctx.createRadialGradient(pos.x + 15, pos.y - 15, 4, pos.x + 15, pos.y - 15, 10);
    pulse.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
    pulse.addColorStop(1, 'transparent');
    ctx.fillStyle = pulse;
    ctx.beginPath();
    ctx.arc(pos.x + 15, pos.y - 15, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = node.online ? '#e2e8f0' : '#64748b';
  ctx.fillText(`N${node.id}`, pos.x, pos.y);

  ctx.font = '500 10px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(node.name.replace('devnet-', ''), pos.x, pos.y + NODE_RADIUS + 14);

  const roleLabel = node.nodeRole === 'core' ? 'RELAY' : 'EDGE';
  ctx.font = '600 8px JetBrains Mono, monospace';
  ctx.fillStyle = node.nodeRole === 'core' ? '#818cf8' : '#64748b';
  ctx.fillText(roleLabel, pos.x, pos.y + NODE_RADIUS + 26);

  if (node.online && node.status) {
    ctx.font = '500 9px JetBrains Mono, monospace';
    ctx.fillStyle = '#6366f1';
    const idLabel = node.status.hasIdentity ? `ID${node.status.identityId}` : 'no-id';
    ctx.fillText(`${node.status.connectedPeers}p · ${idLabel}`, pos.x, pos.y + NODE_RADIUS + 38);
  }

  ctx.restore();
}

let chainPulsePhase = 0;

function drawBlockchain(ctx: CanvasRenderingContext2D, pos: NodePos, active: boolean) {
  ctx.save();

  chainPulsePhase = (chainPulsePhase + 0.015) % (Math.PI * 2);
  const breathe = 1 + Math.sin(chainPulsePhase) * 0.04;
  const s = CHAIN_SIZE * breathe;

  if (active) {
    const glow = ctx.createRadialGradient(pos.x, pos.y, s, pos.x, pos.y, s + 20);
    glow.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, s + 20, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(pos.x, pos.y);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.roundRect(-s / 2, -s / 2, s, s, 4);
  ctx.fillStyle = active ? '#1a1508' : '#0f0f1a';
  ctx.fill();
  ctx.strokeStyle = active ? '#f59e0b' : '#78650e';
  ctx.lineWidth = active ? 2 : 1.2;
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const dpr = window.devicePixelRatio || 1;
  ctx.scale(dpr, dpr);
  const sx = pos.x / 1;
  const sy = pos.y / 1;

  ctx.restore();
  ctx.save();

  ctx.font = '700 7px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = active ? '#f59e0b' : '#a08520';
  ctx.fillText('⬡', pos.x, pos.y - 1);

  ctx.font = '600 8px JetBrains Mono, monospace';
  ctx.fillStyle = '#f59e0b';
  ctx.fillText('CHAIN', pos.x, pos.y + CHAIN_SIZE + 8);

  ctx.font = '500 7px JetBrains Mono, monospace';
  ctx.fillStyle = '#78650e';
  ctx.fillText('EVM 31337', pos.x, pos.y + CHAIN_SIZE + 18);

  ctx.restore();
}

function drawParticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: OperationType,
) {
  const color = OP_COLORS[type] || '#ffffff';
  ctx.save();

  const glow = ctx.createRadialGradient(x, y, 0, x, y, PARTICLE_GLOW);
  glow.addColorStop(0, color + 'aa');
  glow.addColorStop(0.4, color + '44');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, PARTICLE_GLOW, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, PARTICLE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPulse(
  ctx: CanvasRenderingContext2D,
  pos: NodePos,
  type: OperationType,
  progress: number,
) {
  const color = OP_COLORS[type] || '#ffffff';
  const r = NODE_RADIUS + progress * 40;
  const alpha = 1 - progress;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha * 0.6;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawNodeLabels(
  ctx: CanvasRenderingContext2D,
  pos: NodePos,
  labels: NodeLabel[],
  cx: number,
  isChain?: boolean,
) {
  if (labels.length === 0) return;
  ctx.save();

  const isLeft = isChain ? false : pos.x < cx;
  const xOff = isChain ? 0 : isLeft ? -(NODE_RADIUS + 14) : NODE_RADIUS + 14;
  const yBase = isChain ? pos.y + CHAIN_SIZE + 28 : pos.y - 14;
  ctx.textAlign = isChain ? 'center' : isLeft ? 'right' : 'left';
  ctx.textBaseline = 'middle';

  const visible = labels.slice(-5);
  const now = Date.now();
  visible.forEach((label, i) => {
    const age = now - label.ts;
    const fadeStart = label.fadeAfterMs * 0.6;
    const fade = age < fadeStart ? 1 : Math.max(0, 1 - (age - fadeStart) / (label.fadeAfterMs - fadeStart));
    const y = yBase + i * 15;

    ctx.globalAlpha = fade * 0.95;

    ctx.font = '600 9px JetBrains Mono, monospace';
    const textWidth = ctx.measureText(label.text).width + 16;
    ctx.fillStyle = 'rgba(10, 10, 26, 0.75)';
    if (isChain) {
      ctx.fillRect(pos.x - textWidth / 2, y - 7, textWidth, 14);
    } else {
      const bx = isLeft ? pos.x + xOff - textWidth : pos.x + xOff - 4;
      ctx.fillRect(bx, y - 7, textWidth + 8, 14);
    }

    ctx.fillStyle = label.color;
    const arrow = isChain ? '' : isLeft ? ' \u25C0' : '\u25B6 ';
    const text = isChain ? label.text : isLeft ? label.text + arrow : arrow + label.text;
    ctx.fillText(text, pos.x + xOff, y);
  });

  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const entries: [string, string][] = [
    ['Publish', OP_COLORS.publish],
    ['Workspace', OP_COLORS.workspace],
    ['CtxGraph', OP_COLORS.contextGraph],
    ['Query', OP_COLORS.query],
    ['Chat', OP_COLORS.chat],
    ['Chain Tx', '#f59e0b'],
  ];

  const padding = 12;
  const lineH = 18;
  const boxW = 100;
  const boxH = padding * 2 + entries.length * lineH;
  const x = w - boxW - 16;
  const y = h - boxH - 16;

  ctx.save();
  ctx.fillStyle = 'rgba(10, 10, 26, 0.85)';
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.font = '500 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  entries.forEach(([label, color], i) => {
    const ly = y + padding + i * lineH + lineH / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + padding + 4, ly, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(label, x + padding + 14, ly);
  });

  ctx.restore();
}

export function NetworkGraph({ nodes, animations, selectedNode, onSelectNode, nodeLabels = [] }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeLabelsRef = useRef(nodeLabels);
  nodeLabelsRef.current = nodeLabels;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cx = w / 2;
    const cy = h / 2;
    const graphRadius = Math.min(cx, cy) * 0.55;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    drawGrid(ctx, w, h);

    // positions[0..n-1] = nodes, positions[n] = chain center
    const positions = getNodePositions(nodes, cx, cy, graphRadius);
    const chainIdx = nodes.length;
    const chainPos = positions[chainIdx];

    const activeEdges = new Set<string>();
    let chainActive = false;
    for (const anim of animations) {
      if (anim.from === chainIdx || anim.to === chainIdx) {
        chainActive = true;
      }
      if (anim.from !== anim.to) {
        const key = [Math.min(anim.from, anim.to), Math.max(anim.from, anim.to)].join('-');
        activeEdges.add(key);
      }
    }

    // Draw node-to-node connections
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const key = `${i}-${j}`;
        drawConnection(ctx, positions[i], positions[j], activeEdges.has(key));
      }
    }

    // Draw node-to-chain connections
    for (let i = 0; i < nodes.length; i++) {
      const key1 = `${Math.min(i, chainIdx)}-${Math.max(i, chainIdx)}`;
      drawChainConnection(ctx, positions[i], chainPos, activeEdges.has(key1));
    }

    // Draw blockchain square
    drawBlockchain(ctx, chainPos, chainActive);

    // Draw animations
    for (const anim of animations) {
      if (anim.progress < 0) continue;
      if (anim.from === anim.to) {
        const p = anim.from < positions.length ? positions[anim.from] : chainPos;
        drawPulse(ctx, p, anim.type, anim.progress);
      } else {
        const from = positions[anim.from];
        const to = positions[anim.to];
        if (from && to) {
          const ease = anim.progress < 0.5
            ? 2 * anim.progress * anim.progress
            : 1 - Math.pow(-2 * anim.progress + 2, 2) / 2;
          const x = from.x + (to.x - from.x) * ease;
          const y = from.y + (to.y - from.y) * ease;
          drawParticle(ctx, x, y, anim.type);
        }
      }
    }

    // Draw nodes
    for (let i = 0; i < nodes.length; i++) {
      drawNode(ctx, positions[i], nodes[i], nodes[i].id === selectedNode, dpr);
    }

    // Draw node labels
    const labels = nodeLabelsRef.current;
    for (let i = 0; i < nodes.length; i++) {
      const forNode = labels.filter((l) => l.nodeId === nodes[i].id);
      if (forNode.length > 0) {
        drawNodeLabels(ctx, positions[i], forNode, cx);
      }
    }

    // Draw chain labels
    const chainLabels = labels.filter((l) => l.nodeId === CHAIN_NODE_ID);
    if (chainLabels.length > 0) {
      drawNodeLabels(ctx, chainPos, chainLabels, cx, true);
    }

    drawLegend(ctx, w, h);
    ctx.restore();
  }, [nodes, animations, selectedNode]);

  useEffect(() => {
    let raf: number;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;
      const graphRadius = Math.min(cx, cy) * 0.55;
      const positions = getNodePositions(nodes, cx, cy, graphRadius);

      for (let i = 0; i < nodes.length; i++) {
        const dx = mx - positions[i].x;
        const dy = my - positions[i].y;
        if (Math.sqrt(dx * dx + dy * dy) < NODE_RADIUS + 8) {
          onSelectNode(nodes[i].id);
          return;
        }
      }
    },
    [nodes, onSelectNode],
  );

  return (
    <div ref={containerRef} className="network-graph">
      <canvas ref={canvasRef} onClick={handleClick} style={{ cursor: 'pointer' }} />
    </div>
  );
}
