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

    const { uuid } = body;
    if (!uuid) {
      return new Response(JSON.stringify({ error: "Missing Accountability Parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${uuid}`, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!profileResponse.ok) {
      return new Response(JSON.stringify({ error: "Ledger Engine Offline" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const records = await profileResponse.json();
    if (!records || records.length === 0) {
      return new Response(JSON.stringify({ error: "Identity Trace Failed" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userProfile = records[0];
    const currentBalance = parseFloat(userProfile.wallet_balance || 0);

    if (currentBalance < 3000) {
      return new Response(JSON.stringify({ error: "Insufficient Wallet Balance" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const newBalance = currentBalance - 3000;
    const userData = { ...userProfile.user_data };
    
    const executionMoment = new Date();
    executionMoment.setDate(executionMoment.getDate() + 30);
    const expiryTimestamp = executionMoment.toISOString();

    userData.video_call_enabled = "yes";
    userData.video_call_expiry = expiryTimestamp;
    userData.video_plan_days = 30;

    const patchResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${uuid}`, {
      method: "PATCH",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet_balance: newBalance,
        user_data: userData
      })
    });

    if (!patchResponse.ok) {
      return new Response(JSON.stringify({ error: "Atomic Asset Mutation Rolled Back" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      new_balance: newBalance,
      video_call_enabled: "yes",
      video_call_expiry: expiryTimestamp,
      message: "Premium Video Plan Provisions Initialized Safely."
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};