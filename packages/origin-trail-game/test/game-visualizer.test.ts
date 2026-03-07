import { describe, it, expect } from 'vitest';
import { gameEngine } from '../src/engine/game-engine.js';
import {
  createSwarm,
  joinSwarm,
  startExpedition,
  castVote,
  forceResolveTurn,
} from '../src/engine/wagon-train.js';

let seq = 0;
function uid(prefix = 'p') {
  return `${prefix}-gv-${++seq}-${Date.now()}`;
}

describe('default max players is 3', () => {
  it('createSwarm defaults maxPlayers to 3', () => {
    const leader = uid('leader');
    const swarm = createSwarm(leader, 'Leader', `Default-${seq}`);
    expect(swarm.maxPlayers).toBe(3);
  });

  it('createSwarm respects explicit maxPlayers', () => {
    const leader = uid('leader');
    const swarm = createSwarm(leader, 'Leader', `Explicit-${seq}`, 5);
    expect(swarm.maxPlayers).toBe(5);
  });

  it('maxPlayers is clamped between MIN_PLAYERS and MAX_PLAYERS', () => {
    const leader1 = uid('leader');
    const tooLow = createSwarm(leader1, 'Leader', `Low-${seq}`, 1);
    expect(tooLow.maxPlayers).toBe(3);

    const leader2 = uid('leader');
    const tooHigh = createSwarm(leader2, 'Leader', `High-${seq}`, 20);
    expect(tooHigh.maxPlayers).toBe(8);
  });
});

describe('force resolve uses syncMemory as default action (not rest)', () => {
  it('force-resolve with no votes should produce valid game state', () => {
    const leader = uid('leader');
    const p2 = uid('p2');
    const p3 = uid('p3');
    const swarm = createSwarm(leader, 'Leader', `Resolve-${seq}`);
    joinSwarm(swarm.id, p2, 'P2');
    joinSwarm(swarm.id, p3, 'P3');
    startExpedition(swarm.id, leader);

    const result = forceResolveTurn(swarm.id, leader);
    expect(result.currentTurn).toBe(2);
    expect(result.turnHistory.length).toBe(1);
    const turnAction = result.turnHistory[0].winningAction;
    expect(turnAction).not.toBe('rest');
  });
});

describe('game engine action coverage', () => {
  it('syncMemory is a valid action that heals party members', () => {
    const gs = gameEngine.createGame(['Agent-A', 'Agent-B']);
    gs.party[0].health = 50;
    const result = gameEngine.executeAction(gs, { type: 'syncMemory' });
    expect(result.success).toBe(true);
    const healed = result.newState.party[0];
    expect(healed.health).toBeGreaterThan(50);
  });

  it('rest is not a valid action type', () => {
    const gs = gameEngine.createGame(['Agent-A']);
    const result = gameEngine.executeAction(gs, { type: 'rest' as any });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown action');
  });
});

