type SignupUserSummary = {
  identities?: unknown[] | null;
};

/** Supabase returns an obfuscated user with no identities for an existing account. */
export const isDuplicateSignupResponse = (user: SignupUserSummary | null | undefined): boolean =>
  Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);

export const hasVerifiedEmailForApp = (user: {
  email?: string | null;
  email_confirmed_at?: string | null;
} | null | undefined): boolean =>
  Boolean(user && (!user.email || user.email_confirmed_at));
