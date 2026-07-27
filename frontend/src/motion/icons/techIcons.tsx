import React from "react";

export interface IconProps {
  size?: number;
  color?: string;
  title?: string;
}

export interface TechIconComponent extends React.FC<IconProps> {
  displayName?: string;
}

export const TECH_ICONS: Record<string, TechIconComponent> = {} as Record<string, TechIconComponent>;

function registerIcon(name: string, comp: TechIconComponent) {
  comp.displayName = name;
  TECH_ICONS[name] = comp;
  return comp;
}

function iconShell(
  svg: React.ReactNode,
  props: IconProps = {},
  displayName: string,
): React.ReactElement {
  const { size = 24, color = "currentColor", title } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={title || displayName}
      role="img"
    >
      {title && <title>{title}</title>}
      {svg}
    </svg>
  );
}

/* ─── Cloud ─── */
export const CloudIcon: TechIconComponent = registerIcon(
  "cloud",
  (props) =>
    iconShell(
      <>
        <path d="M7 18a4 4 0 0 1-.67-7.96A5.5 5.5 0 0 1 16.5 9 4 4 0 0 1 20 13h-1a3 3 0 0 1-6 0H7z" />
      </>,
      props,
      "cloud",
    ),
);

/* ─── Database ─── */
export const DatabaseIcon: TechIconComponent = registerIcon(
  "database",
  (props) =>
    iconShell(
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
        <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
      </>,
      props,
      "database",
    ),
);

/* ─── API ─── */
export const ApiIcon: TechIconComponent = registerIcon(
  "api",
  (props) =>
    iconShell(
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4" />
      </>,
      props,
      "api",
    ),
);

/* ─── Backend ─── */
export const BackendIcon: TechIconComponent = registerIcon(
  "backend",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="3" width="20" height="6" rx="1" />
        <rect x="2" y="15" width="20" height="6" rx="1" />
        <circle cx="6" cy="6" r="1" fill={props.color || "currentColor"} stroke="none" />
        <circle cx="6" cy="18" r="1" fill={props.color || "currentColor"} stroke="none" />
        <path d="M10 9h4M10 21h4" />
      </>,
      props,
      "backend",
    ),
);

/* ─── Frontend ─── */
export const FrontendIcon: TechIconComponent = registerIcon(
  "frontend",
  (props) =>
    iconShell(
      <>
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M3 8h18" />
        <circle cx="6" cy="6" r="0.6" fill={props.color || "currentColor"} stroke="none" />
        <circle cx="8" cy="6" r="0.6" fill={props.color || "currentColor"} stroke="none" />
        <path d="M7 13h4M7 16h6" />
      </>,
      props,
      "frontend",
    ),
);

/* ─── Server ─── */
export const ServerIcon: TechIconComponent = registerIcon(
  "server",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="2" width="20" height="6" rx="1" />
        <rect x="2" y="12" width="20" height="6" rx="1" />
        <circle cx="6" cy="5" r="1" fill={props.color || "currentColor"} stroke="none" />
        <circle cx="6" cy="15" r="1" fill={props.color || "currentColor"} stroke="none" />
        <path d="M10 5h4M10 15h4M14 7h2M14 19h2" />
      </>,
      props,
      "server",
    ),
);

/* ─── Computer ─── */
export const ComputerIcon: TechIconComponent = registerIcon(
  "computer",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>,
      props,
      "computer",
    ),
);

/* ─── Router ─── */
export const RouterIcon: TechIconComponent = registerIcon(
  "router",
  (props) =>
    iconShell(
      <>
        <rect x="1" y="9" width="22" height="6" rx="1" />
        <path d="M6 9V7a6 6 0 0 1 12 0v2" />
        <circle cx="7" cy="12" r="0.8" fill={props.color || "currentColor"} stroke="none" />
        <circle cx="17" cy="12" r="0.8" fill={props.color || "currentColor"} stroke="none" />
        <path d="M11 12h2" />
        <path d="M1 12h2M19 12h2" />
      </>,
      props,
      "router",
    ),
);

/* ─── Network ─── */
export const NetworkIcon: TechIconComponent = registerIcon(
  "network",
  (props) =>
    iconShell(
      <>
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="5" cy="19" r="2.5" />
        <circle cx="19" cy="19" r="2.5" />
        <path d="M12 8v3.5a3.5 3.5 0 0 0 3.5 3.5H19M8.5 17 5 16.5M15.5 17 19 16.5" />
      </>,
      props,
      "network",
    ),
);

/* ─── Folder ─── */
export const FolderIcon: TechIconComponent = registerIcon(
  "folder",
  (props) =>
    iconShell(
      <>
        <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
      </>,
      props,
      "folder",
    ),
);

/* ─── File ─── */
export const FileIcon: TechIconComponent = registerIcon(
  "file",
  (props) =>
    iconShell(
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M10 12h4M10 16h4" />
      </>,
      props,
      "file",
    ),
);

/* ─── Email ─── */
export const EmailIcon: TechIconComponent = registerIcon(
  "email",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M2 7l10 6 10-6" />
      </>,
      props,
      "email",
    ),
);

