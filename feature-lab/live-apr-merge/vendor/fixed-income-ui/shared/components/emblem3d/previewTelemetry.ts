// Feature Lab must not report preview traffic to production analytics.
export const posthog = { capture(_event: string, _properties?: Record<string, unknown>) {} }
