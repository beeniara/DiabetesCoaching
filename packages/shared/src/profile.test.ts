import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, createDefaultUserProfile, markConsentAccepted, markConsentRevoked } from "./profile";

describe("profile helpers", () => {
  it("creates a pending profile and records consent updates", () => {
    const profile = createDefaultUserProfile("Pacific/Auckland");
    expect(profile.consentState).toBe("pending");
    expect(profile.consentVersion).toBe(CONSENT_VERSION);

    const accepted = markConsentAccepted(profile);
    expect(accepted.consentState).toBe("accepted");
    expect(accepted.consentedAt).toBeDefined();

    const revoked = markConsentRevoked(accepted);
    expect(revoked.consentState).toBe("revoked");
  });
});
