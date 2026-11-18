import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { httpProxy, getServiceWidget, validateWidgetData, readFileSync, logger, Agent } = vi.hoisted(() => {
  class FakeAgent {
    constructor(options) {
      this.options = options;
    }
  }

  return {
    httpProxy: vi.fn(),
    getServiceWidget: vi.fn(),
    validateWidgetData: vi.fn(() => true),
    readFileSync: vi.fn(),
    logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
    Agent: FakeAgent,
  };
});

vi.mock("node:fs", () => ({ readFileSync }));
vi.mock("node:https", () => ({ Agent }));
vi.mock("utils/config/config", () => ({ CONF_DIR: "/config" }));
vi.mock("utils/logger", () => ({ default: () => logger }));
vi.mock("utils/config/service-helpers", () => ({ default: getServiceWidget }));
vi.mock("utils/proxy/validate-widget-data", () => ({ default: validateWidgetData }));
vi.mock("utils/proxy/http", () => ({ httpProxy }));
vi.mock("widgets/widgets", () => ({
  default: {
    incus: {
      api: "{url}/1.0/{endpoint}",
      mappings: {
        instances: { endpoint: "instances", params: ["recursion", "project", "all-projects"] },
        resources: { endpoint: "resources", optionalParams: ["target"] },
      },
    },
  },
}));

import incusProxyHandler from "./proxy";

function request(endpoint = "instances?recursion=2") {
  return { query: { group: "g", service: "svc", endpoint, index: "0" } };
}

describe("widgets/incus/proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateWidgetData.mockReturnValue(true);
    readFileSync.mockImplementation((file) => (file.endsWith(".key") ? "key-data" : "cert-data"));
  });

  it("uses a bearer token when no client certificate is configured", async () => {
    getServiceWidget.mockResolvedValue({
      type: "incus",
      url: "https://incus:8443/",
      key: "secret-token",
    });
    httpProxy.mockResolvedValue([
      200,
      "application/json",
      Buffer.from(JSON.stringify({ type: "sync", metadata: [] })),
      {},
    ]);

    const res = createMockRes();
    await incusProxyHandler(request(), res);

    expect(httpProxy).toHaveBeenCalledTimes(1);
    const [url, params] = httpProxy.mock.calls[0];
    expect(url.toString()).toBe("https://incus:8443/1.0/instances?recursion=2");
    expect(params.headers.Authorization).toBe("Bearer secret-token");
    expect(params.agent).toBeUndefined();
    expect(validateWidgetData).toHaveBeenCalledWith(
      expect.objectContaining({ type: "incus" }),
      "instances",
      expect.anything(),
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
  });

  it("reads the TLS certificate and key relative to the config directory", async () => {
    getServiceWidget.mockResolvedValue({
      type: "incus",
      url: "https://incus:8443",
      tls: { certFile: "incus/homepage.crt", keyFile: "incus/homepage.key" },
    });
    httpProxy.mockResolvedValue([
      200,
      "application/json",
      Buffer.from(JSON.stringify({ type: "sync", metadata: {} })),
      {},
    ]);

    const res = createMockRes();
    await incusProxyHandler(request("resources?target=n1"), res);

    expect(readFileSync).toHaveBeenCalledWith("/config/incus/homepage.crt");
    expect(readFileSync).toHaveBeenCalledWith("/config/incus/homepage.key");

    const [url, params] = httpProxy.mock.calls[0];
    expect(url.toString()).toBe("https://incus:8443/1.0/resources?target=n1");
    expect(params.headers.Authorization).toBeUndefined();
    expect(params.agent).toBeInstanceOf(Agent);
    expect(params.agent.options).toMatchObject({
      cert: "cert-data",
      key: "key-data",
      rejectUnauthorized: false,
    });
  });

  it("supports CA verification explicitly", async () => {
    getServiceWidget.mockResolvedValue({
      type: "incus",
      url: "https://incus:8443",
      tls: {
        certFile: "incus/homepage.crt",
        keyFile: "incus/homepage.key",
        caFile: "incus/ca.crt",
        verify: true,
      },
    });
    readFileSync.mockImplementation((file) => {
      if (file.endsWith(".key")) return "key-data";
      if (file.endsWith("ca.crt")) return "ca-data";
      return "cert-data";
    });
    httpProxy.mockResolvedValue([200, "application/json", Buffer.from("{}"), {}]);

    await incusProxyHandler(request(), createMockRes());

    const [, params] = httpProxy.mock.calls[0];
    expect(params.agent.options).toMatchObject({
      ca: "ca-data",
      rejectUnauthorized: true,
    });
  });

  it("surfaces upstream authentication errors with a hint", async () => {
    getServiceWidget.mockResolvedValue({ type: "incus", url: "https://incus:8443", key: "bad" });
    httpProxy.mockResolvedValue([
      403,
      "application/json",
      Buffer.from(JSON.stringify({ type: "error", error: "Certificate is not trusted", error_code: 403 })),
      {},
    ]);

    const res = createMockRes();
    await incusProxyHandler(request(), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toContain("Certificate is not trusted");
    expect(res.body.error.message).toContain("client certificate is trusted");
    expect(validateWidgetData).not.toHaveBeenCalled();
  });

  it("rejects invalid widget data", async () => {
    getServiceWidget.mockResolvedValue({ type: "incus", url: "https://incus:8443", key: "token" });
    validateWidgetData.mockReturnValue(false);
    httpProxy.mockResolvedValue([200, "application/json", Buffer.from("{}"), {}]);

    const res = createMockRes();
    await incusProxyHandler(request(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error.message).toBe("Invalid data");
  });

  it("returns a clear error when TLS files cannot be read", async () => {
    getServiceWidget.mockResolvedValue({
      type: "incus",
      url: "https://incus:8443",
      tls: { certFile: "incus/missing.crt", keyFile: "incus/missing.key" },
    });
    readFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const res = createMockRes();
    await incusProxyHandler(request(), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain("Unable to configure the Incus TLS credentials");
    expect(httpProxy).not.toHaveBeenCalled();
  });

  it("requires both TLS files when only one is configured", async () => {
    getServiceWidget.mockResolvedValue({
      type: "incus",
      url: "https://incus:8443",
      tls: { certFile: "incus/homepage.crt" },
    });

    const res = createMockRes();
    await incusProxyHandler(request(), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain("tls.certFile and tls.keyFile must be configured together");
    expect(httpProxy).not.toHaveBeenCalled();
  });

  it("rejects unmapped endpoints", async () => {
    getServiceWidget.mockResolvedValue({ type: "incus", url: "https://incus:8443", key: "token" });

    const res = createMockRes();
    await incusProxyHandler(request("certificates"), res);

    expect(res.statusCode).toBe(403);
    expect(httpProxy).not.toHaveBeenCalled();
  });

  it("rejects unknown services", async () => {
    getServiceWidget.mockResolvedValue(null);

    const res = createMockRes();
    await incusProxyHandler(request(), res);

    expect(res.statusCode).toBe(400);
    expect(httpProxy).not.toHaveBeenCalled();
  });
});
