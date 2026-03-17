import { createValidator } from './validation.js';
import { buildEpcisQuery } from './query-builder.js';
import { parseQueryParams, hasAtLeastOneFilter, hasValidDateRange } from './utils.js';
import type { Publisher, CaptureResult, CaptureOptions, QueryEngine, EventsQueryResult, EpcisEventResult, TrackItemResult } from './types.js';

export interface CaptureConfig {
  paranetId: string;
  publisher: Publisher;
}

export interface CaptureRequest {
  epcisDocument: unknown;
  publishOptions?: CaptureOptions;
}

export class EpcisValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`EPCIS validation failed: ${errors.join('; ')}`);
    this.name = 'EpcisValidationError';
  }
}

export class EpcisQueryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'EpcisQueryError';
  }
}

export interface EventsQueryConfig {
  paranetId: string;
  queryEngine: QueryEngine;
}

export async function handleEventsQuery(
  searchParams: URLSearchParams,
  config: EventsQueryConfig,
): Promise<EventsQueryResult> {
  const params = parseQueryParams(searchParams);

  if (!hasAtLeastOneFilter(params)) {
    throw new EpcisQueryError('At least one filter parameter is required', 400);
  }

  if (!hasValidDateRange(params)) {
    throw new EpcisQueryError('Invalid date range: "from" must be before or equal to "to"', 400);
  }

  const sparql = buildEpcisQuery(params, config.paranetId);
  const result = await config.queryEngine.query(sparql, { paranetId: config.paranetId });

  const events = bindingsToEvents(result.bindings);

  return {
    events,
    count: events.length,
    pagination: {
      limit: Math.min(Math.max(params.limit ?? 100, 1), 1000),
      offset: Math.max(params.offset ?? 0, 0),
    },
  };
}

function bindingsToEvents(bindings: Record<string, string>[]): EpcisEventResult[] {
  return bindings.map((row) => ({
    eventType: row['eventType'] ?? '',
    eventTime: row['eventTime'] ?? '',
    bizStep: row['bizStep'] ?? '',
    bizLocation: row['bizLocation'] ?? '',
    disposition: row['disposition'] ?? '',
    readPoint: row['readPoint'] ?? '',
    action: row['action'] ?? '',
    parentID: row['parentID'] ?? '',
    epcList: row['epcList'] ?? '',
    childEPCList: row['childEPCList'] ?? '',
    inputEPCs: row['inputEPCs'] ?? '',
    outputEPCs: row['outputEPCs'] ?? '',
    ual: row['ual'] ?? '',
  }));
}

function buildTrackItemSummary(epc: string, events: EpcisEventResult[]): string {
  let summary = `Tracking: ${epc}\n`;
  summary += `Found ${events.length} event(s) in the supply chain.\n`;

  if (events.length === 0) return summary;

  summary += '\nJourney Timeline:\n';
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const time = event.eventTime || 'Unknown time';
    const step = event.bizStep
      ? event.bizStep.split('-').pop()
      : event.eventType?.split('/').pop() || 'Unknown';
    const location = event.bizLocation || event.readPoint || 'Unknown location';
    summary += `${i + 1}. [${time}] ${step} @ ${location}\n`;
  }

  return summary;
}

export async function handleTrackItem(
  searchParams: URLSearchParams,
  config: EventsQueryConfig,
): Promise<TrackItemResult> {
  const epc = searchParams.get('epc')?.trim();

  if (!epc) {
    throw new EpcisQueryError('Missing required parameter: epc', 400);
  }

  const sparql = buildEpcisQuery({ epc, fullTrace: true }, config.paranetId);
  const result = await config.queryEngine.query(sparql, { paranetId: config.paranetId });

  const events = bindingsToEvents(result.bindings);
  // Sort chronologically (ascending by eventTime)
  events.sort((a, b) => (a.eventTime < b.eventTime ? -1 : a.eventTime > b.eventTime ? 1 : 0));

  return {
    summary: buildTrackItemSummary(epc, events),
    epc,
    eventCount: events.length,
    events,
  };
}

const validator = createValidator();

export async function handleCapture(
  request: CaptureRequest,
  config: CaptureConfig,
): Promise<CaptureResult> {
  const validation = validator.validate(request.epcisDocument);

  if (!validation.valid) {
    throw new EpcisValidationError(validation.errors!);
  }

  const opts = request.publishOptions
    ? { accessPolicy: request.publishOptions.accessPolicy, allowedPeers: request.publishOptions.allowedPeers }
    : undefined;

  const result = await config.publisher.publish(config.paranetId, request.epcisDocument, opts);

  return {
    ual: result.ual,
    kcId: result.kcId,
    receivedAt: new Date().toISOString(),
    eventCount: validation.eventCount!,
    status: result.status,
  };
}