/* ─── Webhook ─── */
export const WebhookIcon: TechIconComponent = registerIcon(
  "webhook",
  (props) =>
    iconShell(
      <>
        <path d="M4 12h4l3-7 4 14 3-7h2" />
        <circle cx="6" cy="12" r="1.5" />
        <circle cx="18" cy="12" r="1.5" />
      </>,
      props,
      "webhook",
    ),
);

/* ─── Automation ─── */
export const AutomationIcon: TechIconComponent = registerIcon(
  "automation",
  (props) =>
    iconShell(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
        <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </>,
      props,
      "automation",
    ),
);

/* ─── Workflow-block ─── */
export const WorkflowBlockIcon: TechIconComponent = registerIcon(
  "workflow-block",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="6" width="8" height="12" rx="1.5" />
        <rect x="14" y="2" width="8" height="7" rx="1.5" />
        <rect x="14" y="15" width="8" height="7" rx="1.5" />
        <path d="M10 12h4" />
        <path d="M12 10v4" />
      </>,
      props,
      "workflow-block",
    ),
);

/* ─── Function ─── */
export const FunctionIcon: TechIconComponent = registerIcon(
  "function",
  (props) =>
    iconShell(
      <>
        <path d="M4 4l4 8 4-8M4 4h4v4H4zM16 20l-4-8-4 8M16 20h-4v-4h4z" />
      </>,
      props,
      "function",
    ),
);

/* ─── Code-block ─── */
export const CodeBlockIcon: TechIconComponent = registerIcon(
  "code-block",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />
      </>,
      props,
      "code-block",
    ),
);

/* ─── Terminal ─── */
export const TerminalIcon: TechIconComponent = registerIcon(
  "terminal",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M6 8l4 4-4 4" />
        <path d="M13 12h5" />
      </>,
      props,
      "terminal",
    ),
);

/* ─── Git-branch ─── */
export const GitBranchIcon: TechIconComponent = registerIcon(
  "git-branch",
  (props) =>
    iconShell(
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 8v4a4 4 0 0 0 8 0V8" />
        <path d="M12 14v4" />
      </>,
      props,
      "git-branch",
    ),
);

/* ─── Docker ─── */
export const DockerIcon: TechIconComponent = registerIcon(
  "docker",
  (props) =>
    iconShell(
      <>
        <rect x="1" y="9" width="22" height="10" rx="4" />
        <path d="M4 14v-1a6 6 0 0 1 12 0v1" />
        <rect x="7" y="13" width="2" height="2" rx="0.5" />
        <rect x="11" y="13" width="2" height="2" rx="0.5" />
        <rect x="15" y="13" width="2" height="2" rx="0.5" />
        <rect x="9" y="10.5" width="2" height="1.5" rx="0.5" />
        <rect x="13" y="10.5" width="2" height="1.5" rx="0.5" />
      </>,
      props,
      "docker",
    ),
);

/* ─── Kubernetes ─── */
export const KubernetesIcon: TechIconComponent = registerIcon(
  "kubernetes",
  (props) =>
    iconShell(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3c1.5 3 2.5 5.5 3 9s0 7-3 9c-1.5-3-2.5-5.5-3-9s0-7 3-9z" />
        <path d="M3 12h18M12 3c-3 1.5-5.5 2.5-9 3s-7 0-9-3M12 21c3-1.5 5.5-2.5 9-3s7 0 9 3" />
        <path d="M3 12c1.5-3 2.5-5.5 3-9s0-7 3-9M18 12c-1.5 3-2.5 5.5-3 9s0 7-3 9" />
      </>,
      props,
      "kubernetes",
    ),
);

/* ─── Browser-tabs ─── */
export const BrowserTabsIcon: TechIconComponent = registerIcon(
  "browser-tabs",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="3" width="20" height="4" rx="1" />
        <path d="M2 7l10 12L22 7" />
        <path d="M8 10h2M14 10h2" />
      </>,
      props,
      "browser-tabs",
    ),
);

/* ─── Smartphone-ui ─── */
export const SmartphoneUiIcon: TechIconComponent = registerIcon(
  "smartphone-ui",
  (props) =>
    iconShell(
      <>
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <path d="M12 18h.01" />
        <rect x="9" y="5" width="6" height="9" rx="0.5" />
        <circle cx="12" cy="9" r="1" fill={props.color || "currentColor"} stroke="none" />
        <path d="M9 12h3" />
        <path d="M9 14.5h3" />
      </>,
      props,
      "smartphone-ui",
    ),
);

/* ─── Desktop-ui ─── */
export const DesktopUiIcon: TechIconComponent = registerIcon(
  "desktop-ui",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M12 17v4M8 21h8" />
        <path d="M6 8h4M6 11h8" />
      </>,
      props,
      "desktop-ui",
    ),
);

/* ─── Notification ─── */
export const NotificationIcon: TechIconComponent = registerIcon(
  "notification",
  (props) =>
    iconShell(
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        <circle cx="18" cy="4" r="2.5" fill={props.color || "currentColor"} stroke="none" />
      </>,
      props,
      "notification",
    ),
);

