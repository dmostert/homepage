---
title: Incus
description: Incus Widget Configuration
---

Learn more about [Incus](https://linuxcontainers.org/incus/).

This widget shows the running and total counts of containers and virtual machines managed by Incus, along with the CPU load and memory usage of an Incus server.

- **Containers**: running / total containers
- **VMs**: running / total virtual machines
- **CPU load**: the 1-minute load average as a percentage of the available CPU threads
- **MEM**: used / total memory reported by the Incus API

Allowed fields: `["containers", "vms", "instances", "resources.cpu", "resources.mem"]`.

```yaml
widget:
  type: incus
  url: https://incus.host.or.ip:8443
  tls:
    certFile: incus/homepage.crt
    keyFile: incus/homepage.key
  member: incus-1 # optional
  project: default # optional
```

## Authentication

Incus authenticates remote API clients with TLS client certificates, so the widget needs a certificate that the Incus server trusts. Homepage does not use a client certificate by default, which means TLS authentication must be configured explicitly.

1. Generate a dedicated client certificate. Incus recommends RSA keys of at least 4096 bits, or an ECDSA key:

   ```bash
   openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 3650 \
     -keyout homepage.key -out homepage.crt -subj "/CN=homepage"
   ```

2. Trust the certificate on the Incus server:

   ```bash
   incus config trust add-certificate homepage.crt --name homepage
   ```

   This grants the certificate full API access. Create a dedicated certificate for Homepage and remove it with `incus config trust remove <fingerprint>` if it is ever compromised.

3. Make the certificate and key available to Homepage. The paths in `services.yaml` are resolved relative to Homepage's config directory (`/app/config` in the container), and absolute paths are also accepted. For example, place both files in `config/incus/` and mount that directory read-only into the container.

4. Reference the files in the widget configuration:

   ```yaml
   widget:
     type: incus
     url: https://incus.host.or.ip:8443
     tls:
       certFile: incus/homepage.crt
       keyFile: incus/homepage.key
   ```

As with Homepage's other proxies, the Incus server certificate is not verified by default. If Incus uses a certificate signed by a CA that the Homepage host trusts, set `tls.verify: true` to enable verification. A custom CA can be supplied with `tls.caFile`.

### Bearer token

Instead of mounting a client certificate, you can pass a bearer token as the `key` setting. Incus accepts a client token generated from a trusted certificate, or an OIDC access token:

```bash
incus remote get-client-token 8760h
```

```yaml
widget:
  type: incus
  url: https://incus.host.or.ip:8443
  key: eyJ...
```

Bearer tokens expire. When the token expires the widget will show an authentication error until a new token is configured, so client certificate authentication is recommended for unattended setups.

## Options

| Name          | Description                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`         | The Incus API URL, including the port (usually `8443`).                                                                                      |
| `tls`         | TLS client certificate settings. `certFile` and `keyFile` are required for certificate authentication. `caFile` and `verify` are optional.   |
| `key`         | A bearer token, used when no client certificate is configured.                                                                               |
| `member`      | Optional cluster member name. When set, only instances on that member are counted and the CPU/memory metrics are requested from that member. |
| `project`     | Optional Incus project name. Defaults to the server's current project (`default` unless configured otherwise).                               |
| `allProjects` | Set to `true` to count instances across all projects. Ignored when `project` is set.                                                         |

Without `member`, instance counts cover the whole cluster while CPU and memory come from the cluster member that handles the API request. Set `member` if you want all metrics for a specific member.
