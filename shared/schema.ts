import { z } from "zod";

export type OrderStage =
  | "greeting"
  | "identifying"
  | "configuring"
  | "upselling"
  | "payment"
  | "confirmed";

export type MilkType = "whole" | "2%" | "almond";
export type PastryType = "none" | "croissant" | "chocolate_croissant";
export type LocationId = "wtc" | "penn" | "grand_central";
export type TipOption = 0 | 10;

export interface OrderState {
  sessionId: string;
  stage: OrderStage;
  location: LocationId | null;
  milkType: MilkType | null;
  pastry: PastryType | null;
  tip: TipOption | null;
  total: number | null;
  submittedAt: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ChatSession {
  sessionId: string;
  messages: ChatMessage[];
  orderState: OrderState;
}

export const sendMessageSchema = z.object({
  sessionId: z.string(),
  message: z.string().min(1).max(2000),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
