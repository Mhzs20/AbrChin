import { isMessageGoConfigured } from "@/lib/messagego/config";

export type ControlPlaneFailureReason =
  | "unconfigured"
  | "timeout"
  | "unauthorized"
  | "malformed"
  | "unavailable";

export type ControlPlaneProbeResult = {
  available: boolean;
  configured: boolean;
  fail_closed: boolean;
  reason: "ok" | ControlPlaneFailureReason;
};

export type ControlPlanePort = {
  probe(): Promise<ControlPlaneProbeResult>;
};

function unconfigured(): ControlPlaneProbeResult {
  return {
    available: false,
    configured: false,
    fail_closed: true,
    reason: "unconfigured",
  };
}

export class EnvControlPlanePort implements ControlPlanePort {
  async probe(): Promise<ControlPlaneProbeResult> {
    if (!isMessageGoConfigured()) return unconfigured();
    return {
      available: true,
      configured: true,
      fail_closed: false,
      reason: "ok",
    };
  }
}

export class FailClosedControlPlanePort implements ControlPlanePort {
  readonly reason: ControlPlaneFailureReason;

  constructor(reason: ControlPlaneFailureReason) {
    this.reason = reason;
  }

  async probe(): Promise<ControlPlaneProbeResult> {
    return {
      available: false,
      configured: this.reason !== "unconfigured",
      fail_closed: true,
      reason: this.reason,
    };
  }
}

let testPort: ControlPlanePort | null = null;

export function setControlPlanePortForTests(port: ControlPlanePort | null) {
  if (process.env.ABRCHIN_ISOLATED_TEST !== "1" && process.env.NODE_ENV === "production") {
    return;
  }
  testPort = port;
}

export function getControlPlanePort(): ControlPlanePort {
  if (testPort) return testPort;
  const injected = (process.env.MESSAGEGO_CONTROL_PLANE_PROBE ?? "").trim();
  if (
    injected === "timeout" ||
    injected === "unauthorized" ||
    injected === "malformed" ||
    injected === "unavailable"
  ) {
    return new FailClosedControlPlanePort(injected);
  }
  return new EnvControlPlanePort();
}
