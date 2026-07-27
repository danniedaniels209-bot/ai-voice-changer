export interface ConnectorPoint {
  x: number;
  y: number;
}

export type ConnectorStyle = "straight" | "curved" | "orthogonal" | "bezier";

export interface ConnectorSpec {
  from: ConnectorPoint;
  to: ConnectorPoint;
  style: ConnectorStyle;
  strokeColor?: string;
  strokeWidth?: number;
  dashPattern?: string;
  animated?: boolean;
}
