import { describe, it, expect, vi } from 'vitest';
import { handleTrackItem, EpcisQueryError } from '../src/handlers.js';
import type { QueryEngine } from '../src/types.js';

const PARANET_ID = 'test-paranet';

function mockQueryEngine(bindings: Record<string, string>[] = []): QueryEngine {
  return {
    query: vi.fn().mockResolvedValue({ bindings }),
  };
}

function makeBinding(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    event: 'urn:uuid:event-1',
    eventType: 'https://gs1.github.io/EPCIS/ObjectEvent',
    eventTime: '2024-03-01T08:00:00.000Z',
    bizStep: 'https://ref.gs1.org/cbv/BizStep-receiving',
    bizLocation: 'urn:epc:id:sgln:4012345.00001.0',
    disposition: 'https://ref.gs1.org/cbv/Disp-in_progress',
    readPoint: 'urn:epc:id:sgln:4012345.00001.0',
    action: 'ADD',
    parentID: '',
    epcList: 'urn:epc:id:sgtin:4012345.011111.1001',
    childEPCList: '',
    inputEPCs: '',
    outputEPCs: '',
    ual: 'did:dkg:mock:31337/42',
    ...overrides,
  };
}

describe('handleTrackItem', () => {
  it('returns tracked events with summary for a valid epc', async () => {
    const engine = mockQueryEngine([
      makeBinding({ eventTime: '2024-03-01T08:00:00Z', bizStep: 'https://ref.gs1.org/cbv/BizStep-receiving' }),
      makeBinding({ event: 'urn:uuid:event-2', eventTime: '2024-03-02T12:00:00Z', bizStep: 'https://ref.gs1.org/cbv/BizStep-assembling' }),
    ]);
    const sp = new URLSearchParams('epc=urn:epc:id:sgtin:4012345.011111.1001');

    const result = await handleTrackItem(sp, { paranetId: PARANET_ID, queryEngine: engine });

    expect(result.epc).toBe('urn:epc:id:sgtin:4012345.011111.1001');
    expect(result.eventCount).toBe(2);
    expect(result.events).toHaveLength(2);

    // Query must use fullTrace
    const [sparql] = (engine.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sparql).toContain('UNION');
  });

  it('builds a human-readable journey summary with numbered steps', async () => {
    const engine = mockQueryEngine([
      makeBinding({
        eventTime: '2024-03-01T08:00:00Z',
        bizStep: 'https://ref.gs1.org/cbv/BizStep-receiving',
        bizLocation: 'urn:epc:id:sgln:4012345.00001.0',
      }),
      makeBinding({
        event: 'urn:uuid:event-2',
        eventTime: '2024-03-02T12:00:00Z',
        bizStep: 'https://ref.gs1.org/cbv/BizStep-commissioning',
        bizLocation: 'urn:epc:id:sgln:4012345.00003.0',
      }),
    ]);

    const result = await handleTrackItem(
      new URLSearchParams('epc=urn:epc:id:sgtin:4012345.011111.1001'),
      { paranetId: PARANET_ID, queryEngine: engine },
    );

    expect(result.summary).toContain('urn:epc:id:sgtin:4012345.011111.1001');
    expect(result.summary).toContain('2 event(s)');
    expect(result.summary).toContain('Journey Timeline');
    // Numbered steps
    expect(result.summary).toMatch(/1\.\s+\[.*\]\s+receiving/);
    expect(result.summary).toMatch(/2\.\s+\[.*\]\s+commissioning/);
  });

  it('sorts events chronologically (ascending)', async () => {
    const engine = mockQueryEngine([
      makeBinding({ event: 'urn:uuid:later', eventTime: '2024-03-03T00:00:00Z', bizStep: 'https://ref.gs1.org/cbv/BizStep-shipping' }),
      makeBinding({ event: 'urn:uuid:earlier', eventTime: '2024-03-01T00:00:00Z', bizStep: 'https://ref.gs1.org/cbv/BizStep-receiving' }),
    ]);

    const result = await handleTrackItem(
      new URLSearchParams('epc=urn:test'),
      { paranetId: PARANET_ID, queryEngine: engine },
    );

    // First event should be the earlier one
    expect(result.events[0].eventTime).toBe('2024-03-01T00:00:00Z');
    expect(result.events[1].eventTime).toBe('2024-03-03T00:00:00Z');
  });

  it('handles zero events gracefully', async () => {
    const engine = mockQueryEngine([]);

    const result = await handleTrackItem(
      new URLSearchParams('epc=urn:nonexistent'),
      { paranetId: PARANET_ID, queryEngine: engine },
    );

    expect(result.eventCount).toBe(0);
    expect(result.events).toHaveLength(0);
    expect(result.summary).toContain('0 event(s)');
    expect(result.summary).not.toContain('Journey Timeline');
  });

  it('throws 400 when epc param is missing', async () => {
    const engine = mockQueryEngine();

    try {
      await handleTrackItem(new URLSearchParams(''), { paranetId: PARANET_ID, queryEngine: engine });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EpcisQueryError);
      expect((err as EpcisQueryError).statusCode).toBe(400);
      expect((err as EpcisQueryError).message).toMatch(/epc/i);
    }

    expect(engine.query).not.toHaveBeenCalled();
  });

  it('falls back to eventType when bizStep is missing', async () => {
    const engine = mockQueryEngine([
      makeBinding({ bizStep: '', eventType: 'https://gs1.github.io/EPCIS/ObjectEvent' }),
    ]);

    const result = await handleTrackItem(
      new URLSearchParams('epc=urn:test'),
      { paranetId: PARANET_ID, queryEngine: engine },
    );

    expect(result.summary).toContain('ObjectEvent');
  });

  it('falls back to readPoint when bizLocation is missing', async () => {
    const engine = mockQueryEngine([
      makeBinding({ bizLocation: '', readPoint: 'urn:epc:id:sgln:fallback' }),
    ]);

    const result = await handleTrackItem(
      new URLSearchParams('epc=urn:test'),
      { paranetId: PARANET_ID, queryEngine: engine },
    );

    expect(result.summary).toContain('urn:epc:id:sgln:fallback');
  });
});
