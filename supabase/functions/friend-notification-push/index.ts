// Database Webhook target for INSERT on public.friend_notifications.
// Deploy with JWT verification disabled; this handler authenticates the
// dedicated webhook secret and reads the notification again from Postgres.
import { createClient } from 'npm:@supabase/supabase-js@2';

type WebhookPayload = {
  type?: string;
  schema?: string;
  table?: string;
  record?: { id?: unknown };
};

type ClaimedPush = {
  id: string;
  kind: 'friend_request' | 'friend_accepted';
  actor_nickname: string;
  source_request_id: string;
  tokens: { token: string; platform: 'ios' | 'android' }[];
};

type ExpoTicket = {
  status?: string;
  details?: { error?: string };
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function equalSecret(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const webhookSecret = Deno.env.get('FRIEND_NOTIFICATIONS_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!webhookSecret || !supabaseUrl || !serviceKey) {
    return json(503, { error: 'server_not_configured' });
  }
  if (!equalSecret(request.headers.get('x-webhook-secret'), webhookSecret)) {
    return json(401, { error: 'unauthorized' });
  }

  let webhook: WebhookPayload;
  try {
    const raw = await request.text();
    if (raw.length > 32_768) return json(413, { error: 'payload_too_large' });
    webhook = JSON.parse(raw) as WebhookPayload;
  } catch {
    return json(400, { error: 'invalid_payload' });
  }
  const notificationId = webhook.record?.id;
  if (webhook.type !== 'INSERT' || webhook.schema !== 'public' ||
      webhook.table !== 'friend_notifications' ||
      typeof notificationId !== 'string' || !uuidPattern.test(notificationId)) {
    return json(400, { error: 'invalid_event' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.rpc('claim_friend_notification_push', {
    notification_id: notificationId,
  });
  if (error) return json(500, { error: 'claim_failed' });
  if (!data) return json(200, { attempted: false, reason: 'already_claimed_or_missing' });

  const push = data as ClaimedPush;
  if (!Array.isArray(push.tokens) || push.tokens.length === 0) {
    return json(200, { attempted: true, deviceCount: 0 });
  }

  const title = push.kind === 'friend_request' ? '친구 요청' : '친구가 되었어요';
  const body = push.kind === 'friend_request'
    ? `${push.actor_nickname}님이 친구 요청을 보냈어요.`
    : `${push.actor_nickname}님이 친구 요청을 수락했어요.`;
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;
  let accepted = 0;
  let failed = 0;

  // The database claim happens before any network call. A replay cannot send
  // the same notification again, including after a timeout with unknown result.
  for (let start = 0; start < push.tokens.length; start += 100) {
    const devices = push.tokens.slice(start, start + 100);
    const messages = devices.map((device) => ({
      to: device.token,
      title,
      body,
      sound: 'default',
      ...(device.platform === 'android' ? { channelId: 'friend-updates' } : {}),
      data: {
        notificationId: push.id,
        kind: push.kind,
        sourceRequestId: push.source_request_id,
      },
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) { failed += devices.length; continue; }
      const payload = await response.json() as { data?: ExpoTicket[] };
      const tickets = Array.isArray(payload.data) ? payload.data : [];
      for (let i = 0; i < devices.length; i++) {
        const ticket = tickets[i];
        if (ticket?.status === 'ok') accepted++;
        else failed++;
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          await admin.from('user_devices').update({ disabled_at: new Date().toISOString() })
            .eq('push_token', devices[i].token);
        }
      }
    } catch {
      failed += devices.length;
    }
  }
  // Counts are safe to expose to the webhook caller; tokens and Expo errors are not.
  return json(200, { attempted: true, deviceCount: push.tokens.length, accepted, failed });
});
