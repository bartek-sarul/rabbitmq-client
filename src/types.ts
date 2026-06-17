export interface QueueDef {
  name: string;
}

export interface ExchangeDef {
  name: string;
}


export interface ConnectionDef {
  name: string;
  url: string;
  queues: QueueDef[];
  exchanges: ExchangeDef[];
}

export interface AppConfig {
  save_path: string;
  connections: ConnectionDef[];
}

export type TargetType = "queue" | "exchange";
export type TabMode = "read" | "write";
export type AckMode = "ack" | "nack";
export type TabStatus = "connecting" | "consuming" | "disconnected";

export interface Tab {
  id: string;
  connName: string;
  connUrl: string;
  targetName: string;
  targetType: TargetType;
  mode: TabMode;
  ackMode: AckMode;
  label: string;
  consuming?: boolean;
  status?: TabStatus;
  folderPath?: string;
  folderName?: string;
  lastReceived?: number;
  body?: string;
  routingKey?: string;
  contentType?: string;
  deliveryMode?: number;
  correlationId?: string;
  autoCorrelationId?: boolean;
  messageId?: string;
  autoMessageId?: boolean;
  headers?: string;
}

export interface Message {
  id: string;
  timestamp: string;
  filePath: string;
  bodyPreview: string;
  properties: {
    content_type: string | null;
    delivery_mode: number | null;
    correlation_id: string | null;
    message_id: string | null;
  };
}
