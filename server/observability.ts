import { createClient } from "@supabase/supabase-js";

export interface ConversationLogEntry {
  user_id: string;
  session_id: string;
  prompt: string;
  response: string;
  latency_ms: number;
  tools_used: string[];
  validation_passed: boolean;
}

export function logConversation(entry: ConversationLogEntry): void {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  supabase
    .from("conversation_logs")
    .insert({
      user_id: entry.user_id,
      session_id: entry.session_id,
      prompt: entry.prompt,
      response: entry.response,
      latency_ms: entry.latency_ms,
      tools_used: entry.tools_used,
      validation_passed: entry.validation_passed,
      created_at: new Date().toISOString(),
    })
    .then(({ error }) => {
      if (error) {
        console.warn("[observability] Supabase log failed:", error.message);
      }
    });
}
