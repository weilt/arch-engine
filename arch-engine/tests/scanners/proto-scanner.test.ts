import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseProtoContent,
  scanProtoServices,
} from "../../src/scanners/proto-scanner.js";

const PAYMENT_PROTO = `syntax = "proto3";
package payment;
service PaymentService {
  rpc Charge(ChargeRequest) returns (ChargeResponse);
  rpc Refund(RefundRequest) returns (RefundResponse);
  rpc StreamPayments(stream PaymentQuery) returns (stream PaymentResult);
}`;

describe("proto-scanner", () => {
  it("parseProtoContent extracts service, rpcs and strips the stream keyword", () => {
    const services = parseProtoContent(PAYMENT_PROTO, "payment.proto");
    expect(services).toHaveLength(1);
    const svc = services[0]!;
    expect(svc.serviceName).toBe("PaymentService");
    expect(svc.filePath).toBe("payment.proto");
    expect(svc.rpcs).toHaveLength(3);
    const charge = svc.rpcs.find((r) => r.name === "Charge");
    expect(charge?.requestType).toBe("ChargeRequest");
    expect(charge?.responseType).toBe("ChargeResponse");
    const refund = svc.rpcs.find((r) => r.name === "Refund");
    expect(refund?.requestType).toBe("RefundRequest");
    expect(refund?.responseType).toBe("RefundResponse");
    const stream = svc.rpcs.find((r) => r.name === "StreamPayments");
    expect(stream?.requestType).toBe("PaymentQuery");
    expect(stream?.responseType).toBe("PaymentResult");
  });

  it("scanProtoServices globs nested .proto files and reports repo-relative paths", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proto-scan-"));
    try {
      const protoDir = path.join(dir, "proto", "payment");
      await fs.mkdir(protoDir, { recursive: true });
      await fs.writeFile(path.join(protoDir, "payment.proto"), PAYMENT_PROTO, "utf-8");
      const services = await scanProtoServices(dir);
      expect(services).toHaveLength(1);
      const svc = services[0]!;
      expect(svc.serviceName).toBe("PaymentService");
      expect(svc.filePath).toBe("proto/payment/payment.proto");
      expect(svc.rpcs.map((r) => r.name)).toEqual([
        "Charge",
        "Refund",
        "StreamPayments",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty array when no .proto files are present", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proto-scan-"));
    try {
      await fs.writeFile(path.join(dir, "README.md"), "no protos here", "utf-8");
      const services = await scanProtoServices(dir);
      expect(services).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("handles multiple services in a single file", () => {
    const content = `service OrderService {
  rpc Create(CreateReq) returns (CreateResp);
}
service BillingService {
  rpc Bill(BillReq) returns (BillResp);
}`;
    const services = parseProtoContent(content, "multi.proto");
    expect(services.map((s) => s.serviceName)).toEqual([
      "OrderService",
      "BillingService",
    ]);
    expect(services[0]!.rpcs[0]!.name).toBe("Create");
    expect(services[1]!.rpcs[0]!.name).toBe("Bill");
  });
});