/* ─── Authentication ─── */
export const AuthenticationIcon: TechIconComponent = registerIcon(
  "authentication",
  (props) =>
    iconShell(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        <path d="M8 8l-2 2 2 2M16 8l2 2-2 2" />
      </>,
      props,
      "authentication",
    ),
);

/* ─── Security-lock ─── */
export const SecurityLockIcon: TechIconComponent = registerIcon(
  "security-lock",
  (props) =>
    iconShell(
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        <circle cx="12" cy="16" r="1" fill={props.color || "currentColor"} stroke="none" />
      </>,
      props,
      "security-lock",
    ),
);

/* ─── Encryption ─── */
export const EncryptionIcon: TechIconComponent = registerIcon(
  "encryption",
  (props) =>
    iconShell(
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        <path d="M9 15l2 2 4-4" />
        <circle cx="12" cy="16" r="0.8" fill={props.color || "currentColor"} stroke="none" />
      </>,
      props,
      "encryption",
    ),
);

/* ─── Storage ─── */
export const StorageIcon: TechIconComponent = registerIcon(
  "storage",
  (props) =>
    iconShell(
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
        <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
      </>,
      props,
      "storage",
    ),
);

/* ─── Analytics ─── */
export const AnalyticsIcon: TechIconComponent = registerIcon(
  "analytics",
  (props) =>
    iconShell(
      <>
        <rect x="3" y="12" width="4" height="9" rx="1" />
        <rect x="10" y="6" width="4" height="15" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
        <path d="M7 15l3-5 4 4 4-6" />
      </>,
      props,
      "analytics",
    ),
);

/* ─── Dashboard ─── */
export const DashboardIcon: TechIconComponent = registerIcon(
  "dashboard",
  (props) =>
    iconShell(
      <>
        <rect x="3" y="3" width="18" height="14" rx="2" />
        <path d="M7 10h4M7 14h6M16 10h1M16 14h2" />
        <rect x="3" y="17" width="4" height="4" rx="0.5" />
        <rect x="9" y="17" width="4" height="4" rx="0.5" />
      </>,
      props,
      "dashboard",
    ),
);

/* ─── Pipeline ─── */
export const PipelineIcon: TechIconComponent = registerIcon(
  "pipeline",
  (props) =>
    iconShell(
      <>
        <rect x="1" y="7" width="5" height="10" rx="1.5" />
        <rect x="9.5" y="7" width="5" height="10" rx="1.5" />
        <rect x="18" y="7" width="5" height="10" rx="1.5" />
        <path d="M6 12h3.5M17 12h1M14.5 12h1" />
      </>,
      props,
      "pipeline",
    ),
);

/* ─── Queue ─── */
export const QueueIcon: TechIconComponent = registerIcon(
  "queue",
  (props) =>
    iconShell(
      <>
        <rect x="2" y="6" width="18" height="4" rx="1" />
        <rect x="2" y="12" width="18" height="4" rx="1" />
        <path d="M22 10v4M20 10h4M20 14h4" />
        <path d="M6 8h6M6 14h6" />
      </>,
      props,
      "queue",
    ),
);

/* ─── Cache ─── */
export const CacheIcon: TechIconComponent = registerIcon(
  "cache",
  (props) =>
    iconShell(
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
        <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
        <path d="M6 9h3M15 9h3M9 21h6" />
      </>,
      props,
      "cache",
    ),
);

/* ─── AI-chip ─── */
export const AiChipIcon: TechIconComponent = registerIcon(
  "ai-chip",
  (props) =>
    iconShell(
      <>
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
        <circle cx="12" cy="12" r="2" fill={props.color || "currentColor"} stroke="none" />
        <path d="M11 11l-.5-.5M13 13l.5.5M11 13l-.5.5M13 11l.5-.5" />
      </>,
      props,
      "ai-chip",
    ),
);

export {
  CloudIcon as cloud,
  DatabaseIcon as database,
  ApiIcon as api,
  BackendIcon as backend,
  FrontendIcon as frontend,
  ServerIcon as server,
  ComputerIcon as computer,
  RouterIcon as router,
  NetworkIcon as network,
  FolderIcon as folder,
  FileIcon as file,
  EmailIcon as email,
  WebhookIcon as webhook,
  AutomationIcon as automation,
  WorkflowBlockIcon as "workflow-block",
  FunctionIcon as function,
  CodeBlockIcon as "code-block",
  TerminalIcon as terminal,
  GitBranchIcon as "git-branch",
  DockerIcon as docker,
  KubernetesIcon as kubernetes,
  BrowserTabsIcon as "browser-tabs",
  SmartphoneUiIcon as "smartphone-ui",
  DesktopUiIcon as "desktop-ui",
  NotificationIcon as notification,
  AuthenticationIcon as authentication,
  SecurityLockIcon as "security-lock",
  EncryptionIcon as encryption,
  StorageIcon as storage,
  AnalyticsIcon as analytics,
  DashboardIcon as dashboard,
  PipelineIcon as pipeline,
  QueueIcon as queue,
  CacheIcon as cache,
  AiChipIcon as "ai-chip",
};
