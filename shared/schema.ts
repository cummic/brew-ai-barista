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

export const PRICING = {
  LATTE_BASE: 5.50,
  ALMOND_MILK_UPCHARGE: 0.75,
  CROISSANT: 3.50,
  CHOCOLATE_CROISSANT: 4.00,
  TAX_RATE: 0.08875,
} as const;

export const LOCATIONS = {
  wtc: {
    id: "wtc",
    name: "World Trade Center",
    address: "Brookfield Place, 200 Vesey St, New York, NY 10281",
    status: "open",
    hours: "Mon–Fri 6:30 AM – 7:00 PM",
  },
  penn: {
    id: "penn",
    name: "Penn Station",
    address: "1 Penn Plaza, New York, NY 10119",
    status: "open",
    hours: "Mon–Sun 5:30 AM – 9:00 PM",
  },
  grand_central: {
    id: "grand_central",
    name: "Grand Central",
    address: "89 E 42nd St, New York, NY 10017",
    status: "open",
    hours: "Mon–Fri 6:00 AM – 8:00 PM",
  },
} as const;
