import incusProxyHandler from "./proxy";

const widget = {
  api: "{url}/1.0/{endpoint}",
  proxyHandler: incusProxyHandler,

  mappings: {
    instances: {
      endpoint: "instances",
      params: ["recursion", "project", "all-projects"],
      validate: ["metadata"],
    },
    resources: {
      endpoint: "resources",
      optionalParams: ["target"],
      validate: ["metadata"],
    },
  },
};

export default widget;
