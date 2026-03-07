import { randomUUID } from "crypto";
import type { ChatSession, OrderState, ChatMessage } from "@shared/schema";

export interface IStorage {
  getSession(sessionId: string): Promise<ChatSession | undefined>;
  createSession(): Promise<ChatSession>;
  updateSession(sessionId: string, updates: Partial<ChatSession>): Promise<ChatSession>;
  addMessage(sessionId: string, message: ChatMessage): Promise<void>;
  resetSession(sessionId: string): Promise<ChatSession>;
}

function createInitialOrderState(sessionId: string): OrderState {
  return {
    sessionId,
    stage: "greeting",
    location: null,
    drink: null,
    milkType: null,
    pastry: null,
    tip: null,
    total: null,
    submittedAt: null,
  };
}

export class MemStorage implements IStorage {
  private sessions: Map<string, ChatSession>;

  constructor() {
    this.sessions = new Map();
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async createSession(): Promise<ChatSession> {
    const sessionId = randomUUID();
    const session: ChatSession = {
      sessionId,
      messages: [],
      orderState: createInitialOrderState(sessionId),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async updateSession(sessionId: string, updates: Partial<ChatSession>): Promise<ChatSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const updated = { ...session, ...updates };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.messages.push(message);
  }

  async resetSession(sessionId: string): Promise<ChatSession> {
    const fresh: ChatSession = {
      sessionId,
      messages: [],
      orderState: createInitialOrderState(sessionId),
    };
    this.sessions.set(sessionId, fresh);
    return fresh;
  }
}

export const storage = new MemStorage();
