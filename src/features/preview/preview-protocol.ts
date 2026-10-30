export interface PreviewRequest {
  id: number;
  markdown: string;
}

export interface PreviewResponse {
  id: number;
  html: string;
  /** 文档里的 ```mermaid 代码块源码，由预览面板在浏览器里渲染成图。 */
  mermaid?: string[];
  error?: string;
}

export interface PreviewResult {
  html: string;
  mermaid?: string[];
  error?: string;
}
