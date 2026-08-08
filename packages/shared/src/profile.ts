import { z } from "zod";

export const CONSENT_VERSION = "2026-08-08";

export const ConsentStateSchema = z.enum(["pending", "accepted", "revoked"]);
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const UserProfileSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  timezone: z.string().min(1),
  consentVersion: z.string().min(1),
  consentState: ConsentStateSchema,
  consentedAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true })
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export function createDefaultUserProfile(timezone: string): UserProfile {
  const now = new Date().toISOString();
  return {
    id: "demo-user",
    timezone,
    consentVersion: CONSENT_VERSION,
    consentState: "pending",
    updatedAt: now
  };
}

export function markConsentAccepted(profile: UserProfile): UserProfile {
  const now = new Date().toISOString();
  return {
    ...profile,
    consentVersion: CONSENT_VERSION,
    consentState: "accepted",
    consentedAt: now,
    updatedAt: now
  };
}

export function markConsentRevoked(profile: UserProfile): UserProfile {
  return {
    ...profile,
    consentState: "revoked",
    updatedAt: new Date().toISOString()
  };
}
