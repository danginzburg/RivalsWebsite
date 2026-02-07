import { supabaseAdmin } from '$lib/supabase/admin'

type AdminAuditPayload = {
  adminProfileId: string
  actionType: string
  targetTable?: string | null
  targetId?: string | null
  details?: Record<string, unknown>
}

export async function logAdminAction(payload: AdminAuditPayload) {
  const { error } = await supabaseAdmin.from('admin_actions').insert({
    admin_profile_id: payload.adminProfileId,
    action_type: payload.actionType,
    target_table: payload.targetTable ?? null,
    target_id: payload.targetId ?? null,
    details: payload.details ?? {},
  })

  if (error) {
    console.error('Failed to write admin action audit log:', error)
  }
}
