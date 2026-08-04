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
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { caller_uuid, target_uuid, type } = body;

    if (!caller_uuid || !target_uuid) {
      return new Response(JSON.stringify({ error: "Missing Call Routing Parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    const ids = [caller_uuid, target_uuid].join(",");
    
    const verifyResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=in.(${ids})&select=id,user_data`, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!verifyResponse.ok) {
      return new Response(JSON.stringify({ error: "Verification Pipeline Interrupted" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const profiles = await verifyResponse.json();
    if (profiles.length < 2 && caller_uuid !== target_uuid) {
      return new Response(JSON.stringify({ error: "One or more entities are offline or unregistered" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const channelIdentity = `signaling_${Math.min(caller_uuid.hashCode || 0, target_uuid.hashCode || 0)}_${Math.max(caller_uuid.hashCode || 0, target_uuid.hashCode || 0)}`;

    return new Response(JSON.stringify({
      status: "ready",
      channel_id: channelIdentity,
      connection_endpoint: `${supabaseUrl}/rest/v1/signaling_channels`,
      realtime_bridge_url: `${supabaseUrl.replace("http", "ws")}/realtime/v1/websocket`,
      routing_metadata: {
        stream_type: type || "audio",
        handshake_isolated_flag: true
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};