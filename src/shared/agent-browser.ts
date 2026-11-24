export interface AgentBrowserPolicy {
  projectId: string;
  enabled: boolean;
  origin: string;
}

export interface AgentBrowserPage {
  url: string;
  title: string;
  text: string;
  readAt: string;
  truncated: boolean;
}
