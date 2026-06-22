export async function onRequest(context) {
  const { request, env } = context;
  const allowedOrigins = [
    'https://skynetwifiadmin.pages.dev',
    'http://localhost:8080'
  ];
  const origin = request.headers.get('Origin');
  let currentOrigin = allowedOrigins[0];
  if (origin) {
    const normalizedOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.map(o => o.replace(/\/$/, '')).includes(normalizedOrigin)) {
      currentOrigin = origin;
    } else {
      if (request.method !== 'OPTIONS') {
        return new Response(JSON.stringify({ message: 'Forbidden Origin' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  }
  const corsHeaders = {
    'Access-Control-Allow-Origin': currentOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Password',
    'Access-Control-Max-Age': '86400',
  };
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  try {
    const inboundPassword = request.headers.get('X-API-Password');
    if (!inboundPassword || inboundPassword !== env.API_PASSWORD) {
      return new Response(JSON.stringify({ message: 'Unauthorized Access' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const body = await request.json();
    if (!body.plan_1 || !body.plan_2) {
      return new Response(JSON.stringify({ message: 'Invalid Bad Request Data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const flattenedPayload = [];
    flattenedPayload.push({
      id: 'plan_1',
      plan_data: {
        plan_name: 'Plan 1',
        price: parseInt(body.plan_1.price),
        validity: 'Unlimited',
        speed: 'Standard',
        limitation: 'Changeable Base Plan'
      }
    });
    body.plan_2.forEach(item => {
      flattenedPayload.push({
        id: `plan_2_${item.sn}`,
        plan_data: {
          plan_name: item.plan,
          price: parseInt(item.price),
          validity: item.validity,
          speed: item.speed,
          limitation: item.limitation
        }
      });
    });
    let supabaseUrl = env.SUPABASE_URL.replace(/\/$/, '');
    if (!supabaseUrl.endsWith('/rest/v1')) {
      supabaseUrl += '/rest/v1';
    }
    const targetUrl = `${supabaseUrl}/pricing_plans?on_conflict=id`;
    const supabaseResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(flattenedPayload)
    });
    if (!supabaseResponse.ok) {
      const errorData = await supabaseResponse.text();
      let parsedError;
      try {
        parsedError = JSON.parse(errorData);
      } catch (e) {
        parsedError = errorData;
      }
      return new Response(JSON.stringify({ message: 'Supabase Sync Failed', details: parsedError }), {
        status: supabaseResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ message: 'Success' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: 'Server internal Error', error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
