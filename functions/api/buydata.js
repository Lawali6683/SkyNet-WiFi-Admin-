export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON Payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { uuid, ip_address, plan_type, selected_value, is_windows_client } = payload;

    if (!uuid || !ip_address || !plan_type || !selected_value) {
      return new Response(JSON.stringify({ error: "Missing Required Parameters" }), {
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
      return new Response(JSON.stringify({ error: "Database Cluster Unreachable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const records = await profileResponse.json();
    if (!records || records.length === 0) {
      return new Response(JSON.stringify({ error: "User Profile Node Not Found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userProfile = records[0];
    const userData = { ...userProfile.user_data };
    let currentWalletBalance = parseFloat(userProfile.wallet_balance || 0);

    let priceCost = 0;
    let volumeAllocationValue = 0.0;
    let plan2ValidityDays = 0;
    let plan2SpeedLimit = "";

    if (plan_type === "plan1") {
      if (selected_value === "500 MB") {
        priceCost = 100;
        volumeAllocationValue = 0.5;
      } else if (selected_value === "1 GB") {
        priceCost = 150;
        volumeAllocationValue = 1.0;
      } else if (selected_value === "5 GB") {
        priceCost = 1000;
        volumeAllocationValue = 5.0;
      } else if (selected_value === "10 GB") {
        priceCost = 1800;
        volumeAllocationValue = 10.0;
      } else if (selected_value === "20 GB") {
        priceCost = 3200;
        volumeAllocationValue = 20.0;
      } else if (selected_value.startsWith("custom_")) {
        const customParts = selected_value.split("_");
        const customGb = parseInt(customParts[1]);
        if (isNaN(customGb) || customGb <= 0) {
          return new Response(JSON.stringify({ error: "Invalid Custom Volume Allocation Metric" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        priceCost = customGb * 150;
        volumeAllocationValue = parseFloat(customGb.toFixed(2));
      } else {
        return new Response(JSON.stringify({ error: "Unknown Volume Selection Asset" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    } else if (plan_type === "plan2") {
      const plan2Catalog = {
        "plan_2_1": { price: 200, days: 2, speed: "9 Mbps" },
        "plan_2_2": { price: 500, days: 3, speed: "10 Mbps" },
        "plan_2_3": { price: 1000, days: 3, speed: "20 Mbps" },
        "plan_2_4": { price: 1000, days: 7, speed: "10 Mbps" },
        "plan_2_5": { price: 3000, days: 7, speed: "30 Mbps" },
        "plan_2_6": { price: 5000, days: 7, speed: "50 Mbps" },
        "plan_2_7": { price: 8000, days: 30, speed: "20 Mbps" },
        "plan_2_8": { price: 15000, days: 30, speed: "50+ Mbps" },
        "plan_2_9": { price: 25000, days: 30, speed: "80+ Mbps" },
        "plan_2_10": { price: 35000, days: 30, speed: "100+ Mbps" }
      };

      const selectedPlan = plan2Catalog[selected_value];
      if (!selectedPlan) {
        return new Response(JSON.stringify({ error: "Invalid Speed Profile Identity Configuration" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      priceCost = selectedPlan.price;
      plan2ValidityDays = selectedPlan.days;
      plan2SpeedLimit = selectedPlan.speed;
    } else {
      return new Response(JSON.stringify({ error: "Unsupported Pipeline Routing Target" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (currentWalletBalance < priceCost) {
      return new Response(JSON.stringify({ error: "Purchase Failed! Your wallet balance is insufficient." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const newWalletBalance = currentWalletBalance - priceCost;
    userData.last_connected_ip = ip_address;

    if (is_windows_client === true || is_windows_client === "true") {
      userData.station_routing_flags = "hotspot_distribution_master_node";
    }

    let dynamicCompletionMessage = "";

    if (plan_type === "plan1") {
      let activeBalance = parseFloat(userData.data_balance || 0);
      activeBalance += volumeAllocationValue;
      userData.data_balance = parseFloat(activeBalance.toFixed(2));
      userData.plan1_active = "yes";
      
      dynamicCompletionMessage = `Successfully loaded ${volumeAllocationValue} GB High Speed Volume Block onto node interface.`;
    } else if (plan_type === "plan2") {
      let activeDays = parseInt(userData.plan2_remaining_days || 0);
      activeDays += plan2ValidityDays;
      userData.plan2_remaining_days = activeDays;
      userData.speed_capping_limit = plan2SpeedLimit;
      userData.plan2_active = "yes";
      
      dynamicCompletionMessage = `Successfully mapped performance profile ${plan2SpeedLimit} with an added validity metric of ${plan2ValidityDays} Days.`;
    }

    const mutationResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${uuid}`, {
      method: "PATCH",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet_balance: newWalletBalance,
        user_data: userData
      })
    });

    if (!mutationResponse.ok) {
      return new Response(JSON.stringify({ error: "Atomic Balance Ledger Transaction Mutation Blocked" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      new_balance: newWalletBalance,
      added_value: plan_type === "plan1" ? volumeAllocationValue : null,
      new_days_validity: plan_type === "plan2" ? userData.plan2_remaining_days : null,
      message: dynamicCompletionMessage
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};