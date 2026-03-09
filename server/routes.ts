import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runBaristaChat } from "./barista";
import { checkPromptInjection } from "./guardrails";
import { checkRateLimit } from "./rateLimit";
import { logConversation } from "./observability";
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

      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
        ?? req.socket.remoteAddress
        ?? "unknown";
      const rateLimitKey = `${clientIp}:${sessionId}`;
      const { allowed, retryAfterMs } = checkRateLimit(rateLimitKey);
      if (!allowed) {
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
        return res.status(429).json({
          error: "Please slow down — you can send up to 10 messages per minute.",
          retryAfterSeconds: retryAfterSec,
        });
      }

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

      // Code-level location ambiguity check: if no location is confirmed yet and
      // the user's message contains generic transit terms, intercept before Claude.
      if (!session.orderState.location) {
        const ambiguousTerms = /\b(station|stations|train|terminal|transit|hub|depot|downtown|the city)\b/i;
        const exactLocation = /\b(wtc|world trade|penn station|penn|grand central|grand central terminal)\b/i;
        const cleanedMsg = guardrailResult.sanitized || message;
        if (ambiguousTerms.test(cleanedMsg) && !exactLocation.test(cleanedMsg)) {
          const clarification = "Which location — World Trade Center, Penn Station, or Grand Central?";
          const assistantMsg = {
            role: "assistant" as const,
            content: clarification,
            timestamp: new Date().toISOString(),
          };
          await storage.addMessage(sessionId, assistantMsg);
          return res.json({
            message: clarification,
            orderState: session.orderState,
            toolsUsed: [],
            validationPassed: true,
          });
        }
      }

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

      logConversation({
        user_id: clientIp === "unknown" ? "anonymous" : clientIp,
        session_id: sessionId,
        prompt: guardrailResult.sanitized || message,
        response: baristaResponse.message,
        latency_ms: baristaResponse.latency_ms,
        tools_used: baristaResponse.toolsUsed,
        validation_passed: baristaResponse.validationPassed,
      });

      res.json({
        message: baristaResponse.message,
        orderState: updatedSession?.orderState,
        toolsUsed: baristaResponse.toolsUsed,
        validationPassed: baristaResponse.validationPassed,
        latency_ms: baristaResponse.latency_ms,
      });
    } catch (err) {
      console.error("[chat] error:", err);
      res.status(500).json({ error: "AI service error. Please try again." });
    }
  });

  return httpServer;
}
