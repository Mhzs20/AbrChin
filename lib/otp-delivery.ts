/**
 * Create a challenge, attempt delivery, and remove the challenge if delivery fails
 * so a failed SMS never leaves a consumable OTP behind.
 */
export async function createThenDeliverOtpChallenge<TChallenge extends { id: string }, TResult>(
  create: () => Promise<TChallenge>,
  deliver: (challenge: TChallenge) => Promise<TResult>,
  remove: (challenge: TChallenge) => Promise<void>,
): Promise<TResult> {
  const challenge = await create();
  try {
    return await deliver(challenge);
  } catch (error) {
    try {
      await remove(challenge);
    } catch {
      // Prefer the original delivery error; cleanup failure is secondary.
    }
    throw error;
  }
}
