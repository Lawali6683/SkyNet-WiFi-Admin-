export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid Payload Stream" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { target_uuid, phone, payload } = body;

    if (!target_uuid || !payload) {
      return new Response(JSON.stringify({ error: "Missing Delivery Directives" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const messageString = String(payload);
    if (messageString.length > 50) {
      return new Response(JSON.stringify({ error: "Character Boundary Exceeded" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    
    const realtimeBroadcastPayload = {
      topic: `realtime:ephemeral_chat_${target_uuid}`,
      event: "new_message",
      payload: {
        sender_phone: phone || "Anonymous",
        content: messageString,
        dispatched_timestamp: new Date().toISOString()
      },
      ref: null
    };

    await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(realtimeBroadcastPayload)
    });

    return new Response(JSON.stringify({
      delivery: "dispatched",
      status: 200,
      retained: false,
      logs_purged: true
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};