describe('buildGameTriples produces valid triple structure', () => {
  function buildGameTriples(swarm: any) {
    type Triple = { subject: string; predicate: string; object: string };
    const triples: Triple[] = [];
    const history: any[] = swarm.turnHistory ?? [];
    const gs = swarm.gameState;
    if (!gs) return triples;

    const swarmNode = `game:${swarm.name ?? 'Swarm'}`;
    triples.push({ subject: swarmNode, predicate: 'rdf:type', object: 'game:Swarm' });
    triples.push({ subject: swarmNode, predicate: 'game:status', object: `status:${gs.status}` });
    triples.push({ subject: swarmNode, predicate: 'game:epochs', object: `"${gs.epochs}/2000"` });

    if (gs.party) {
      for (const m of gs.party) {
        const memberNode = `agent:${m.name}`;
        triples.push({ subject: swarmNode, predicate: 'game:hasMember', object: memberNode });
        triples.push({ subject: memberNode, predicate: 'rdf:type', object: m.alive ? 'game:Agent' : 'game:DeadAgent' });
        triples.push({ subject: memberNode, predicate: 'game:health', object: `"${m.health} HP"` });
      }
    }

    let prevTurnNode: string | null = null;
    for (const turn of history) {
      const turnNode = `turn:${turn.turn}`;
      triples.push({ subject: turnNode, predicate: 'rdf:type', object: 'game:Turn' });
      const actionNode = `action:${turn.winningAction}`;
      triples.push({ subject: turnNode, predicate: 'game:action', object: actionNode });
      triples.push({ subject: actionNode, predicate: 'rdf:type', object: 'game:Action' });
      if (turn.resultMessage) {
        const resultNode = `result:T${turn.turn}`;
        triples.push({ subject: turnNode, predicate: 'game:result', object: resultNode });
        triples.push({ subject: resultNode, predicate: 'rdfs:label', object: `"${turn.resultMessage}"` });
      }
      if (turn.approvers?.length) {
        for (const a of turn.approvers) {
          const short = typeof a === 'string' ? a.slice(-8) : String(a);
          triples.push({ subject: turnNode, predicate: 'game:approvedBy', object: `peer:${short}` });
        }
      }
      if (prevTurnNode) {
        triples.push({ subject: prevTurnNode, predicate: 'game:nextTurn', object: turnNode });
      }
      prevTurnNode = turnNode;
    }

    if (prevTurnNode) {
      triples.push({ subject: swarmNode, predicate: 'game:currentTurn', object: prevTurnNode });
    }

    const resourceNode = 'resources:Current';
    triples.push({ subject: swarmNode, predicate: 'game:resources', object: resourceNode });
    triples.push({ subject: resourceNode, predicate: 'rdf:type', object: 'game:Resources' });
    triples.push({ subject: resourceNode, predicate: 'game:tokens', object: `"${gs.trainingTokens}"` });
    triples.push({ subject: resourceNode, predicate: 'game:apiCredits', object: `"${gs.apiCredits}"` });
    triples.push({ subject: resourceNode, predicate: 'game:gpus', object: `"${gs.computeUnits}"` });
    triples.push({ subject: resourceNode, predicate: 'game:trac', object: `"${gs.trac}"` });

    return triples;
  }

  it('returns empty array when no gameState', () => {
    expect(buildGameTriples({ name: 'Test' })).toEqual([]);
  });

  it('generates swarm type + members + resources for initial state', () => {
    const gs = gameEngine.createGame(['Alpha', 'Beta']);
    const triples = buildGameTriples({
      name: 'TestSwarm',
      gameState: gs,
      turnHistory: [],
    });

    const types = triples.filter(t => t.predicate === 'rdf:type');
    expect(types.some(t => t.object === 'game:Swarm')).toBe(true);
    expect(types.some(t => t.object === 'game:Agent')).toBe(true);
    expect(types.some(t => t.object === 'game:Resources')).toBe(true);

    const members = triples.filter(t => t.predicate === 'game:hasMember');
    expect(members.length).toBe(2);
  });

  it('generates turn nodes with linked actions for each history entry', () => {
    const triples = buildGameTriples({
      name: 'TurnTest',
      gameState: gameEngine.createGame(['A']),
      turnHistory: [
        { turn: 1, winningAction: 'advance', resultMessage: 'Advanced 16 epochs.', approvers: ['peer-abc123'] },
        { turn: 2, winningAction: 'syncMemory', resultMessage: 'Synced memory.', approvers: [] },
      ],
    });

    const turnTypes = triples.filter(t => t.predicate === 'rdf:type' && t.object === 'game:Turn');
    expect(turnTypes.length).toBe(2);

    const nextTurnLinks = triples.filter(t => t.predicate === 'game:nextTurn');
    expect(nextTurnLinks.length).toBe(1);
    expect(nextTurnLinks[0].subject).toBe('turn:1');
    expect(nextTurnLinks[0].object).toBe('turn:2');

    const actionLinks = triples.filter(t => t.predicate === 'game:action');
    expect(actionLinks.length).toBe(2);

    const approvers = triples.filter(t => t.predicate === 'game:approvedBy');
    expect(approvers.length).toBe(1);
  });

  it('marks dead party members as DeadAgent', () => {
    const gs = gameEngine.createGame(['Alive', 'Dead']);
    gs.party[1].alive = false;
    gs.party[1].health = 0;

    const triples = buildGameTriples({
      name: 'DeathTest',
      gameState: gs,
      turnHistory: [],
    });

    const deadType = triples.find(t => t.subject === 'agent:Dead' && t.predicate === 'rdf:type');
    expect(deadType?.object).toBe('game:DeadAgent');

    const aliveType = triples.find(t => t.subject === 'agent:Alive' && t.predicate === 'rdf:type');
    expect(aliveType?.object).toBe('game:Agent');
  });
});
