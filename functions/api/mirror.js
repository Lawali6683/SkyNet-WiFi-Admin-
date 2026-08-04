export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
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

    const { id, consumed_delta, api_secret, device_uuid } = payload;

    if (api_secret !== "@haruna66") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!id || consumed_delta === undefined) {
      return new Response(JSON.stringify({ error: "Missing Operational Metrics" }), {
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
      return new Response(JSON.stringify({ error: "Database Fetch Core Exception" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const records = await profileResponse.json();
    if (!records || records.length === 0) {
      return new Response(JSON.stringify({ error: "Identity Target Mismatch" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const userProfile = records[0];
    const userData = { ...userProfile.user_data };

    if (device_uuid && userData.device_uuid && userData.device_uuid !== device_uuid) {
      userData.plan1_active = "no";
      userData.plan2_active = "no";
      userData.data_balance = 0.00;
      userData.online_status = "off";
      userData.message = "Fraud Flagged: Device Hardware Signature Spoofing Detected.";

      await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ user_data: userData })
      });

      return new Response(JSON.stringify({ status: "terminated", Action: "Sever Tunnel Immediately" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const deltaBytes = parseInt(consumed_delta);
    const deltaMB = deltaBytes / (1024 * 1024);

    if (deltaMB > 150.0) {
      userData.plan1_active = "no";
      userData.plan2_active = "no";
      userData.data_balance = 0.00;
      userData.online_status = "off";
      userData.message = "Fraud Flagged: Abnormal Delta Consumption Spikes Detected.";

      await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ user_data: userData })
      });

      return new Response(JSON.stringify({ status: "terminated", Action: "Sever Tunnel Immediately" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    let currentBalance = parseFloat(userData.data_balance || 0);
    currentBalance = currentBalance - deltaMB;

    if (currentBalance <= 0.00) {
      currentBalance = 0.00;
      userData.plan1_active = "no";
      userData.plan2_active = "no";
      userData.online_status = "off";
    }

    if (parseInt(userData.plan2_remaining_days || 0) <= 0) {
      userData.plan2_active = "no";
      userData.plan2_remaining_days = 0;
    }

    userData.data_balance = currentBalance;

    const updateResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ user_data: userData })
    });

    if (!updateResponse.ok) {
      return new Response(JSON.stringify({ error: "Database Allocation Modification Failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      status: "success",
      data_balance: currentBalance,
      plan1_active: userData.plan1_active,
      plan2_active: userData.plan2_active,
      plan2_remaining_days: userData.plan2_remaining_days
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  },

  async scheduled(event, env, ctx) {
    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    
    const fetchActiveResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles`, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!fetchActiveResponse.ok) return;

    const records = await fetchActiveResponse.json();
    for (const record of records) {
      if (!record.user_data) continue;
      const userData = { ...record.user_data };
      let modified = false;

      if (userData.plan2_active === "yes") {
        let remainingDays = parseInt(userData.plan2_remaining_days || 0);
        if (remainingDays <= 0) {
          userData.plan2_active = "no";
          userData.plan2_remaining_days = 0;
          modified = true;
        }
      }

      if (parseFloat(userData.data_balance || 0) <= 0.00 && (userData.plan1_active === "yes" || userData.plan2_active === "yes")) {
        userData.plan1_active = "no";
        userData.plan2_active = "no";
        userData.data_balance = 0.00;
        modified = true;
      }

      if (modified) {
        await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${record.id}`, {
          method: "PATCH",
          headers: {
            "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ user_data: userData })
        });
      }
    }
  }
};