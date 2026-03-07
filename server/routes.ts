import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runBaristaChat } from "./barista";
import { checkPromptInjection } from "./guardrails";
import { sendMessageSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/session", async (req, res) => {
    try {
      const session = await storage.createSession();
      res.json({ sessionId: session.sessionId, orderState: session.orderState });
    } catch (err) {
      console.error("[session] error:", err);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.get("/api/session/:sessionId", async (req, res) => {
    try {
      const session = await storage.getSession(req.params.sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json({ sessionId: session.sessionId, orderState: session.orderState, messages: session.messages });
    } catch (err) {
      console.error("[session/get] error:", err);
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  app.post("/api/session/:sessionId/reset", async (req, res) => {
    try {
      const session = await storage.resetSession(req.params.sessionId);
      res.json({ sessionId: session.sessionId, orderState: session.orderState, messages: [] });
    } catch (err) {
      console.error("[session/reset] error:", err);
      res.status(500).json({ error: "Failed to reset session" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { sessionId, message } = parsed.data;

      const guardrailResult = checkPromptInjection(message);
      if (!guardrailResult.passed) {
        return res.status(400).json({
          error: "Message blocked",
          reason: guardrailResult.reason,
          blocked: true,
        });
      }

      let session = await storage.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const userMessage = {
        role: "user" as const,
        content: guardrailResult.sanitized || message,
        timestamp: new Date().toISOString(),
      };
      await storage.addMessage(sessionId, userMessage);

      session = await storage.getSession(sessionId)!;
      const conversationHistory = session!.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const baristaResponse = await runBaristaChat(conversationHistory, session!.orderState);

      if (!baristaResponse.validationPassed) {
        console.warn(`[routes] Output validation failed for session ${sessionId}`);
      }

      const assistantMessage = {
        role: "assistant" as const,
        content: baristaResponse.message,
        timestamp: new Date().toISOString(),
      };
      await storage.addMessage(sessionId, assistantMessage);

      if (Object.keys(baristaResponse.stateUpdates).length > 0) {
        const currentSession = await storage.getSession(sessionId);
        if (currentSession) {
          await storage.updateSession(sessionId, {
            orderState: {
              ...currentSession.orderState,
              ...baristaResponse.stateUpdates,
            },
          });
        }
      }

      const updatedSession = await storage.getSession(sessionId);

      res.json({
        message: baristaResponse.message,
        orderState: updatedSession?.orderState,
        toolsUsed: baristaResponse.toolsUsed,
        validationPassed: baristaResponse.validationPassed,
      });
    } catch (err) {
      console.error("[chat] error:", err);
      res.status(500).json({ error: "AI service error. Please try again." });
    }
  });

  return httpServer;
}
