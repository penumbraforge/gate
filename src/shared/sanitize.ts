/**
 * Shared secret sanitization — strips match/matchPreview from findings.
 * Used in: audit ingestion, scan API responses, webhook delivery, audit export.
 */

export function stripSecretFields(findings: any[]): any[] {
  return findings.map((f) => {
    const { match, matchPreview, ...safe } = f;
    return safe;
  });
}
