const forbiddenBackendHostPatterns = [
  /\.supabase\.co$/i,
  /(^|\.)supabase\.in$/i,
  /^graph\.(facebook|instagram)\.com$/i,
  /^api\.instagram\.com$/i,
  /^api\.netgsm\.com\.tr$/i,
  /(^|\.)kolaybi\.com$/i,
  /(^|\.)suratkargo\.com\.tr$/i,
  /(^|\.)ptt\.gov\.tr$/i,
  /(^|\.)s3[.-][a-z0-9-]+\.amazonaws\.com$/i,
  /(^|\.)amazonaws\.com$/i,
];

export function assertBackendBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Backend base URL must use http or https");
  }

  if (forbiddenBackendHostPatterns.some((pattern) => pattern.test(url.hostname))) {
    throw new Error("Web clients must talk to the backend API, not a direct external service");
  }
}
