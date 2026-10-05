const redacted = "[redacted]";

const sensitiveKeyPattern =
  /(^|[_\-.])(?:password|pass|pwd|token|access_token|refresh_token|authorization|cookie|api_key|apikey|secret|sifre|cari_kodu|carikodu)$/i;

const presignedQueryKeyPattern = /^X-Amz-/i;
const postgresConnectionStringPattern =
  /\b(postgres(?:ql)?:\/\/[^:\s"'<>/@]+:)([^@\s"'<>]+)(@)/giu;
const authorizationHeaderPattern =
  /\b(authorization\s*[:=]\s*)(bearer|basic)\s+[^\s;,]+/giu;
const cookieHeaderPattern = /\b(cookie\s*[:=]\s*)[^\r\n]+/giu;
const secretParameterPattern =
  /\b(password|pass|pwd|token|access_token|refresh_token|api_key|secret|sifre|CariKodu|connectionString)=(?!(?:\[REDACTED\]|\[redacted\])(?:[\s;,&]|$))("[^"]*"|'[^']*'|[^\s;,&]+)/gu;

function isSensitiveKey(key: string): boolean {
  const normalized = key.replaceAll("-", "_");
  return sensitiveKeyPattern.test(normalized);
}

function redactUrlLikeValue(value: string): string {
  let redactedValue = value.replace(postgresConnectionStringPattern, `$1${redacted}$3`);
  redactedValue = redactedValue.replace(authorizationHeaderPattern, `$1${redacted}`);
  redactedValue = redactedValue.replace(cookieHeaderPattern, `$1${redacted}`);
  redactedValue = redactedValue.replace(secretParameterPattern, `$1=${redacted}`);

  return redactedValue.replace(
    /([?&])([^=&\s]+)=([^&\s]*)/g,
    (match: string, separator: string, key: string) =>
      presignedQueryKeyPattern.test(key) || isSensitiveKey(key)
        ? `${separator}${key}=${redacted}`
        : match,
  );
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactUrlLikeValue(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactValue(value.message),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        isSensitiveKey(key) ? redacted : redactValue(nestedValue),
      ]),
    );
  }

  return value;
}
