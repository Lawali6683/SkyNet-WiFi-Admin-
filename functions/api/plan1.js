export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 45,
        headers: { "Content-Type": "application/json" }
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { id, device_uuid, api_secret } = payload;

    if (api_secret !== "@haruna66" && request.headers.get("X-API-Secret") !== "@haruna66") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!id || !device_uuid) {
      return new Response(JSON.stringify({ error: "Missing Parameters" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${id}`, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!profileResponse.ok) {
      return new Response(JSON.stringify({ error: "Database Connection Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const records = await profileResponse.json();
    if (!records || records.length === 0) {
      return new Response(JSON.stringify({ error: "User Profile Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const userProfile = records[0];
    const userData = userProfile.user_data || {};

    if (userData.plan1_active !== "yes" || parseFloat(userData.data_balance || 0) <= 0) {
      return new Response(JSON.stringify({ error: "Plan 1 Inactive or Data Balance Exhausted" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    const encoder = new TextEncoder();
    const keyData = encoder.encode(env.PLAN1_BPN_IP || "10.0.0.1");
    const messageData = encoder.encode(`${id}:${device_uuid}`);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const ephemeralToken = signatureArray.map(b => b.toString(16).padStart(2, "0")).join("");

    return new Response(JSON.stringify({
      status: "granted",
      profile_tier: "Plan 1 Uncapped",
      endpoint_ip: env.PLAN1_BPN_IP || "10.0.0.1",
      handshake_token: ephemeralToken,
      dns_server: "1.1.1.1",
      allowed_ips: "0.0.0.0/0"
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};