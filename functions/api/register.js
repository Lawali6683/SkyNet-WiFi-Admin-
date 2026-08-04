export default {
  async fetch(request, env, ctx) {
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
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!payload || payload.api_secret !== "@haruna66") {
      return new Response(JSON.stringify({ error: "Unauthorized secure asset key access" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const {
      email,
      password,
      full_name,
      phone_number,
      pin,
      device_uuid,
      device_mac,
      referral_by,
      profile_url,
      my_plan_2
    } = payload;

    const baseSupabaseUrl = env.SUPABASE_URL.replace("/rest/v1/", "").replace(/\/$/, "");

    const signUpResponse = await fetch(`${baseSupabaseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    if (!signUpResponse.ok) {
      const errLog = await signUpResponse.text();
      return new Response(JSON.stringify({ error: `Supabase authentication initialization failed: ${errLog}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const signUpData = await signUpResponse.json();
    const authId = signUpData.id;

    const rollbackUser = async () => {
      await fetch(`${baseSupabaseUrl}/auth/v1/admin/users/${authId}`, {
        method: "DELETE",
        headers: {
          "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
    };

    let monnifyToken;
    try {
      const monnifyAuth = btoa(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`);
      const loginRes = await fetch("https://sandbox.monnify.com/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${monnifyAuth}`,
          "Content-Type": "application/json"
        }
      });
      const loginData = await loginRes.json();
      monnifyToken = loginData.responseBody?.accessToken;
      if (!monnifyToken) throw new Error("Token allocation failure");
    } catch (e) {
      await rollbackUser();
      return new Response(JSON.stringify({ error: "Banking gateway authentication failure. Core setup rolled back." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    let accountDetails;
    try {
      const accountRes = await fetch("https://sandbox.monnify.com/api/v1/bank-transfer/reserved-accounts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${monnifyToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accountReference: `SNW-${authId}-${Date.now()}`,
          accountName: full_name,
          currencyCode: "NGN",
          contractCode: env.MONNIFY_CONTRACT_CODE,
          customerEmail: email,
          customerName: full_name,
          getAllAvailableBanks: true
        })
      });

      const accountData = await accountRes.json();
      if (!accountData.requestSuccessful || !accountData.responseBody?.accounts?.length) {
        throw new Error("Account provisioning failure");
      }
      accountDetails = accountData.responseBody;
    } catch (e) {
      await rollbackUser();
      return new Response(JSON.stringify({ error: "Virtual ledger generation failed. Core setup rolled back." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const selectedBank = accountDetails.accounts.find(acc => acc.bankCode === "035") || accountDetails.accounts[0];
    const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const memberCode = `SNW/4/${randomSuffix}`;
    const ipAddress = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    
    const city = request.cf?.city || "";
    const region = request.cf?.region || "";
    const country = request.cf?.country || "";
    const locationAddress = `${city}${city && region ? ", " : ""}${region}${(city || region) && country ? ", " : ""}${country}` || "Unknown Geolocation";

    const userProfileRecord = {
      id: authId,
      user_data: {
        full_name,
        phone_number,
        email_address: email,
        referral_code: referralCode,
        referral_link: `https://skynetwifi.pages.dev/ref=${referralCode}`,
        pin,
        device_uuid,
        device_mac,
        ip_address: ipAddress,
        location_address: locationAddress,
        bpn_config: {},
        register_date: new Date().toISOString(),
        referral_by: referralBy || "",
        balance: 0.00,
        video_call: "no",
        call: "yes",
        account_number: selectedBank.accountNumber,
        bank_name: selectedBank.bankName,
        account_name: selectedBank.accountName,
        member_code: memberCode,
        monnify_id: accountDetails.accountReference,
        plan2_remaining_days: 0,
        data_balance: 0.00,
        plan1_active: "no",
        plan2_active: "no",
        login_status: "yes",
        online_status: "on",
        message: "Pipeline account generated successfully.",
        profile_url: profileUrl || "",
        my_plan_2: myPlan2 || ""
      }
    };

    const dbResponse = await fetch(`${baseSupabaseUrl}/rest/v1/user_profiles`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(userProfileRecord)
    });

    if (!dbResponse.ok) {
      await rollbackUser();
      return new Response(JSON.stringify({ error: "Storage allocation exception error. Core setup rolled back." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    ctx.waitUntil(
      fetch("https://skynetwifi.pages.dev/api/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, full_name })
      }).catch(() => {})
    );

    return new Response(JSON.stringify({
      status: "success",
      message: "Security node account registered and verified successfully.",
      account_number: selectedBank.accountNumber,
      bank_name: selectedBank.bankName,
      member_code: memberCode
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};