import { readFileSync } from "node:fs";
import { Agent } from "node:https";
import path from "node:path";

import { CONF_DIR } from "utils/config/config";
import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { formatApiCall, sanitizeErrorURL } from "utils/proxy/api-helpers";
import { httpProxy } from "utils/proxy/http";
import validateWidgetData from "utils/proxy/validate-widget-data";
import widgets from "widgets/widgets";

const logger = createLogger("incusProxyHandler");

function resolveConfigPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(CONF_DIR, filePath);
}

function createTlsAgent(widget) {
  const { certFile, keyFile, caFile, verify } = widget.tls ?? {};

  if (!certFile && !keyFile) {
    return null;
  }

  if (!certFile || !keyFile) {
    throw new Error("tls.certFile and tls.keyFile must be configured together");
  }

  const options = {
    cert: readFileSync(resolveConfigPath(certFile)),
    key: readFileSync(resolveConfigPath(keyFile)),
    // Homepage's default proxy agent does not validate upstream certificates, so
    // keep the same behaviour unless verification is explicitly requested.
    rejectUnauthorized: verify === true,
    keepAlive: false,
  };

  if (caFile && verify === true) {
    options.ca = readFileSync(resolveConfigPath(caFile));
  }

  return new Agent(options);
}

function parseErrorBody(data) {
  if (!Buffer.isBuffer(data)) {
    return null;
  }

  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

export default async function incusProxyHandler(req, res, map) {
  const { group, service, endpoint, index } = req.query;

  if (!group || !service || !endpoint) {
    logger.debug("Invalid or missing service '%s', group '%s' or endpoint", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  const widget = await getServiceWidget(group, service, index);

  if (!widget) {
    logger.debug("Invalid or missing widget for service '%s' in group '%s'", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  const widgetDefinition = widgets[widget.type];

  if (!widgetDefinition?.api) {
    return res.status(403).json({ error: "Service does not support API calls" });
  }

  const requestEndpoint = endpoint.toString();
  const endpointName = requestEndpoint.split("?")[0];
  const mapping = Object.values(widgetDefinition.mappings ?? {}).find((m) => m.endpoint === endpointName);

  if (!mapping) {
    logger.debug("Unmapped Incus endpoint '%s' for service '%s'", endpointName, service);
    return res.status(403).json({ error: "Unsupported service endpoint" });
  }

  const url = new URL(formatApiCall(widgetDefinition.api, { ...widget, endpoint: requestEndpoint }));
  const headers = { Accept: "application/json" };

  let agent = null;
  try {
    agent = createTlsAgent(widget);
  } catch (error) {
    logger.error("Unable to configure Incus TLS credentials: %s", error.message);
    return res.status(400).json({
      error: {
        message: `Unable to configure the Incus TLS credentials: ${error.message}`,
        url: sanitizeErrorURL(url),
      },
    });
  }

  if (!agent && widget.key) {
    headers.Authorization = `Bearer ${widget.key}`;
  }

  const [status, contentType, data, responseHeaders] = await httpProxy(url, {
    method: "GET",
    headers,
    ...(agent ? { agent } : {}),
  });

  if (status === 204 || status === 304) {
    return res.status(status).end();
  }

  if (status >= 400) {
    const parsedError = Buffer.isBuffer(data) ? parseErrorBody(data) : data;
    const upstreamMessage =
      typeof parsedError?.error === "string"
        ? parsedError.error
        : typeof parsedError?.error?.message === "string"
          ? parsedError.error.message
          : typeof parsedError?.message === "string"
            ? parsedError.message
            : "HTTP Error";

    logger.error("HTTP Error %d calling %s", status, url.toString());

    let message = `Incus API error: ${upstreamMessage}`;
    if (status === 401 || status === 403) {
      message += " Check that the client certificate is trusted by the Incus server or that the bearer token is valid.";
    }

    return res.status(status).json({
      error: {
        message,
        url: sanitizeErrorURL(url),
      },
    });
  }

  if (status === 200) {
    if (!validateWidgetData(widget, endpointName, data)) {
      return res.status(500).json({ error: { message: "Invalid data", url: sanitizeErrorURL(url), data } });
    }

    let resultData = data;
    if (map) resultData = map(resultData, responseHeaders);

    if (contentType) res.setHeader("Content-Type", contentType);
    return res.status(status).send(resultData);
  }

  logger.error("Unexpected HTTP status %d calling %s", status, url.toString());
  return res.status(status).json({
    error: {
      message: `Unexpected HTTP status from Incus: ${status}`,
      url: sanitizeErrorURL(url),
    },
  });
}
