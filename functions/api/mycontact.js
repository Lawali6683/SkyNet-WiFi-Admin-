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

    const { phones } = body;
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return new Response(JSON.stringify({ registered: [], unregistered: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const cleanedPhones = phones.map(p => {
      const cleaned = String(p).replace(/\D/g, "");
      return p.toString().startsWith("+") ? `+${cleaned}` : cleaned;
    }).filter(p => p.length > 0);

    if (cleanedPhones.length === 0) {
      return new Response(JSON.stringify({ registered: [], unregistered: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    const queryParams = new URLSearchParams({
      phone_number: `in.(${cleanedPhones.join(",")})`,
      select: "id,phone_number,display_name,profile_url"
    });

    const dbResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?${queryParams.toString()}`, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!dbResponse.ok) {
      return new Response(JSON.stringify({ error: "Data Layer Connection Interrupted" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const dbRecords = await dbResponse.json();
    const matchedPhones = new Set(dbRecords.map(r => r.phone_number));

    const encoder = new TextEncoder();
    const keyData = encoder.encode(env.SUPABASE_SERVICE_ROLE_KEY);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"]
    );

    const registered = [];
    for (const record of dbRecords) {
      const msgData = encoder.encode(record.id);
      const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
      const signatureArray = Array.from(new Uint8Array(signatureBuffer));
      const communicationToken = signatureArray.map(b => b.toString(16).padStart(2, "0")).join("");

      const rawPhone = record.phone_number || "";
      const maskedPhone = rawPhone.length > 7 
        ? `${rawPhone.substring(0, 4)}***${rawPhone.substring(rawPhone.length - 3)}`
        : "***";

      registered.push({
        uuid: record.id,
        profile_url: record.profile_url || "",
        local_contact_name: record.display_name || "SkyNet Member",
        phone_number: record.phone_number,
        masked_phone: maskedPhone,
        routing_token: communicationToken
      });
    }

    const unregistered = phones
      .filter(p => !matchedPhones.has(p))
      .map(p => ({
        local_contact_name: "External Contact",
        phone_number: p
      }));

    return new Response(JSON.stringify({ registered, unregistered }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};