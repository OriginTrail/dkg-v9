// EPCIS Document types based on GS1 EPCIS 2.0

export interface EPCISDocument {
  '@context': string | string[] | Record<string, unknown>;
  type: 'EPCISDocument';
  schemaVersion: string;
  creationDate: string;
  epcisBody?: {
    eventList: EPCISEvent[];
  };
  eventList?: EPCISEvent[];
  [key: string]: unknown;
}

export interface EPCISEvent {
  type: string;
  eventTime: string;
  eventTimeZoneOffset?: string;
  epcList?: string[];
  action?: string;
  bizStep?: string;
  disposition?: string;
  readPoint?: { id: string };
  bizLocation?: { id: string };
  bizTransactionList?: Array<{ type: string; bizTransaction: string }>;
  sensorElementList?: unknown[];
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  eventCount?: number;
}

export interface CaptureResult {
  ual: string;
  kcId: string;
  receivedAt: string;
  eventCount: number;
  status: string;
}

export interface CaptureOptions {
  accessPolicy?: 'public' | 'ownerOnly' | 'allowList';
  allowedPeers?: string[];
}

/** Dependency-inversion boundary: the EPCIS package needs something that can publish JSON-LD. */
export interface Publisher {
  publish(
    paranetId: string,
    content: unknown,
    opts?: CaptureOptions,
  ): Promise<{ ual: string; kcId: string; status: string }>;
}
