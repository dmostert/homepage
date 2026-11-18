// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";
import { expectBlockValue } from "test-utils/widget-assertions";

const { useWidgetAPI } = vi.hoisted(() => ({ useWidgetAPI: vi.fn() }));

vi.mock("utils/proxy/use-widget-api", () => ({
  default: useWidgetAPI,
}));

import Component from "./component";

const INSTANCES = {
  metadata: [
    { type: "container", location: "n1", state: { status: "Running" } },
    { type: "container", location: "n1", state: { status: "Stopped" } },
    { type: "container", location: "n2", state: { status: "Stopped" } },
    { type: "virtual-machine", location: "n2", state: { status: "Running" } },
    { type: "virtual-machine", location: "n2", state: { status: "Stopped" } },
  ],
};

const RESOURCES = {
  metadata: {
    cpu: { total: 4 },
    load: { average1min: 1 },
    memory: { total: 100, used: 50 },
  },
};

function mockData({ instances = INSTANCES, resources = RESOURCES, instancesError, resourcesError } = {}) {
  useWidgetAPI.mockImplementation((widget, endpoint) => {
    if (endpoint === "instances") {
      return { data: instances, error: instancesError };
    }

    return { data: resources, error: resourcesError };
  });
}

describe("widgets/incus/component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders placeholders while loading", () => {
    useWidgetAPI.mockReturnValue({ data: undefined, error: undefined });

    const { container } = renderWithProviders(<Component service={{ widget: { type: "incus" } }} />, {
      settings: { hideErrors: false },
    });

    expect(container.querySelectorAll(".service-block")).toHaveLength(4);
    expect(screen.getByText("incus.containers")).toBeInTheDocument();
    expect(screen.getByText("incus.vms")).toBeInTheDocument();
    expect(screen.getByText("incus.cpu_load")).toBeInTheDocument();
    expect(screen.getByText("resources.mem")).toBeInTheDocument();
  });

  it("renders running totals and cluster resource usage", () => {
    mockData();

    const { container } = renderWithProviders(<Component service={{ widget: { type: "incus" } }} />, {
      settings: { hideErrors: false },
    });

    expectBlockValue(container, "incus.containers", "1 / 3");
    expectBlockValue(container, "incus.vms", "1 / 2");
    // (1-minute load / 4 threads) * 100
    expectBlockValue(container, "incus.cpu_load", 25);
    // (50 / 100) * 100
    expectBlockValue(container, "resources.mem", 50);
  });

  it("requests all instances recursively", () => {
    mockData();

    renderWithProviders(<Component service={{ widget: { type: "incus" } }} />, {
      settings: { hideErrors: false },
    });

    expect(useWidgetAPI).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "incus" }), "instances", {
      recursion: 2,
    });
    expect(useWidgetAPI).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "incus" }), "resources", undefined);
  });

  it("filters instances and resources by cluster member", () => {
    mockData();

    const { container } = renderWithProviders(<Component service={{ widget: { type: "incus", member: "n2" } }} />, {
      settings: { hideErrors: false },
    });

    expect(useWidgetAPI).toHaveBeenNthCalledWith(2, expect.objectContaining({ member: "n2" }), "resources", {
      target: "n2",
    });

    expectBlockValue(container, "incus.containers", "0 / 1");
    expectBlockValue(container, "incus.vms", "1 / 2");
  });

  it("supports project scoping and all-projects queries", () => {
    mockData();

    const { rerender } = renderWithProviders(<Component service={{ widget: { type: "incus", project: "web" } }} />, {
      settings: { hideErrors: false },
    });

    expect(useWidgetAPI).toHaveBeenNthCalledWith(1, expect.anything(), "instances", {
      recursion: 2,
      project: "web",
    });

    rerender(<Component service={{ widget: { type: "incus", allProjects: true } }} />);

    const instanceCalls = useWidgetAPI.mock.calls.filter((call) => call[1] === "instances");
    expect(instanceCalls.at(-1)).toEqual([expect.anything(), "instances", { recursion: 2, "all-projects": "true" }]);
  });

  it("renders the instances field", () => {
    mockData();

    const { container } = renderWithProviders(
      <Component service={{ widget: { type: "incus", fields: ["instances"] } }} />,
      { settings: { hideErrors: false } },
    );

    expect(container.querySelectorAll(".service-block")).toHaveLength(1);
    expectBlockValue(container, "incus.instances", "2 / 5");
  });

  it("caps custom fields at four without mutating the service", () => {
    mockData();

    const service = {
      widget: {
        type: "incus",
        fields: ["containers", "vms", "instances", "resources.mem", "resources.cpu"],
      },
    };
    const { container } = renderWithProviders(<Component service={service} />, {
      settings: { hideErrors: false },
    });

    expect(service.widget.fields).toEqual(["containers", "vms", "instances", "resources.mem", "resources.cpu"]);
    expect(container.querySelectorAll(".service-block")).toHaveLength(4);
    expect(screen.queryByText("incus.cpu_load")).toBeNull();
  });

  it("falls back to the instance status when state is not inlined", () => {
    mockData({
      instances: {
        metadata: [{ type: "container", location: "n1", status: "Running" }],
      },
    });

    const { container } = renderWithProviders(<Component service={{ widget: { type: "incus" } }} />, {
      settings: { hideErrors: false },
    });

    expectBlockValue(container, "incus.containers", "1 / 1");
    expectBlockValue(container, "incus.vms", "0 / 0");
  });

  it("renders an error when either API call fails", () => {
    mockData({ resourcesError: { message: "incus unavailable" } });

    renderWithProviders(<Component service={{ widget: { type: "incus" } }} />, {
      settings: { hideErrors: false },
    });

    expect(screen.getByText("incus unavailable")).toBeInTheDocument();
  });
});
