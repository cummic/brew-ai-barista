import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, RotateCcw, Coffee, MapPin, Milk, Croissant, CreditCard, CheckCircle2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import type { OrderState, ChatMessage } from "@shared/schema";

async function callChatAPI(
  sessionId: string,
  message: string,
  onChunk: (text: string) => void
): Promise<{ message: string; orderState: any; toolsUsed: string[]; validationPassed: boolean }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    const error: any = new Error(err.error || "Request failed");
    error.blocked = err.blocked;
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";

  // Ambiguity check returns plain JSON; SSE returns text/event-stream
  if (!contentType.includes("text/event-stream")) {
    return response.json();
  }

  return new Promise((resolve, reject) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData: any = null;

    const read = () => {
      reader.read().then(({ done, value }) => {
        if (done) {
          resolve(finalData ?? { message: "", orderState: null, toolsUsed: [], validationPassed: true });
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "chunk") {
              onChunk(event.text);
            } else if (event.type === "done") {
              finalData = event;
            } else if (event.type === "error") {
              reject(new Error(event.message || "Streaming error"));
              return;
            }
          } catch {}
        }
        read();
      }).catch(reject);
    };
    read();
  });
}

const LOCATION_LABELS: Record<string, string> = {
  wtc: "World Trade Center",
  penn: "Penn Station",
  grand_central: "Grand Central",
};

const MILK_LABELS: Record<string, string> = {
  whole: "Whole Milk",
  "2pct": "2% Milk",
  almond: "Almond Milk",
};

const DRINK_LABELS: Record<string, string> = {
  latte: "Latte",
  cortado: "Cortado",
};

const PASTRY_LABELS: Record<string, string> = {
  none: "No Pastry",
  croissant: "Croissant",
  chocolate_croissant: "Chocolate Croissant",
};

const STAGE_LABELS: Record<string, string> = {
  greeting: "Getting Started",
  identifying: "Selecting Location",
  configuring: "Customizing Order",
  upselling: "Adding Extras",
  payment: "Payment",
  confirmed: "Order Confirmed",
};

const STAGE_PROGRESS: Record<string, number> = {
  greeting: 10,
  identifying: 25,
  configuring: 50,
  upselling: 65,
  payment: 80,
  confirmed: 100,
};


function SystemMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-center px-4 pb-2 pt-1">
      <span className="rounded-full bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
        {text}
      </span>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 px-4 py-1">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Coffee className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-card border border-card-border px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`flex items-end gap-2 px-4 py-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {!isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Coffee className="h-4 w-4" />
        </div>
      )}
      <div className={`flex flex-col gap-1 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`
            rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm
            ${isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-card border border-card-border text-card-foreground rounded-bl-sm"
            }
          `}
          data-testid={`message-bubble-${message.role}-${message.timestamp}`}
        >
          {message.content.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i < message.content.split("\n").length - 1 && <br />}
            </span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground px-1">{time}</span>
      </div>
    </div>
  );
}

function OrderPanel({ orderState }: { orderState: OrderState }) {
  const [expanded, setExpanded] = useState(false);
  const progress = STAGE_PROGRESS[orderState.stage] || 0;
  const isConfirmed = orderState.stage === "confirmed";
  const orderReady = orderState.total !== null && !isConfirmed;

  return (
    <div className={`border-t border-border bg-card transition-all duration-300 ${expanded ? "max-h-72" : "max-h-16"}`}>
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        onClick={() => setExpanded((e) => !e)}
        data-testid="button-order-panel-toggle"
      >
        <div className="flex items-center gap-2">
          {isConfirmed ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Clock className="h-4 w-4 text-primary" />
          )}
          <span className="text-foreground font-semibold">
            {isConfirmed
              ? "Order Confirmed"
              : orderReady && !expanded
              ? "Order Ready — tap to review"
              : STAGE_LABELS[orderState.stage]}
          </span>
          {orderReady && !expanded && (
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          )}
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
      </button>

      <div className="px-4 pb-1">
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-2 grid grid-cols-2 gap-2">
          <OrderItem
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Location"
            value={orderState.location ? LOCATION_LABELS[orderState.location] : null}
          />
          <OrderItem
            icon={<Coffee className="h-3.5 w-3.5" />}
            label="Drink"
            value={orderState.drink ? (DRINK_LABELS[orderState.drink] ?? orderState.drink) : null}
          />
          <OrderItem
            icon={<Milk className="h-3.5 w-3.5" />}
            label="Milk"
            value={orderState.milkType ? MILK_LABELS[orderState.milkType] : null}
          />
          <OrderItem
            icon={<Croissant className="h-3.5 w-3.5" />}
            label="Pastry"
            value={orderState.pastry && orderState.pastry !== "none" ? PASTRY_LABELS[orderState.pastry] : orderState.pastry === "none" ? "None" : null}
          />
          <OrderItem
            icon={<CreditCard className="h-3.5 w-3.5" />}
            label="Payment"
            value={orderState.tip !== null ? `Card on File · ${orderState.tip}% tip` : null}
          />
          {orderState.total && (
            <OrderItem
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label="Total"
              value={`$${orderState.total.toFixed(2)}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function OrderItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 ${value ? "text-primary" : "text-muted-foreground/40"}`}>{icon}</span>
      <div className="flex flex-col min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-xs font-medium truncate ${value ? "text-foreground" : "text-muted-foreground/40"}`}>
          {value || "Pending"}
        </span>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [orderState, setOrderState] = useState<OrderState | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const createSession = useMutation({
    mutationFn: () => apiRequest("POST", "/api/session").then((r) => r.json()),
    onSuccess: (data: any) => {
      setSessionId(data.sessionId);
      setOrderState(data.orderState);
      setMessages([]);
      sendInitialGreeting(data.sessionId);
    },
    onError: () => {
      setMessages([{
        role: "assistant",
        content: "Something went wrong starting your session. Please refresh the page and try again.",
        timestamp: new Date().toISOString(),
      }]);
    },
  });

  const sendInitialGreeting = useCallback(async (sid: string) => {
    setIsTyping(true);
    setStreamingContent("");
    try {
      let streamed = "";
      const data = await callChatAPI(sid, "Hello", (chunk) => {
        streamed += chunk;
        setStreamingContent(streamed);
      });
      const content = data.message || streamed || "Hi! I'm Brew, your AI barista. Which location are you at — WTC, Penn Station, or Grand Central?";
      setStreamingContent(null);
      setMessages([{ role: "assistant", content, timestamp: new Date().toISOString() }]);
      if (data.orderState) setOrderState(data.orderState);
    } catch {
      setStreamingContent(null);
      setMessages([{
        role: "assistant",
        content: "Hi! I'm Brew, your AI barista. Which location are you at — WTC, Penn Station, or Grand Central?",
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsTyping(false);
    }
  }, []);

  useEffect(() => {
    createSession.mutate();
  }, []);

  useEffect(() => {
    if (messages.length > 1 || isTyping || streamingContent !== null) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping, streamingContent]);

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || inputValue).trim();
    if (!msg || !sessionId || isSending) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: msg,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsSending(true);
    setIsTyping(true);
    setStreamingContent("");

    try {
      let streamed = "";
      const data = await callChatAPI(sessionId, msg, (chunk) => {
        streamed += chunk;
        setStreamingContent(streamed);
        setIsTyping(false);
      });
      const content = data.message || streamed;
      setStreamingContent(null);
      setMessages((prev) => [...prev, { role: "assistant", content, timestamp: new Date().toISOString() }]);
      if (data.orderState) setOrderState(data.orderState);
    } catch (err: any) {
      setStreamingContent(null);
      if (err?.status === 404) {
        setMessages([]);
        setOrderState(null);
        createSession.mutate();
      } else {
        const errorContent = err?.blocked
          ? "I noticed something unusual in your message. Let's keep things on track — what would you like to order?"
          : "Something went wrong. Please try again.";
        setMessages((prev) => [...prev, { role: "assistant", content: errorContent, timestamp: new Date().toISOString() }]);
      }
    } finally {
      setIsSending(false);
      setIsTyping(false);
    }
  }, [inputValue, sessionId, isSending]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleReset = useCallback(() => {
    if (!sessionId) return;
    apiRequest("POST", `/api/session/${sessionId}/reset`).then(() => {
      setMessages([]);
      setOrderState(null);
      setIsTyping(false);
      setStreamingContent(null);
      setIsSending(false);
      createSession.mutate();
    });
  }, [sessionId, createSession]);


  return (
    <div className="flex h-screen flex-col bg-background" data-testid="chat-page">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Coffee className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground leading-tight">Brew</h1>
            <p className="text-xs text-muted-foreground">AI Barista · Manhattan Pilot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 shadow-sm" />
            <span className="text-xs text-muted-foreground">Online</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            data-testid="button-reset-chat"
            className="text-xs gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New Order
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto py-3" data-testid="messages-container">
        <SystemMessage text="Demo only · Conversations are saved · No real charges or orders" />

        {createSession.isPending && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Coffee className="h-10 w-10 animate-pulse text-primary" />
            <p className="text-sm">Firing up the espresso machine...</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} />
        ))}

        {isTyping && streamingContent === "" && <TypingIndicator />}

        {streamingContent !== null && streamingContent !== "" && (
          <div className="flex items-end gap-2 px-4 py-1 flex-row">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Coffee className="h-4 w-4" />
            </div>
            <div className="flex flex-col gap-1 max-w-[85%] items-start">
              <div
                className="rounded-2xl rounded-bl-sm bg-card border border-card-border text-card-foreground px-4 py-2.5 text-sm leading-relaxed shadow-sm"
                data-testid="message-streaming"
              >
                {streamingContent.split("\n").map((line, i, arr) => (
                  <span key={i}>
                    {line}
                    {i < arr.length - 1 && <br />}
                  </span>
                ))}
                <span className="inline-block w-0.5 h-3.5 bg-primary ml-0.5 animate-pulse align-middle" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {orderState && <OrderPanel orderState={orderState} />}

      {orderState?.stage !== "confirmed" && (
        <div className="border-t border-border bg-card px-3 py-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="min-h-[44px] max-h-28 resize-none rounded-2xl border-border bg-background text-sm focus-visible:ring-1 focus-visible:ring-primary"
              rows={1}
              disabled={isSending || !sessionId}
              data-testid="input-chat-message"
            />
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || isSending || !sessionId}
              data-testid="button-send-message"
              className="flex-shrink-0 rounded-full"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {orderState?.stage === "confirmed" && (
        <div className="border-t border-border bg-card px-4 py-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-sm font-semibold text-foreground">Your order is placed!</p>
              <p className="text-xs text-muted-foreground mt-0.5">See you at the counter.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              data-testid="button-new-order"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Start New Order
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
