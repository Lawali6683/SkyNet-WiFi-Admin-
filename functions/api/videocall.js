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

    const { initiator_uuid, target_uuid, sdp_payload, ice_candidate } = body;

    if (!initiator_uuid || !target_uuid) {
      return new Response(JSON.stringify({ error: "Missing Peer Coordinates" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${initiator_uuid}`, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!profileResponse.ok) {
      return new Response(JSON.stringify({ error: "Database Link Fault" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const records = await profileResponse.json();
    if (!records || records.length === 0) {
      return new Response(JSON.stringify({ error: "Initiator Record Disappeared" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userData = records[0].user_data || {};
    const isEnabled = userData.video_call_enabled === "yes";
    const expiryDateString = userData.video_call_expiry;
    const hasNotExpired = expiryDateString ? new Date(expiryDateString) > new Date() : false;

    if (!isEnabled || !hasNotExpired) {
      return new Response(JSON.stringify({ error: "Premium Subscription Dead Or Expired" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const channelIdentity = `signaling_${Math.min(initiator_uuid.hashCode || 0, target_uuid.hashCode || 0)}_${Math.max(initiator_uuid.hashCode || 0, target_uuid.hashCode || 0)}`;

    if (sdp_payload || ice_candidate) {
      await fetch(`${supabaseUrl}/rest/v1/signaling_channels`, {
        method: "POST",
        headers: {
          "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          channel_id: channelIdentity,
          sender_id: initiator_uuid,
          receiver_id: target_uuid,
          sdp: sdp_payload || null,
          ice: ice_candidate || null,
          bandwidth_ceiling_kbps: 1000,
          timestamp: new Date().toISOString()
        })
      });
    }

    return new Response(JSON.stringify({
      status: "relayed",
      channel_id: channelIdentity,
      bandwidth_limit: "1Mbps",
      qos_parameters: { noise_suppression: true, echo_cancellation: true }
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};