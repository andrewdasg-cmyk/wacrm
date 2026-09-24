import { ForbiddenError, requireRole, type AccountContext } from '@/lib/auth/account'

// ============================================================
// Access to the VELIO agent's audit queue (tables agente_*).
//
// The agente_* tables live in this CRM's Supabase project but are not
// account-scoped (RLS on, no policies: service role only), and they carry
// customer names, phones and addresses. So the API routes read them with
// the service role and gate on TWO things:
//
//   1. role admin or higher in the CRM, and
//   2. the caller's account is the one in AGENTE_ACCOUNT_ID.
//
// Signup is open, so (2) is what keeps another account's owner out.
// Without AGENTE_ACCOUNT_ID set, nobody gets in.
// ============================================================

export async function requireAgenteAccess(): Promise<AccountContext> {
  const ctx = await requireRole('admin')
  const allowed = process.env.AGENTE_ACCOUNT_ID
  if (!allowed || ctx.accountId !== allowed) {
    throw new ForbiddenError('This account has no access to the agent audit')
  }
  return ctx
}

export const ESTADOS_ABIERTOS = ['pendiente', 'con_nota', 'aprobado', 'enviando', 'error'] as const
