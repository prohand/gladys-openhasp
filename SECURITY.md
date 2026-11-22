# Security policy

## Supported versions

Only the latest release of the openHASP integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-openhasp](https://github.com/prohand/gladys-openhasp/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration, of Gladys and of the openHASP firmware;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove passwords, broker credentials and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), the
openHASP firmware (report to [HASwitchPlate/openHASP](https://github.com/HASwitchPlate/openHASP))
and the MQTT broker you run.

## Good practices for users

- Protect your MQTT broker with a user and a password, and keep it off the internet:
  anyone who can publish on `hasp/#` can drive the plates.
- Keep the MQTT password in the integration's secret field, not in the broker address.
- Use `mqtts://` when the broker is reached over a network you do not trust.
- Keep Gladys, the integration and the openHASP firmware up to date.
