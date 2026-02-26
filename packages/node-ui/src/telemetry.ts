/**
 * Optional OpenTelemetry integration for the Node UI.
 * When enabled (via config), exports metrics and optionally traces to an OTLP endpoint.
 * operationId is set as the trace/span attribute for correlation with the dashboard.
 *
 * To enable: add @opentelemetry/api, @opentelemetry/sdk-metrics, and
 * @opentelemetry/exporter-metrics-otlp-http; then implement registerMeter() and
 * use the same metric names below. For traces, use @opentelemetry/sdk-trace-base
 * and set span attributes { 'dkg.operation_id': operationId }.
 */

export interface TelemetryConfig {
  enabled?: boolean;
  /** OTLP HTTP endpoint for metrics (e.g. http://localhost:4318/v1/metrics) */
  metricsEndpoint?: string;
  /** Service name for resource attributes */
  serviceName?: string;
}

let configured = false;

/**
 * Initialize telemetry. No-op if disabled or OTel packages not installed.
 * Call once at daemon startup.
 */
export function initTelemetry(_config: TelemetryConfig): void {
  if (!_config.enabled || !_config.metricsEndpoint) return;
  configured = true;
  // When OTel is added: create MeterProvider, OTLP exporter, register gauges
  // meter.createObservableGauge('dkg.network.peers', ...), etc.
}

/**
 * Record a gauge value for export. No-op when telemetry is disabled.
 * Metric names match dashboard: dkg.network.peers, dkg.knowledge.triples, dkg.system.cpu_percent, etc.
 */
export function recordGauge(_name: string, _value: number): void {
  if (!configured) return;
  // When OTel is added: update the observable gauge callback or record value
}

/**
 * Start a span for an operation (for trace correlation).
 * operationId should be set as span attribute so traces match the Operations panel.
 * No-op when telemetry is disabled.
 */
export function setOperationSpan(_operationId: string, _operationName: string): void {
  if (!configured) return;
  // When OTel is added: tracer.startSpan(operationName, { attributes: { 'dkg.operation_id': operationId } })
}

export function isTelemetryConfigured(): boolean {
  return configured;
}
