import type { EmailProvider, SendEmailInput } from "./types.ts";

/** Dev-only provider — never used as a silent success path in production. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly sent: SendEmailInput[] = [];

  async send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
    // Do not log verification codes. Subject + masked recipient only.
    const at = input.to.indexOf("@");
    const masked =
      at > 1
        ? `${input.to.slice(0, 1)}***${input.to.slice(at)}`
        : "***";
    console.info(`[email:console] to=${masked} subject=${input.subject}`);
  }
}
