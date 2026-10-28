export interface PreviewRequest {
  id: number;
  markdown: string;
}

export interface PreviewResponse {
  id: number;
  html: string;
  error?: string;
}

export interface PreviewResult {
  html: string;
  error?: string;
}
