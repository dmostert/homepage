import Block from "components/services/widget/block";
import Container from "components/services/widget/container";
import { useTranslation } from "next-i18next/pages";

import useWidgetAPI from "utils/proxy/use-widget-api";
import withWidgetFields from "utils/widget-fields";

const DEFAULT_FIELDS = ["containers", "vms", "resources.cpu", "resources.mem"];

const FIELDS = {
  containers: { label: "incus.containers", blockField: "incus.containers" },
  vms: { label: "incus.vms", blockField: "incus.vms" },
  instances: { label: "incus.instances", blockField: "incus.instances" },
  "resources.cpu": { label: "incus.cpu_load", blockField: "resources.cpu" },
  "resources.mem": { label: "resources.mem", blockField: "resources.mem" },
};

function statusOf(instance) {
  return instance?.state?.status ?? instance?.status;
}

function countInstances(instances, member, type) {
  const matching = instances.filter(
    (instance) => (!type || instance.type === type) && (!member || instance.location === member),
  );
  const running = matching.filter((instance) => statusOf(instance) === "Running").length;

  return { running, total: matching.length };
}

function renderField(field, stats, t) {
  const definition = FIELDS[field];

  if (!definition) {
    return null;
  }

  if (field === "resources.cpu") {
    return (
      <Block
        key={field}
        label={definition.label}
        field={definition.blockField}
        value={stats.cpu === null ? undefined : t("common.percent", { value: stats.cpu })}
        highlightValue={stats.cpu}
      />
    );
  }

  if (field === "resources.mem") {
    return (
      <Block
        key={field}
        label={definition.label}
        field={definition.blockField}
        value={stats.memory === null ? undefined : t("common.percent", { value: stats.memory })}
        highlightValue={stats.memory}
      />
    );
  }

  const counts = stats[field];

  return (
    <Block
      key={field}
      label={definition.label}
      field={definition.blockField}
      value={`${counts.running} / ${counts.total}`}
    />
  );
}

export default function Component({ service: configuredService }) {
  const { t } = useTranslation();
  const service = withWidgetFields(configuredService, DEFAULT_FIELDS);
  const { widget } = service;

  const instanceQuery = {
    recursion: 2,
    ...(widget.allProjects ? { "all-projects": "true" } : widget.project ? { project: widget.project } : {}),
  };
  const resourceQuery = widget.member ? { target: widget.member } : undefined;

  const { data: instancesData, error: instancesError } = useWidgetAPI(widget, "instances", instanceQuery);
  const { data: resourcesData, error: resourcesError } = useWidgetAPI(widget, "resources", resourceQuery);

  if (instancesError || resourcesError) {
    return <Container service={service} error={instancesError ?? resourcesError} />;
  }

  if (!instancesData || !resourcesData) {
    return (
      <Container service={service}>
        {widget.fields.map((field) =>
          FIELDS[field] ? <Block key={field} label={FIELDS[field].label} field={FIELDS[field].blockField} /> : null,
        )}
      </Container>
    );
  }

  const instances = Array.isArray(instancesData.metadata) ? instancesData.metadata : null;
  const resources = resourcesData.metadata;

  if (!instances || !resources) {
    return (
      <Container service={service}>
        {widget.fields.map((field) =>
          FIELDS[field] ? <Block key={field} label={FIELDS[field].label} field={FIELDS[field].blockField} /> : null,
        )}
      </Container>
    );
  }

  const containers = countInstances(instances, widget.member, "container");
  const vms = countInstances(instances, widget.member, "virtual-machine");

  const cpuTotal = resources.cpu?.total;
  const cpuLoad = resources.load?.average1min;
  const cpu = typeof cpuLoad === "number" && cpuTotal > 0 ? (cpuLoad / cpuTotal) * 100 : null;

  const memoryTotal = resources.memory?.total;
  const memoryUsed = resources.memory?.used;
  const memory =
    typeof memoryTotal === "number" && memoryTotal > 0 && typeof memoryUsed === "number"
      ? (memoryUsed / memoryTotal) * 100
      : null;

  const stats = {
    containers,
    vms,
    instances: {
      running: containers.running + vms.running,
      total: containers.total + vms.total,
    },
    cpu,
    memory,
  };

  return <Container service={service}>{widget.fields.map((field) => renderField(field, stats, t))}</Container>;
}
