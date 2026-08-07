import nodemailer from "nodemailer";

import { EmailDeliveryError, type EmailProvider, type SendEmailInput } from "./types.ts";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  timeoutMs: number;
};

export class SmtpEmailProvider implements EmailProvider {
  private readonly config: SmtpConfig;

  constructor(config: SmtpConfig) {
    this.config = config;
  }

  async send(input: SendEmailInput): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      connectionTimeout: this.config.timeoutMs,
      greetingTimeout: this.config.timeoutMs,
      socketTimeout: this.config.timeoutMs,
    });

    try {
      await transporter.sendMail({
        from: this.config.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    } catch (error) {
      throw new EmailDeliveryError(
        "delivery_failed",
        error instanceof Error ? error.message : "SMTP delivery failed",
      );
    } finally {
      transporter.close();
    }
  }
}
