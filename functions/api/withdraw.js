export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ success: false, message: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    try {
      const payload = await request.json();
      const { action } = payload;

      if (action === "validate") {
        return await handleAccountValidation(payload, env);
      } else if (action === "payout") {
        return await handleBalancePayout(payload, env);
      } else {
        return new Response(JSON.stringify({ success: false, message: "Invalid system action parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }
};

async function getMonnifyAccessToken(env) {
  const tokenCredentials = btoa(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`);
  const response = await fetch(`${env.MONNIFY_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${tokenCredentials}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Failed authentication against Monnify engine");
  }

  const result = await response.json();
  return result.responseBody.accessToken;
}

async function handleAccountValidation(payload, env) {
  const { account_number, bank_code } = payload;

  if (!account_number || !bank_code) {
    return new Response(JSON.stringify({ success: false, message: "Missing tracking account validation attributes" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const accessToken = await getMonnifyAccessToken(env);
    const queryUrl = `${env.MONNIFY_BASE_URL}/api/v1/disbursements/account-validate?accountNumber=${account_number}&bankCode=${bank_code}`;
    
    const response = await fetch(queryUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    const result = await response.json();

    if (response.ok && result.requestSuccessful === true) {
      return new Response(JSON.stringify({
        success: true,
        account_name: result.responseBody.accountName
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        message: result.responseMessage || "Validation verification refused"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

async function handleBalancePayout(payload, env) {
  const { uuid, ip_address, account_number, bank_code, amount } = payload;

  if (!uuid || !account_number || !bank_code || !amount) {
    return new Response(JSON.stringify({ success: false, message: "Malformed pipeline transaction variables" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const requestAmount = parseFloat(amount);
  const calculatedFee = requestAmount * 0.01;
  const directTotalCost = requestAmount + calculatedFee;

  try {
    const supabaseProfileUrl = `${env.SUPABASE_URL}/rest/v1/profiles?uuid=eq.${uuid}&select=profile_data`;
    const userFetchResponse = await fetch(supabaseProfileUrl, {
      method: "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!userFetchResponse.ok) {
      throw new Error("Target core user profiles record missing or offline");
    }

    const userData = await userFetchResponse.json();
    if (userData.length === 0) {
      return new Response(JSON.stringify({ success: false, message: "Target account node reference untraceable" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    let profileData = userData[0].profile_data || {};
    let currentWalletBalance = parseFloat(profileData.wallet_balance || 0);

    if (directTotalCost > currentWalletBalance) {
      return new Response(JSON.stringify({ success: false, message: "Insufficient network ledger liquidity limits available" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const accessToken = await getMonnifyAccessToken(env);
    const uniqueReference = `TX-${uuid.toUpperCase()}-${Date.now()}`;

    const payoutResponse = await fetch(`${env.MONNIFY_BASE_URL}/api/v1/disbursements/single`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: requestAmount,
        reference: uniqueReference,
        narration: "SkyNet System Settlement Allocation",
        destinationBankCode: bank_code,
        destinationAccountNumber: account_number,
        currency: "NGN",
        sourceWalletNumber: env.MONNIFY_CONTRACT_CODE
      })
    });

    const payoutResult = await payoutResponse.json();

    if (!payoutResponse.ok || payoutResult.requestSuccessful !== true) {
      return new Response(JSON.stringify({ success: false, message: "Network issue. Please try again later." }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    profileData.wallet_balance = currentWalletBalance - directTotalCost;

    let historyArray = Array.isArray(profileData.transmission) ? profileData.transmission : [];
    
    const newTransactionNode = {
      id: uniqueReference,
      amount: requestAmount,
      dynamic_fee: calculatedFee,
      status: "success",
      direction: "withdrawal",
      ip: ip_address,
      timestamp: new Date().toISOString()
    };

    historyArray.push(newTransactionNode);

    let withdrawals = historyArray.filter(item => item.direction === "withdrawal");
    let deposits = historyArray.filter(item => item.direction === "deposit");
    let nonFiltered = historyArray.filter(item => item.direction !== "withdrawal" && item.direction !== "deposit");

    if (withdrawals.length > 3) {
      withdrawals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      while (withdrawals.length > 3) {
        withdrawals.shift();
      }
    }

    if (deposits.length > 4) {
      deposits.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      while (deposits.length > 4) {
        deposits.shift();
      }
    }

    profileData.transmission = [...nonFiltered, ...withdrawals, ...deposits];

    const supabaseUpdateUrl = `${env.SUPABASE_URL}/rest/v1/profiles?uuid=eq.${uuid}`;
    const commitResponse = await fetch(supabaseUpdateUrl, {
      method: "PATCH",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ profile_data: profileData })
    });

    if (!commitResponse.ok) {
      throw new Error("Critical synchronization fault with backplane state store");
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Settlement successfully dispatched and processed."
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: "Network issue. Please try again later." }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}