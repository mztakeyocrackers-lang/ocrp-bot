const OCRP_SUPABASE_URL = process.env.OCRP_SUPABASE_URL || process.env.SUPABASE_URL || '';
const OCRP_SUPABASE_SERVICE_ROLE_KEY = process.env.OCRP_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function ensureDbConfig() {
  if (!OCRP_SUPABASE_URL || !OCRP_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing OCRP_SUPABASE_URL or OCRP_SUPABASE_SERVICE_ROLE_KEY in the OCRP bot environment.');
  }
}

function appendQuery(params, query = {}) {
  for (const [key, rawValue] of Object.entries(query || {})) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        params.append(key, String(value));
      }
      continue;
    }

    params.set(key, String(rawValue));
  }

  return params;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(method, table, { query, body, headers = {} } = {}) {
  ensureDbConfig();

  const url = new URL(`${OCRP_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`);
  appendQuery(url.searchParams, query);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      apikey: OCRP_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${OCRP_SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await parseResponse(response);
  if (!response.ok) {
    const message = data?.message || data?.error || data?.hint || `${method} ${table} failed (${response.status}).`;
    throw new Error(message);
  }

  return data;
}

async function selectRows(table, query = {}) {
  return request('GET', table, { query });
}

async function selectSingleRow(table, query = {}) {
  const rows = await selectRows(table, { ...query, limit: 1 });
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

async function insertRows(table, payload, { returning = 'representation' } = {}) {
  return request('POST', table, {
    body: payload,
    headers: {
      Prefer: `return=${returning}`,
    },
  });
}

async function upsertRows(table, payload, { onConflict, returning = 'representation' } = {}) {
  const headers = {
    Prefer: `resolution=merge-duplicates,return=${returning}`,
  };

  if (onConflict) {
    return request('POST', table, {
      query: { on_conflict: onConflict },
      body: payload,
      headers,
    });
  }

  return request('POST', table, {
    body: payload,
    headers,
  });
}

async function updateRows(table, payload, query = {}) {
  return request('PATCH', table, {
    body: payload,
    query,
    headers: {
      Prefer: 'return=representation',
    },
  });
}

module.exports = {
  insertRows,
  selectRows,
  selectSingleRow,
  updateRows,
  upsertRows,
};
