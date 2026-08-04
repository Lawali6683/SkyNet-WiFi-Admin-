export default {
  async fetch(request, env) {
    await this.processLifecycleAudit(env);
    return new Response(JSON.stringify({ execution: "triggered", status: "complete" }), {
      headers: { "Content-Type": "application/json" }
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.processLifecycleAudit(env));
  },

  async processLifecycleAudit(env) {
    const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    
    const fetchResponse = await fetch(`${supabaseUrl}/rest/v1/user_profiles`, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!fetchResponse.ok) return;

    const records = await fetchResponse.json();
    const currentTime = new Date();

    for (const record of records) {
      if (!record.user_data) continue;
      const userData = { ...record.user_data };

      if (userData.video_call_enabled === "yes") {
        const expiryTime = userData.video_call_expiry ? new Date(userData.video_call_expiry) : null;
        
        if (!expiryTime || currentTime > expiryTime) {
          userData.video_call_enabled = "no";
          userData.video_plan_days = 0;

          await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${record.id}`, {
            method: "PATCH",
            headers: {
              "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
              "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ user_data: userData })
          });

          const broadcastPayload = {
            topic: `realtime:lifecycle_${record.id}`,
            event: "plan_expired",
            payload: { video_call_enabled: "no", video_plan_days: 0 },
            ref: null
          };

          await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
            method: "POST",
            headers: {
              "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
              "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(broadcastPayload)
          });
        }
      }
    }
  }
};